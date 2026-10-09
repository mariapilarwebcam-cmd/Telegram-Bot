// app/api/check-crypto-payment/route.ts

import { NextResponse } from 'next/server'
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
// Comisión al referidor (migrado a Turso)
// ═══════════════════════════════════════════════════════════════
async function payReferralCommission(
  buyerTid: string,
  gemsPurchased: number,
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

    const commission = Math.floor((gemsPurchased * pct) / 100)
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
      purchase_gems: gemsPurchased,
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

    // Formato: TABOO_<telegram_id>_<package_index>_<timestamp>
    const parts = reference.split('_')
    if (parts.length < 4 || parts[0] !== 'TABOO') {
      return NextResponse.json({ error: 'Reference inválido' }, { status: 400 })
    }

    const telegramId = parts[1]
    const packageIndex = parseInt(parts[2], 10)

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

    if (
      isNaN(packageIndex) ||
      packageIndex >= CRYPTO_PACKAGES.length ||
      packageIndex < 0
    ) {
      return NextResponse.json({ error: 'Package index inválido' }, { status: 400 })
    }

    // ─── Idempotencia ───
    const existing = await getPurchaseByChargeId(reference)
    if (existing) {
      const u = await getUser(telegramId)
      return NextResponse.json({
        status: 'paid',
        already: true,
        remaining_gems: u?.gems || 0,
        remaining_purchased_gems: u?.purchased_gems || 0,
      })
    }

    // ─── Consultar TonAPI ───
    const url = `https://tonapi.io/v2/accounts/${RECIPIENT_WALLET}/events?limit=20`
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

    const pkg = CRYPTO_PACKAGES[packageIndex]
    const expectedUnits = Math.round(pkg.usdt * 1_000_000)
    const receivedUnits = parseInt(matchedAction.amount || '0', 10)

    if (receivedUnits < expectedUnits - 1000) {
      return NextResponse.json({ status: 'pending', reason: 'amount_mismatch' })
    }

    // ─── first_time_only ───
    if (pkg.first_time_only) {
      const prior = await getPurchaseByChargeId(reference)
      // Nota: `getPurchaseByChargeId` busca por charge_id, no sirve aquí.
      // Usamos un query directo vía db-queries (ya validamos con existing arriba,
      // así que si llega aquí es porque no hay compras previas de ESTE reference).
      // Para chequear compras previas reales, usar queryOne:
      const { queryOne } = await import('@/lib/turso')
      const prev = await queryOne<{ id: number }>(
        `SELECT id FROM star_purchases WHERE telegram_id = ? LIMIT 1`,
        [telegramId]
      )
      if (prev) {
        return NextResponse.json({ status: 'pending', reason: 'first_time_used' })
      }
    }

    const gemsToAdd = getFinalCryptoGems(pkg)

    const user = await getUser(telegramId)
    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    // ─── Insertar purchase (con UNIQUE constraint anti-doble) ───
    const inserted = await insertStarPurchase({
      telegram_id: telegramId,
      stars_amount: 0,
      gems_amount: gemsToAdd,
      is_first_purchase: pkg.first_time_only || false,
      telegram_charge_id: reference,
      payment_method: 'crypto',
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
      })
    }

    // ─── Acreditar gemas (atómico: gems + purchased_gems + reset hook) ───
    const rpc = await incrementGemsAndPurchased(telegramId, gemsToAdd)
    const newGems = rpc.new_gems
    const newPurchasedGems = rpc.new_purchased

    // ─── Registrar transacción ───
    await insertGemTransaction({
      telegram_id: telegramId,
      amount: gemsToAdd,
      transaction_type: 'crypto_purchase',
      description: `Compra crypto ${pkg.usdt} USDT (${reference})`,
    })

    // ─── Pagar comisión al referidor ───
    await payReferralCommission(telegramId, gemsToAdd, 'crypto', reference)

    return NextResponse.json({
      status: 'paid',
      gems_added: gemsToAdd,
      remaining_gems: newGems,
      remaining_purchased_gems: newPurchasedGems,
    })
  } catch (e: any) {
    console.error('[check-crypto-payment] Error:', e)
    return NextResponse.json(
      { error: e?.message || 'Error interno' },
      { status: 500 }
    )
  }
}
