import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

function generateReferralCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

export async function POST(request: Request) {
  try {
    const { telegram_id, first_name, username, language } = await request.json()
    const tid = String(telegram_id)

    if (!tid || tid === 'undefined') {
      return NextResponse.json({ error: 'telegram_id requerido' }, { status: 400 })
    }

    // Verificar si ya existe
    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('telegram_id', tid)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ user: existing, created: false })
    }

    // Crear usuario nuevo
    const referralCode = generateReferralCode()
    const { data: created, error } = await supabaseAdmin
      .from('users')
      .insert({
        telegram_id: tid,
        first_name: first_name || 'User',
        username: username || null,
        language: language === 'en' ? 'en' : 'es',
        gems: 15,
        referral_code: referralCode,
        total_referrals: 0,
        hook_messages_remaining: 0,
      })
      .select()
      .single()

    if (error) {
      // Race condition: otro request lo creó primero
      if (error.code === '23505') {
        const { data: retry } = await supabaseAdmin
          .from('users')
          .select('*')
          .eq('telegram_id', tid)
          .maybeSingle()
        if (retry) {
          return NextResponse.json({ user: retry, created: false })
        }
      }
      console.error('Error creando usuario:', error)
      return NextResponse.json({ error: 'Error creando usuario' }, { status: 500 })
    }

    return NextResponse.json({ user: created, created: true })
  } catch (e: any) {
    console.error('Error en init-user:', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}