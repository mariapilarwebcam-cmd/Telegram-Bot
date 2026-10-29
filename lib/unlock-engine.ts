// lib/unlock-engine.ts
import { db } from '@/lib/turso'
import { updateSpendState, rewardUserTags } from '@/lib/db-queries'

export class HttpError extends Error {
  constructor(public status: number, public code: string) {
    super(code)
  }
}

const MAX_TOKENS = 5
const DAY_SECONDS = 86400

// ✅ Función interna para consumir tokens VIP (acumulación perezosa)
async function consumeVipToken(tx: any, userId: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000)

  const userRes = await tx.execute({
    sql: 'SELECT photo_tokens AS t, photo_tokens_at AS a FROM users WHERE telegram_id = ?',
    args: [userId]
  })

  const user = userRes.rows[0]
  if (!user) return false

  let tokens = Number(user.t || 0)
  let lastAt = Number(user.a) || now

  // Cálculo de acumulación (1 por día, máximo 5)
  const daysPassed = Math.floor((now - lastAt) / DAY_SECONDS)
  if (daysPassed > 0) {
    tokens = Math.min(MAX_TOKENS, tokens + daysPassed)
    lastAt = tokens >= MAX_TOKENS ? now : lastAt + (daysPassed * DAY_SECONDS)
  }

  if (tokens < 1) return false

  // Descontar token
  await tx.execute({
    sql: 'UPDATE users SET photo_tokens = ?, photo_tokens_at = ? WHERE telegram_id = ?',
    args: [tokens - 1, lastAt, userId]
  })

  return true
}

