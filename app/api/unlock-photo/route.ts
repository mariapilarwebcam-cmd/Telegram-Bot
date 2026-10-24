// app/api/unlock-photo/route.ts
import { NextResponse } from 'next/server'
import { queryOne, execute, decrementGemsAndPurchased, insertGemTransaction } from '@/lib/db-queries'

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { photo_id } = await request.json()
    if (!photo_id) {
      return NextResponse.json({ error: 'Falta photo_id' }, { status: 400 })
    }

    // 1. Buscar la foto
    const photo = await queryOne<{
      id: number
      telegram_id: string
      unlock_price: number
      image_url: string
      status: string
      expires_at: string
    }>(
      `SELECT id, telegram_id, unlock_price, image_url, status, expires_at 
       FROM locked_photos WHERE id = ? LIMIT 1`,
      [photo_id]
    )

    if (!photo) {
      return NextResponse.json({ error: 'Foto no encontrada' }, { status: 404 })
    }

    if (photo.telegram_id !== tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    if (photo.status === 'unlocked') {
      return NextResponse.json({ error: 'already_unlocked', image_url: photo.image_url }, { status: 400 })
    }

    if (photo.status === 'expired' || (photo.expires_at && new Date(photo.expires_at) < new Date())) {
      return NextResponse.json({ error: 'expired', message: 'Esta foto ya expiró' }, { status: 410 })
    }

    // 2. Verificar gemas (solo usamos purchased_gems para fotos premium)
    const user = await queryOne<{ purchased_gems: number }>(
      `SELECT purchased_gems FROM users WHERE telegram_id = ? LIMIT 1`,
      [tid]
    )

    if (!user || user.purchased_gems < photo.unlock_price) {
      return NextResponse.json(
        { error: 'insufficient_gems', required: photo.unlock_price, available: user?.purchased_gems || 0 },
        { status: 402 }
      )
    }

    // 3. Cobrar y desbloquear (Transacción atómica)
    await decrementGemsAndPurchased(tid, photo.unlock_price)
    
    await execute(
      `UPDATE locked_photos SET status = 'unlocked' WHERE id = ?`,
      [photo.id]
    )

    await insertGemTransaction({
      telegram_id: tid,
      amount: -photo.unlock_price,
      transaction_type: 'unlock_photo',
      description: `Desbloqueo de foto premium (ID: ${photo.id})`,
    })

    // 4. Devolver la URL real de la imagen
    return NextResponse.json({
      success: true,
      image_url: photo.image_url,
      remaining_purchased_gems: user.purchased_gems - photo.unlock_price,
    })

  } catch (error: any) {
    console.error('[unlock-photo] Error:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}