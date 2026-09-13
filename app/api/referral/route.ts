import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { GEMS_PER_REFERRAL } from '@/lib/constants'

export async function POST(request: Request) {
  try {
    const { new_user_id, referral_code } = await request.json()
    const newTid = String(new_user_id)

    const { data: referrer } = await supabaseAdmin
      .from('users')
      .select('telegram_id, gems, total_referrals')
      .eq('referral_code', referral_code)
      .maybeSingle()

    if (!referrer) return NextResponse.json({ error: 'Código inválido' }, { status: 404 })
    if (String(referrer.telegram_id) === newTid) {
      return NextResponse.json({ error: 'No puedes referirte a ti mismo' }, { status: 400 })
    }

    const { data: existing } = await supabaseAdmin
      .from('referrals')
      .select('id')
      .eq('referred_id', newTid)
      .maybeSingle()

    if (existing) return NextResponse.json({ ok: true, already: true })

    await supabaseAdmin.from('referrals').insert({
      referrer_id: String(referrer.telegram_id),
      referred_id: newTid
    })

    // ✅ CORRECTO: Sumar gemas AL REFERENTE
    const referrerNewGems = (referrer.gems || 0) + GEMS_PER_REFERRAL
    await supabaseAdmin.from('users').update({
      gems: referrerNewGems,
      total_referrals: (referrer.total_referrals || 0) + 1
    }).eq('telegram_id', String(referrer.telegram_id))

    // Marcar al nuevo usuario como referido
    await supabaseAdmin.from('users').update({
      referred_by: String(referrer.telegram_id)
    }).eq('telegram_id', newTid)

    await supabaseAdmin.from('gem_transactions').insert({
      telegram_id: String(referrer.telegram_id),
      amount: GEMS_PER_REFERRAL,
      transaction_type: 'referral',
      description: 'Nuevo referido'
    })

    return NextResponse.json({ ok: true, referrer_gems: referrerNewGems })
  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
