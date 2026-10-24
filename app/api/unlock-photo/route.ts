// app/api/unlock-photo/route.ts
import { NextResponse } from 'next/server'
import { queryOne, query, execute } from '@/lib/turso'
import { decrementGemsAndPurchased, insertGemTransaction, getRecentMessages } from '@/lib/db-queries'

// Lista de palabras vacías (stop words) que no aportan información
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

    const user = await queryOne<{ purchased_gems: number }>(
      `SELECT purchased_gems FROM users WHERE telegram_id = ? LIMIT 1`,
      [tid]
    )

    if (!user || user.purchased_gems < photo.unlock_price) {
      return NextResponse.json({ error: 'insufficient_gems', required: photo.unlock_price }, { status: 402 })
    }

    // 1. Cobrar y desbloquear
    await decrementGemsAndPurchased(tid, photo.unlock_price)
    await execute(`UPDATE locked_photos SET status = 'unlocked' WHERE id = ?`, [photo.id])
    await insertGemTransaction({
      telegram_id: tid,
      amount: -photo.unlock_price,
      transaction_type: 'unlock_photo',
      description: `Desbloqueo de foto premium (ID: ${photo.id})`,
    })

    // 2. 🧠 EL SISTEMA APRENDE: Analizamos los últimos mensajes del usuario
    try {
      const recentMsgs = await getRecentMessages(tid, photo.character_id, 3)
      const userText = recentMsgs
        .filter((m: any) => m.role === 'user')
        .map((m: any) => m.content.toLowerCase())
        .join(' ')

      // Extraemos las palabras y filtramos las que no sirven
      const words = userText.replace(/[^\w\sáéíóúñ]/g, '').split(/\s+/)
      const uniqueWords = Array.from(new Set(words)).filter(w => w.length > 2 && !STOP_WORDS.has(w))

      // Guardamos en la base de datos de aprendizaje
      for (const word of uniqueWords) {
        await execute(
          `INSERT INTO learned_triggers (word, weight) VALUES (?, 1)
           ON CONFLICT(word) DO UPDATE SET weight = weight + 1`,
          [word]
        )
      }
      console.log(`[AI Learn] 🧠 Sistema aprendió de la compra: ${uniqueWords.join(', ')}`)
    } catch (learnError) {
      console.warn('[AI Learn] No se pudo aprender del mensaje:', learnError)
    }

    return NextResponse.json({
      success: true,
      image_url: photo.image_url,
      remaining_purchased_gems: user.purchased_gems - photo.unlock_price,
    })

  } catch (error: any) {
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
