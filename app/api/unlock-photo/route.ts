// app/api/unlock-photo/route.ts
import { NextResponse } from 'next/server'
import { queryOne, execute } from '@/lib/turso'
import { insertGemTransaction } from '@/lib/db-queries'

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { photo_id } = await request.json()
    if (!photo_id) return NextResponse.json({ error: 'Falta photo_id' }, { status: 400 })

    const photo = await queryOne<any>(
      `SELECT id, telegram_id, unlock_price, image_url, status, expires_at FROM locked_photos WHERE id = ? LIMIT 1`,
      [photo_id]
    )

    if (!photo) return NextResponse.json({ error: 'Foto no encontrada' }, { status: 404 })
    if (photo.telegram_id !== tid) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    if (photo.status === 'unlocked') return NextResponse.json({ error: 'already_unlocked', image_url: photo.image_url }, { status: 400 })
    if (photo.status === 'expired' || (photo.expires_at && new Date(photo.expires_at) < new Date())) {
      return NextResponse.json({ error: 'expired' }, { status: 410 })
    }

    // 🛡️ SI ES GRATIS (PRECIO 0), NO COBRAMOS GEMAS
    if (photo.unlock_price > 0) {
      const user = await queryOne<{ purchased_gems: number }>(
        `UPDATE users SET purchased_gems = purchased_gems - ? WHERE telegram_id = ? AND purchased_gems >= ? RETURNING purchased_gems`,
        [photo.unlock_price, tid, photo.unlock_price]
      )

      if (!user) {
        return NextResponse.json({ error: 'insufficient_gems', required: photo.unlock_price }, { status: 402 })
      }

      await insertGemTransaction({
        telegram_id: tid,
        amount: -photo.unlock_price,
        transaction_type: 'unlock_photo',
        description: `Desbloqueo de foto premium (ID: ${photo.id})`,
      })
    }

    // Marcar como desbloqueada (sea gratis o pagada)
    await execute(`UPDATE locked_photos SET status = 'unlocked' WHERE id = ?`, [photo.id])

    return NextResponse.json({
      success: true,
      image_url: photo.image_url,
      is_free: photo.unlock_price === 0
    })

  } catch (error: any) {
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
