import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: Request) {
  try {
    const { new_user_id, referral_code } = await request.json()
    const newTid = String(new_user_id)
    const code = String(referral_code || '').replace('@', '').trim()

    if (!code) return NextResponse.json({ error: 'Código inválido' }, { status: 400 })

    // Buscar referente por username O por referral_code
    let referrer: any = null

    const { data: byUsername } = await supabaseAdmin
      .from('users')
      .select('telegram_id, username, total_referrals')
      .ilike('username', code)
      .maybeSingle()

    if (byUsername) {
      referrer = byUsername
    } else {
      const { data: byCode } = await supabaseAdmin
        .from('users')
        .select('telegram_id, username, total_referrals')
        .eq('referral_code', code)
        .maybeSingle()
      referrer = byCode
    }

    if (!referrer) return NextResponse.json({ error: 'Código inválido' }, { status: 404 })
    if (String(referrer.telegram_id) === newTid) {
      return NextResponse.json({ error: 'No puedes referirte a ti mismo' }, { status: 400 })
    }

    const { data: existing } = await supabaseAdmin
      .from('referrals')
      .select('id, reward_paid')
      .eq('referred_id', newTid)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ ok: true, already: true, paid: existing.reward_paid })
    }

    // Crear referral PENDIENTE
    await supabaseAdmin.from('referrals').insert({
      referrer_id: String(referrer.telegram_id),
      referred_id: newTid,
      reward_paid: false,
      referred_message_count: 0,
    })

    await supabaseAdmin
      .from('users')
      .update({ referred_by: String(referrer.telegram_id) })
      .eq('telegram_id', newTid)

    return NextResponse.json({
      ok: true,
      pending: true,
      message: 'Referido registrado. Se pagará cuando envíe 3 mensajes.'
    })
  } catch (e: any) {
    console.error('Error en referral:', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
