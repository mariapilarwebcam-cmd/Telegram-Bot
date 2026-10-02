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

// ============================================================
// ✅ PAGAR COMISIÓN AL REFERIDOR
// Tiers basados en usuarios ÚNICOS que han comprado:
//   1-4  → 5%
//   5-19 → 7%
//   20+  → 10%
// ============================================================
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

    // Contar usuarios ÚNICOS que han comprado
    const { data: existingCommissions } = await supabaseAdmin
      .from('referral_commissions')
      .select('referred_id')
      .eq('referrer_id', referrerId)

    const uniqueBuyers = new Set<string>()
    for (const row of existingCommissions || []) {
      uniqueBuyers.add(String(row.referred_id))
    }
    // Añadir al comprador actual (si es su primera compra, sube el tier)
    uniqueBuyers.add(buyerTid)

    const totalUnique = uniqueBuyers.size

    // Determinar % según tier
    let pct = REFERRAL_PURCHASE_COMMISSION_PCT
    if (totalUnique >= REFERRAL_ELITE_TIER_THRESHOLD) {
      pct = REFERRAL_ELITE_TIER_PCT
    } else if (totalUnique >= REFERRAL_TOP_TIER_THRESHOLD) {
      pct = REFERRAL_TOP_TIER_PCT
    }

    const commission = Math.floor((gemsPurchased * pct) / 100)
    if (commission <= 0) return

    const newGems = (referrer.gems || 0) + commission

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

    await supabaseAdmin.from('
