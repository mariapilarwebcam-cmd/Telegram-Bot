// app/api/unlock-photo/route.ts
import { NextResponse } from 'next/server'
import { unlockOffer, HttpError } from '@/lib/unlock-engine'
import { authenticateTelegramRequest } from '@/lib/telegram-auth'

export async function POST(request: Request) {
  let tid: string

  try {
    const authentication = await authenticateTelegramRequest(request)

    if (authentication.ok === false) {
      return NextResponse.json(
        { error: authentication.error },
        { status: authentication.status }
      )
    }

    tid = authentication.telegramId
  } catch {
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }

  try {
    // ✅ FIX #2: Manejo seguro del parseo del JSON
    const body = await request.json().catch(() => ({}))
    const rawOfferId = body?.offer_id

    // ✅ FIX #1: Validar que offer_id sea un número válido
    const offer_id = Number(rawOfferId)
    if (!rawOfferId || isNaN(offer_id) || offer_id <= 0) {
      return NextResponse.json({ error: 'offer_id inválido o faltante' }, { status: 400 })
    }

    const result = await unlockOffer(tid, offer_id)

    // ✅ FIX #3: Construir la URL pública de forma robusta
    // Si r2_key ya es una URL absoluta, no le añadimos la base.
    const base = (process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '').replace(/\/$/, '')
    const imageUrl = result.r2_key.startsWith('http')
      ? result.r2_key
      : `${base}/${result.r2_key}`

    return NextResponse.json({
      success: true,
      image_url: imageUrl,
      already_unlocked: result.already_unlocked,
      paid_with: result.paid_with,
    })

  } catch (error: any) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }
    console.error('[unlock-photo] error:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
