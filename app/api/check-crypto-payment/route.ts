// app/api/check-crypto-payment/route.ts

import { NextResponse } from 'next/server'
import { queryOne, execute } from '@/lib/turso'
import {
  getUser,
  getPurchaseByChargeId,
  insertStarPurchase,
  incrementGemsAndPurchased,
  insertGemTransaction,
  getUniqueBuyers,
  insertReferralCommission,
  incrementPayingReferrals,
  incrementGems,
} from '@/lib/db-queries'
import {
  CRYPTO_PACKAGES,
  MESSAGE_PACKAGES,
  HYBRID_PACKAGES, // ✅ NUEVO
  getFinalCryptoGems,
  REFERRAL_PURCHASE_COMMISSION_PCT,
  REFERRAL_TOP_TIER_THRESHOLD,
  REFERRAL_TOP_TIER_PCT,
  REFERRAL_ELITE_TIER_THRESHOLD,
  REFERRAL_ELITE_TIER_PCT,
} from '@/lib/constants'

const TONAPI_KEY = process.env.TONAPI_KEY || ''
const RECIPIENT_WALLET =
  process.env.TON_RECIPIENT_WALLET || 'UQCt76T3JPW3WrpsfIz6Tc1eVrvkrQpwV0-3sk1so4P8Vd4-'

const USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'

// ═══════════════════════════════════════════════════════════════
// Comisión al referidor (Turso)
// ═══════════════════════════════════════════════════════════════
async function payReferralCommission(
  buyerTid: string,
  gemsEquivalent: number,
  source: string,
  reference: string
): Promise<void> {
  try {
    const buyer = await getUser(buyerTid)
    if (!buyer?.referred_by) return

    const referrerId = String(buyer.referred_by)

    const referrer = await getUser(referrerId)
    if (!referrer) return

    // Contar compradores únicos del referidor
    const uniqueBuyers = await getUniqueBuyers(referrerId)
    uniqueBuyers.add(buyerTid)

    const totalUnique = uniqueBuyers.size

    let pct = REFERRAL_PURCHASE_COMMISSION_PCT
    if (totalUnique >= REFERRAL_ELITE_TIER_THRESHOLD) {
      pct = REFERRAL_ELITE_TIER_PCT
    } else if (totalUnique >= REFERRAL_TOP_TIER_THRESHOLD) {
      pct = REFERRAL_TOP_TIER_PCT
    }

    const commission = Math.floor((gemsEquivalent * pct) / 100)
    if (commission <= 0) return

    // Pagar comisión (solo a gems, no a purchased_gems)
    await incrementGems(referrerId, commission)

    // Actualizar contador de referidos que compraron
    await incrementPayingReferrals(referrerId, totalUnique)

    // Registrar transacción
    await insertGemTransaction({
      telegram_id: referrerId,
      amount: commission,
      transaction_type: 'referral_commission',
      description: `Comisión ${pct}% por compra de referido`,
    })

    // Registrar comisión
    await insertReferralCommission({
      referrer_id: referrerId,
      referred_id: buyerTid,
      purchase_gems: gemsEquivalent,
      commission_gems: commission,
      commission_pct: pct,
      source,
      reference,
    })

    console.log('[commission] ✅ Pagada:', {
      referrerId,
      commission,
      pct,
      totalUnique,
    })
  } catch (e) {
    console.error('[commission] Error:', e)
  }
}

