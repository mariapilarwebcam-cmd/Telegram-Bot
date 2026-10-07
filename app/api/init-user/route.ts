// app/api/init-user/route.ts

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ensureUser } from '@/lib/user-helpers'

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
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { first_name, username, language } = await request.json()

    // ✅ Usa ensureUser — crea si no existe, con TODOS los campos
    const user = await ensureUser(tid, {
      first_name,
      username,
      language: language === 'en' ? 'en' : 'es',
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Error creando usuario' },
        { status: 500 }
      )
    }

    const wasExisting = user.referral_code != null  // siempre true tras crear
    return NextResponse.json({
      user,
      created: !wasExisting ? true : false,
    })
  } catch (e: any) {
    console.error('Error en init-user:', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
