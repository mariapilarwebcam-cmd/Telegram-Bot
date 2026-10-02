// app/api/check-crypto-payment/route.ts

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
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

async function payReferralCommission(
  buyerTid: string,
  gemsPurchased: number,
  source: string,
  reference: string
): Promise<void> {
  try {
    const { data: buyer } = await supabaseAdmin
      .from('users')
      .select('referred_by')
      .eq('telegram_id', buyerTid)
      .maybeSingle()

    if (!buyer?.referred_by) return

    const referrerId = String(buyer.referred_by)

    const { data: referrer } = await supabaseAdmin
      .from('users')
      .select('gems, language, paying_referrals_count')
      .eq('telegram_id', referrerId)
      .maybeSingle()

    if (!referrer) return

    const { data: existingCommissions } = await supabaseAdmin
      .from('referral_commissions')
      .select('referred_id')
      .eq('referrer_id', referrerId)

    const uniqueBuyers = new Set<string>()
    for (const row of existingCommissions || []) {
      uniqueBuyers.add(String(row.referred_id))
    }
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

    const newGems = (referrer.gems || 0) + commission

    // ✅ Comisión → SOLO gems (no purchased_gems)
    await supabaseAdmin
      .from('users')
      .update({
        gems: newGems,
        paying_referrals_count: totalUnique,
      })
      .eq('telegram_id', referrerId)

    await supabaseAdmin.from('gem_transactions').insert({
      telegram_id: referrerId,
      amount: commission,
      transaction_type: 'referral_commission',
      description: `Comisión ${pct}% por compra de referido`,
    })

    await supabaseAdmin.from('referral_commissions').insert({
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

export async function POST(request: Request) {
  try {
    const tidFromAuth = request.headers.get('x-telegram-id-validated')
    if (!tidFromAuth) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { reference } = await request.json()
    if (!reference || typeof reference !== 'string') {
      return NextResponse.json({ error: 'Reference requerido' }, { status: 400 })
    }

    const parts = reference.split('_')
    if (parts.length < 4 || parts[0] !== 'TABOO') {
      return NextResponse.json({ error: 'Reference inválido' }, { status: 400 })
    }

    const telegramId = parts[1]
    const packageIndex = parseInt(parts[2])

    if (telegramId !== tidFromAuth) {
      console.warn('[check-crypto-payment] Reference no coincide:', { telegramId, tidFromAuth })
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

    const { data: existing } = await supabaseAdmin
      .from('star_purchases')
      .select('id')
      .eq('telegram_id', telegramId)
      .eq('telegram_charge_id', reference)
      .maybeSingle()

    if (existing) {
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('gems, purchased_gems')
        .eq('telegram_id', telegramId)
        .maybeSingle()
      return NextResponse.json({
        status: 'paid',
        already: true,
        remaining_gems: user?.gems || 0,
        remaining_purchased_gems: user?.purchased_gems || 0,
      })
    }

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

    let matchedEvent: any = null
    let matchedAction: any = null

    for (const ev of events) {
      for (const action of ev.actions || []) {
        if (action.type !== 'JettonTransfer') continue
        const jt = action.JettonTransfer
        if (!jt) continue

        if (jt.comment === reference) {
          if (jt.jetton?.address === USDT_MASTER) {
            matchedEvent = ev
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
    const receivedUnits = parseInt(matchedAction.amount || '0')

    if (receivedUnits < expectedUnits - 1000) {
      return NextResponse.json({ status: 'pending', reason: 'amount_mismatch' })
    }

    if (pkg.first_time_only) {
      const { data: priorPurchases } = await supabaseAdmin
        .from('star_purchases')
        .select('id')
        .eq('telegram_id', telegramId)
        .limit(1)
      if (priorPurchases && priorPurchases.length > 0) {
        return NextResponse.json({ status: 'pending', reason: 'first_time_used' })
      }
    }

    const gemsToAdd = getFinalCryptoGems(pkg)

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('gems, purchased_gems')
      .eq('telegram_id', telegramId)
      .maybeSingle()

    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    // ✅ Sumar a gems Y purchased_gems
    const newGems = (user.gems || 0) + gemsToAdd
    const newPurchasedGems = (user.purchased_gems || 0) + gemsToAdd

    await supabaseAdmin
      .from('users')
      .update({
        gems: newGems,
        purchased_gems: newPurchasedGems,
        hook_messages_remaining: 0,
      })
      .eq('telegram_id', telegramId)

    await supabaseAdmin.from('gem_transactions').insert({
      telegram_id: telegramId,
      amount: gemsToAdd,
      transaction_type: 'crypto_purchase',
      description: `Compra crypto ${pkg.usdt} USDT (${reference})`,
    })

    await supabaseAdmin.from('star_purchases').insert({
      telegram_id: telegramId,
      stars_amount: 0,
      gems_amount: gemsToAdd,
      is_first_purchase: pkg.first_time_only || false,
      telegram_charge_id: reference,
      payment_method: 'crypto',
    })

    await payReferralCommission(telegramId, gemsToAdd, 'crypto', reference)

    return NextResponse.json({
      status: 'paid',
      gems_added: gemsToAdd,
      remaining_gems: newGems,
      remaining_purchased_gems: newPurchasedGems,
    })
  } catch (e: any) {
    console.error('[check-crypto-payment] Error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
