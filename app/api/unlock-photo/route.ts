// app/api/unlock-photo/route.ts
import { NextResponse } from 'next/server'
import { unlockOffer, HttpError } from '@/lib/unlock-engine'

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { offer_id } = await request.json()
    if (!offer_id) return NextResponse.json({ error: 'Falta offer_id' }, { status: 400 })

    const result = await unlockOffer(tid, offer_id)

    // Generamos la URL pública de la imagen original
    const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || ''
    const imageUrl = `${base.replace(/\/$/, '')}/${result.r2_key}`

    return NextResponse.json({
      success: true,
      image_url: imageUrl,
      already_unlocked: result.already_unlocked,
      paid_with: result.paid_with
    })

  } catch (error: any) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.code }, { status: error.status })
    }
    console.error('[unlock-photo] error:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
