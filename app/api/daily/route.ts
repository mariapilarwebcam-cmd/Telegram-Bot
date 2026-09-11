import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { BASE_DAILY_GEMS, GEMS_PER_REFERRAL, MAX_REFERRALS_PER_DAY } from '@/lib/constants'

const HOURS = 24

export async function POST(request: Request) {
  try {
    const { telegram_id } = await request.json()
    const tid = String(telegram_id)

    const { data: user } = await supabase
      .from('users')
      .select('gems, language, last_daily_claim')
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!user) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })

    if (user.last_daily_claim) {
      const diffH = (Date.now() - new Date(user.last_daily_claim).getTime()) / 3_600_000
      if (diffH < HOURS) {
        return NextResponse.json({
          error: user.language === 'en'
            ? `Come back in ${Math.ceil(HOURS - diffH)}h`
            : `Vuelve en ${Math.ceil(HOURS - diffH)}h`
        }, { status: 429 })
      }
    }

    const { data: referrals } = await supabase
      .from('referrals')
      .select('created_at')
      .eq('referrer_id', tid)

    const cutoff = Date.now() - 24 * 3_600_000
    const activeReferrals = (referrals || []).filter(
      (r: any) => new Date(r.created_at).getTime() >= cutoff
    ).length

    const cappedReferrals = Math.min(activeReferrals, MAX_REFERRALS_PER_DAY)
    const bonus = cappedReferrals * GEMS_PER_REFERRAL
    const dailyTotal = BASE_DAILY_GEMS + bonus
    const newGems = user.gems + dailyTotal

    await supabase.from('users').update({
      gems: newGems,
      last_daily_claim: new Date().toISOString(),
      bonus_gems_from_referrals: bonus,
      hook_messages_remaining: 0
    }).eq('telegram_id', tid)

    await supabase.from('gem_transactions').insert({
      telegram_id: tid,
      amount: dailyTotal,
      transaction_type: 'daily',
      description: `Diarias (base ${BASE_DAILY_GEMS} + ${bonus} referidos)`
    })

    return NextResponse.json({
      gems: newGems,
      claimed: dailyTotal,
      base: BASE_DAILY_GEMS,
      bonus
    })
  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}