// ═══════════════════════════════════════════════════════════════
// POST /api/check-crypto-payment
// ═══════════════════════════════════════════════════════════════
export async function POST(request: Request) {
  try {
    const tidFromAuth = request.headers.get('x-telegram-id-validated')
    if (!tidFromAuth) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const reference = typeof body.reference === 'string' ? body.reference : ''

    if (!reference) {
      return NextResponse.json({ error: 'Reference requerido' }, { status: 400 })
    }

    // ✅ NUEVO FORMATO: TABOO_<telegram_id>_<package_type>_<package_index>_<timestamp>
    const parts = reference.split('_')
    if (parts.length < 5 || parts[0] !== 'TABOO') {
      return NextResponse.json({ error: 'Reference inválido' }, { status: 400 })
    }

    const telegramId = parts[1]
    const packageType = parts[2]
    const packageIndex = parseInt(parts[3], 10)

    if (telegramId !== tidFromAuth) {
      console.warn('[check-crypto-payment] Reference no coincide:', {
        telegramId,
        tidFromAuth,
      })
      return NextResponse.json(
        { error: 'Reference no coincide con la sesión' },
        { status: 403 }
      )
    }

    // ✅ Determinar qué paquete buscar
    const isMessages = packageType === 'messages'
    const isHybrid = packageType === 'hybrid'
    const activePackages = isHybrid 
      ? HYBRID_PACKAGES 
      : (isMessages ? MESSAGE_PACKAGES : CRYPTO_PACKAGES)

    if (
      isNaN(packageIndex) ||
      packageIndex >= activePackages.length ||
      packageIndex < 0
    ) {
      return NextResponse.json({ error: 'Package index inválido' }, { status: 400 })
    }

    // ─── Idempotencia por reference ───
    const existing = await getPurchaseByChargeId(reference)
    if (existing) {
      const u = await getUser(telegramId)
      return NextResponse.json({
        status: 'paid',
        already: true,
        remaining_gems: u?.gems || 0,
        remaining_purchased_gems: u?.purchased_gems || 0,
        remaining_bonus_gems: u?.bonus_gems || 0,
      })
    }

    // ─── Consultar TonAPI ───
    const url = `https://tonapi.io/v2/accounts/${RECIPIENT_WALLET}/events?limit=100`
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (TONAPI_KEY) headers['Authorization'] = `Bearer ${TONAPI_KEY}`

    const res = await fetch(url, { headers, cache: 'no-store' })

    if (!res.ok) {
      console.warn('[check-crypto-payment] TonAPI error:', res.status)
      return NextResponse.json({ status: 'pending', reason: 'tonapi_error' })
    }

    const data = await res.json()
    const events = data.events || []

    let matchedAction: any = null

    for (const ev of events) {
      for (const action of ev.actions || []) {
        if (action.type !== 'JettonTransfer') continue
        const jt = action.JettonTransfer
        if (!jt) continue

        if (jt.comment === reference) {
          if (jt.jetton?.address === USDT_MASTER) {
            matchedAction = jt
            break
          }
        }
      }
      if (matchedAction) break
    }

    if (!matchedAction) {
      return NextResponse.json({ status: 'pending' })
    }

    const pkg = activePackages[packageIndex]
    const expectedUnits = Math.round(pkg.usdt * 1_000_000)
    const receivedUnits = parseInt(matchedAction.amount || '0', 10)

    if (receivedUnits < expectedUnits - 1000) {
      return NextResponse.json({ status: 'pending', reason: 'amount_mismatch' })
    }

    // ─── first_time_only: verificar que no tenga compras previas ───
    if (pkg.first_time_only) {
      const prev = await queryOne<{ id: number }>(
        `SELECT id FROM star_purchases WHERE telegram_id = ? LIMIT 1`,
        [telegramId]
      )
      if (prev) {
        console.error('[check-crypto-payment] ❌ first_time_used:', { telegramId, reference })
        return NextResponse.json({ status: 'error', reason: 'first_time_used' })
      }
    }

    const user = await getUser(telegramId)
    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    // ✅ Calcular cuánto entregar (Gemas y Mensajes por separado)
    let gemsToAdd = 0
    let messagesToAdd = 0

    if (isHybrid) {
      gemsToAdd = (pkg as any).crypto_final_gems
      messagesToAdd = (pkg as any).crypto_final_messages
    } else if (isMessages) {
      messagesToAdd = (pkg as any).messages
    } else {
      gemsToAdd = getFinalCryptoGems(pkg as any)
    }

    // ✅ Equivalente en gemas para la comisión (basado en el valor USD total)
    const commissionBase = isHybrid 
      ? Math.floor((pkg as any).usdt * 120) 
      : (isMessages ? Math.floor((pkg as any).usdt * 120) : gemsToAdd)

    // ─── Insertar purchase (con UNIQUE constraint anti-doble) ───
    const inserted = await insertStarPurchase({
      telegram_id: telegramId,
      stars_amount: 0,
      gems_amount: isHybrid ? gemsToAdd : (isMessages ? 0 : gemsToAdd),
      is_first_purchase: pkg.first_time_only || false,
      telegram_charge_id: reference,
      payment_method: isHybrid ? 'crypto_hybrid' : (isMessages ? 'crypto_messages' : 'crypto'),
    })

    if (!inserted) {
      // Race: ya se procesó en otra request concurrente
      console.log('[check-crypto-payment] Charge ya procesado, ignorando')
      const u = await getUser(telegramId)
      return NextResponse.json({
        status: 'paid',
        already: true,
        remaining_gems: u?.gems || 0,
        remaining_purchased_gems: u?.purchased_gems || 0,
        remaining_bonus_gems: u?.bonus_gems || 0,
      })
    }

    // ─── Acreditar saldo ───
    let newGems = user.gems || 0
    let newPurchasedGems = user.purchased_gems || 0
    let newBonusGems = user.bonus_gems || 0

    if (isHybrid) {
      // 1. Entregar Gemas de Pago
      if (gemsToAdd > 0) {
        const rpcGems = await incrementGemsAndPurchased(telegramId, gemsToAdd)
        newGems = rpcGems.new_gems
        newPurchasedGems = rpcGems.new_purchased
      }
      
      // 2. Entregar Mensajes de Chat
      if (messagesToAdd > 0) {
        const rpcMessages = await queryOne<{ bonus_gems: number }>(
          `UPDATE users 
           SET bonus_gems = COALESCE(bonus_gems, 0) + ?, 
               hook_messages_remaining = 0,
               updated_at = datetime('now')
           WHERE telegram_id = ? 
           RETURNING bonus_gems`,
          [messagesToAdd, telegramId]
        )
        newBonusGems = rpcMessages?.bonus_gems ?? newBonusGems
      }
    } else if (isMessages) {
      // Entregar Mensajes (bonus_gems)
      const rpc = await queryOne<{ bonus_gems: number }>(
        `UPDATE users 
         SET bonus_gems = COALESCE(bonus_gems, 0) + ?, 
             hook_messages_remaining = 0,
             updated_at = datetime('now')
         WHERE telegram_id = ? 
         RETURNING bonus_gems`,
        [messagesToAdd, telegramId]
      )
      newBonusGems = rpc?.bonus_gems ?? newBonusGems
    } else {
      // Entregar Gemas (gems + purchased_gems)
      const rpc = await incrementGemsAndPurchased(telegramId, gemsToAdd)
      newGems = rpc.new_gems
      newPurchasedGems = rpc.new_purchased
    }

    // ─── Registrar transacción ───
    let txAmount = isMessages ? messagesToAdd : gemsToAdd
    let txType = isHybrid ? 'crypto_purchase_hybrid' : (isMessages ? 'crypto_purchase_messages' : 'crypto_purchase')
    let txDesc = isHybrid 
      ? `Compra crypto Híbrida ${pkg.usdt} USDT (${reference})`
      : `Compra crypto ${pkg.usdt} USDT (${reference})`

    await insertGemTransaction({
      telegram_id: telegramId,
      amount: txAmount,
      transaction_type: txType,
      description: txDesc,
    })

    // ─── Pagar comisión al referidor ───
    await payReferralCommission(telegramId, commissionBase, 'crypto', reference)

    return NextResponse.json({
      status: 'paid',
      amount_added: isMessages ? messagesToAdd : gemsToAdd,
      gems_added: gemsToAdd,
      messages_added: messagesToAdd,
      is_messages: isMessages,
      is_hybrid: isHybrid,
      remaining_gems: newGems,
      remaining_purchased_gems: newPurchasedGems,
      remaining_bonus_gems: newBonusGems,
    })
  } catch (e: any) {
    console.error('[check-crypto-payment] Error:', e)
    return NextResponse.json(
      { error: e?.message || 'Error interno' },
      { status: 500 }
    )
  }
}
