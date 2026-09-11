import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { GEMS_PER_REFERRAL } from '@/lib/constants'

export async function POST(request: Request) {
  try {
    const { new_user_id, referral_code } = await request.json()
    const newTid = String(new_user_id)

    const { data: referrer } = await supabase
      .from('users')
      .select('telegram_id, gems, total_referrals')
      .eq('referral_code', referral_code)
      .maybeSingle()

    if (!referrer) return NextResponse.json({ error: 'Código inválido' }, { status: 404 })
    if (referrer.telegram_id === newTid) {
      return NextResponse.json({ error: 'No puedes referirte a ti mismo' }, { status: 400 })
    }

    const { data: existing } = await supabase
      .from('referrals')
      .select('id')
      .eq('referred_id', newTid)
      .maybeSingle()

    if (existing) return NextResponse.json({ ok: true, already: true })

    await supabase.from('referrals').insert({
      referrer_id: referrer.telegram_id,
      referred_id: newTid
    })

    const newGems = referrer.gems + GEMS_PER_REFERRAL
    await supabase.from('users').update({
      gems: newGems,
      total_referrals: (referrer.total_referrals || 0) + 1,
      referred_by: referrer.telegram_id
    }).eq('telegram_id', newTid)

    await supabase.from('gem_transactions').insert({
      telegram_id: referrer.telegram_id,
      amount: GEMS_PER_REFERRAL,
      transaction_type: 'referral',
      description: 'Nuevo referido'
    })

    return NextResponse.json({ ok: true, referrer_gems: newGems })
  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}