export async function unlockOffer(userId: string, offerId: number) {
  const tx = await db.transaction('write')
  let imageIdToReward: number | null = null
  let pricePaid = 0
  let paidWithMode = ''

  try {
    // 1. Obtener la oferta y verificar que pertenece al usuario
    const offerRes = await tx.execute({
      sql: `SELECT o.id, o.image_id, o.price_gems, o.state
            FROM photo_offers o
            WHERE o.id = ? AND o.user_id = ?`,
      args: [offerId, userId]
    })
    const offer = offerRes.rows[0]

    if (!offer) {
      await tx.rollback()
      throw new HttpError(404, 'offer_not_found')
    }

    const offerImageId = offer.image_id ? Number(offer.image_id) : null
    pricePaid = Number(offer.price_gems || 0)

    // ✅ FIX #1: Manejo robusto del caso "ya desbloqueada" con image_id null
    if (offer.state === 'unlocked') {
      if (!offerImageId) {
        await tx.rollback()
        throw new HttpError(500, 'corrupted_offer')
      }
      const imgRes = await tx.execute({
        sql: 'SELECT r2_key FROM generated_images WHERE id = ?',
        args: [offerImageId]
      })
      const imgRow = imgRes.rows[0]
      if (!imgRow) {
        await tx.rollback()
        throw new HttpError(404, 'image_not_found')
      }
      await tx.commit()
      return { already_unlocked: true, r2_key: String(imgRow.r2_key) }
    }

    // ✅ FIX #1 (parte 2): Bloquear ofertas con image_id null en estado locked
    // (no debería ocurrir tras el fix de generate-image, pero por si acaso)
    if (!offerImageId) {
      await tx.rollback()
      throw new HttpError(500, 'corrupted_offer')
    }

    imageIdToReward = offerImageId
    const price = pricePaid
    let paidWith: 'free' | 'token' | 'gems' = 'gems'

    // 2. Lógica de cobro (Prioridad: Gratis > Token VIP > Gemas)
    if (price === 0) {
      paidWith = 'free'
    } else {
      // Verificar si es VIP consultando la suscripción
      const subRes = await tx.execute({
        sql: `SELECT id FROM subscriptions WHERE telegram_id = ? AND status = 'active' AND expires_at > datetime('now') LIMIT 1`,
        args: [userId]
      })
      const isVip = !!subRes.rows[0]

      if (isVip && (await consumeVipToken(tx, userId))) {
        paidWith = 'token'
      } else {
        // Cobro con gemas (atómico: solo si tiene saldo suficiente)
        const debitRes = await tx.execute({
          sql: `UPDATE users
                SET gems = gems - ?, purchased_gems = purchased_gems - ?
                WHERE telegram_id = ? AND purchased_gems >= ?`,
          args: [price, price, userId, price]
        })

        if (debitRes.rowsAffected === 0) {
          await tx.rollback()
          throw new HttpError(402, 'insufficient_gems')
        }
        paidWith = 'gems'
      }
    }

    paidWithMode = paidWith

    // 3. Marcar la oferta como desbloqueada
    await tx.execute({
      sql: `UPDATE photo_offers SET state = 'unlocked', paid_with = ?, unlocked_at = unixepoch() WHERE id = ?`,
      args: [paidWith, offerId]
    })

    // 4. Registrar en gem_ledger (auditoría técnica)
    await tx.execute({
      sql: `INSERT INTO gem_ledger (user_id, delta, kind, ref) VALUES (?, ?, ?, ?)`,
      args: [
        userId,
        paidWith === 'gems' ? -price : 0,
        `unlock_${paidWith}`,
        `offer:${offerId}`
      ]
    })

    // ✅ FIX #2: Registrar TAMBIÉN en gem_transactions (tabla principal del historial del usuario)
    // Esto permite que el usuario vea el gasto en su historial y que las analíticas lo cuenten.
    if (paidWith === 'gems' && price > 0) {
      await tx.execute({
        sql: `INSERT INTO gem_transactions
              (telegram_id, amount, transaction_type, description)
              VALUES (?, ?, 'unlock_photo', ?)`,
        args: [userId, -price, `Desbloqueo de foto (oferta:${offerId})`]
      })
    } else if (paidWith === 'token') {
      await tx.execute({
        sql: `INSERT INTO gem_transactions
              (telegram_id, amount, transaction_type, description)
              VALUES (?, 0, 'unlock_photo_token', ?)`,
        args: [userId, `Desbloqueo con token VIP (oferta:${offerId})`]
      })
    }

    // 5. Promoción Diferida (Claude's Rule): Solo las pagadas con gemas pasan a 'active' inmediatamente
    if (paidWith === 'gems') {
      await tx.execute({
        sql: `UPDATE generated_images SET status = 'active' WHERE id = ? AND status = 'candidate'`,
        args: [imageIdToReward]
      })
    }

    await tx.commit()

    // 6. Efectos secundarios post-compra (fuera de la transacción, no críticos)
    try {
      if (paidWithMode === 'gems' && pricePaid > 0) {
        await updateSpendState(userId, pricePaid)
      }
      // El bot aprende de la foto (le sumamos 3 puntos a sus gustos)
      await rewardUserTags(userId, imageIdToReward, 3)
    } catch (postErr) {
      console.warn('[unlock-engine] Error en efectos secundarios post-compra:', postErr)
    }

    // ✅ FIX #3: SELECT final con optional chaining para no explotar si la imagen fue borrada
    const imgRes = await db.execute({
      sql: 'SELECT r2_key FROM generated_images WHERE id = ?',
      args: [imageIdToReward]
    })
    const finalRow = imgRes.rows[0]

    if (!finalRow) {
      // La imagen existía al inicio pero fue borrada entre commit y SELECT (raro).
      // El desbloqueo SÍ se completó, así que devolvemos un error claro pero sin revertir.
      throw new HttpError(500, 'image_disappeared')
    }

    return {
      already_unlocked: false,
      r2_key: String(finalRow.r2_key),
      paid_with: paidWith
    }

  } catch (e) {
    if (!(e instanceof HttpError)) {
      await tx.rollback().catch(() => {})
    }
    throw e
  }
}
