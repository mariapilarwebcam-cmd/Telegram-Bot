// app/api/unlock-photo/route.ts
import { NextResponse } from 'next/server'
import { queryOne, query, execute, transaction } from '@/lib/turso'
import { insertGemTransaction, getRecentMessages } from '@/lib/db-queries'

const STOP_WORDS = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'y', 'o', 'de', 'en', 'que', 'es', 'por', 'para', 'con', 'no', 'si', 'me', 'te', 'se', 'lo', 'mi', 'tu', 'su', 'al', 'del', 'como', 'mas', 'pero'])

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { photo_id } = await request.json()
    if (!photo_id) return NextResponse.json({ error: 'Falta photo_id' }, { status: 400 })

    const photo = await queryOne<any>(
      `SELECT id, telegram_id, character_id, unlock_price, image_url, status, expires_at 
       FROM locked_photos WHERE id = ? LIMIT 1`,
      [photo_id]
    )

    if (!photo) return NextResponse.json({ error: 'Foto no encontrada' }, { status: 404 })
    if (photo.telegram_id !== tid) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    if (photo.status === 'unlocked') return NextResponse.json({ error: 'already_unlocked', image_url: photo.image_url }, { status: 400 })
    if (photo.status === 'expired' || (photo.expires_at && new Date(photo.expires_at) < new Date())) {
      return NextResponse.json({ error: 'expired' }, { status: 410 })
    }

    // 🛡️ FIX 1: COBRO ATÓMICO (Evita el doble clic)
    // Solo resta las gemas si el usuario tiene suficientes
    const user = await queryOne<{ purchased_gems: number }>(
      `UPDATE users 
       SET purchased_gems = purchased_gems - ? 
       WHERE telegram_id = ? AND purchased_gems >= ?
       RETURNING purchased_gems`,
      [photo.unlock_price, tid, photo.unlock_price]
    )

    if (!user) {
      // Si user es null, es porque el UPDATE no afectó a ninguna fila (no tenía saldo)
      return NextResponse.json({ error: 'insufficient_gems', required: photo.unlock_price }, { status: 402 })
    }

    // 2. Bloquear la foto para que no se pueda volver a comprar
    await execute(`UPDATE locked_photos SET status = 'unlocked' WHERE id = ?`, [photo.id])
    
    await insertGemTransaction({
      telegram_id: tid,
      amount: -photo.unlock_price,
      transaction_type: 'unlock_photo',
      description: `Desbloqueo de foto premium (ID: ${photo.id})`,
    })

    // 🛡️ FIX 2: APRENDIZAJE LIMITADO (Evita colapso de DB)
    try {
      const recentMsgs = await getRecentMessages(tid, photo.character_id, 3)
      const userText = recentMsgs
        .filter((m: any) => m.role === 'user')
        .map((m: any) => m.content.toLowerCase())
        .join(' ')

      const words = userText.replace(/[^\w\sáéíóúñ]/g, '').split(/\s+/)
      const uniqueWords = Array.from(new Set(words))
        .filter(w => w.length > 2 && !STOP_WORDS.has(w))
        .slice(0, 5) // ✅ Límite de 5 palabras por compra

      if (uniqueWords.length > 0) {
        // Usamos un batch para hacer los inserts en una sola petición a Turso
        const stmts = uniqueWords.map(word => ({
          sql: `INSERT INTO learned_triggers (word, type, weight) VALUES (?, 'purchase', 1)
                ON CONFLICT(word, type) DO UPDATE SET weight = weight + 1`,
          args: [word]
        }))
        await transaction(stmts)
        console.log(`[AI Learn] 🧠 Aprendido de compra: ${uniqueWords.join(', ')}`)
      }
    } catch (learnError) {
      console.warn('[AI Learn] Error aprendiendo:', learnError)
    }

    return NextResponse.json({
      success: true,
      image_url: photo.image_url,
      remaining_purchased_gems: user.purchased_gems,
    })

  } catch (error: any) {
    console.error('[unlock-photo] Error:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
