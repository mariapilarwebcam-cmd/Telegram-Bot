// app/api/referral/route.ts

import { NextResponse } from 'next/server'
import {
  getUserByUsernameOrCode,
  getReferralByReferred,
  insertReferral,
  setReferredBy,
} from '@/lib/db-queries'

export async function POST(request: Request) {
  try {
    const newTid = request.headers.get('x-telegram-id-validated')
    if (!newTid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const code = String(body.referral_code || '').replace('@', '').trim()

    if (!code) {
      return NextResponse.json({ error: 'Código inválido' }, { status: 400 })
    }

    // Buscar referente por username o referral_code
    const referrer = await getUserByUsernameOrCode(code)
    if (!referrer) {
      return NextResponse.json({ error: 'Código inválido' }, { status: 404 })
    }

    if (String(referrer.telegram_id) === newTid) {
      return NextResponse.json(
        { error: 'No puedes referirte a ti mismo' },
        { status: 400 }
      )
    }

    // ¿Ya está referido?
    const existing = await getReferralByReferred(newTid)
    if (existing) {
      return NextResponse.json({
        ok: true,
        already: true,
        paid: !!existing.reward_paid,
      })
    }

    // Crear referral PENDIENTE
    await insertReferral({
      referrer_id: String(referrer.telegram_id),
      referred_id: newTid,
    })

    // Marcar al nuevo usuario como referido
    await setReferredBy(newTid, String(referrer.telegram_id))

    return NextResponse.json({
      ok: true,
      pending: true,
      message: 'Referido registrado. Se pagará cuando envíe 3 mensajes.',
    })
  } catch (e: any) {
    console.error('Error en referral:', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
