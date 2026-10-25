// app/api/react/route.ts
import { NextResponse } from 'next/server'
import { execute, queryOne } from '@/lib/turso'

const STOP_WORDS = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'y', 'o', 'de', 'en', 'que', 'es', 'por', 'para', 'con', 'no', 'si', 'me', 'te', 'se', 'lo', 'mi', 'tu', 'su', 'al', 'del', 'como', 'mas', 'pero'])

const ALLOWED_REACTIONS = ['❤️', '🔥', '😈', '💦', '🍆', '🍑', '🥵', '💋']

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { message_id, reaction } = await request.json()

    // 1. VALIDACIONES
    if (!Number.isInteger(message_id)) {
      return NextResponse.json({ error: 'invalid_message_id' }, { status: 400 })
    }
    if (reaction !== null && !ALLOWED_REACTIONS.includes(reaction)) {
      return NextResponse.json({ error: 'invalid_reaction' }, { status: 400 })
    }

    // 2. GUARDAR LA REACCIÓN EN LA BASE DE DATOS (Lo nuevo)
    const updated = await execute(
      `UPDATE conversation_history 
       SET reaction = ? 
       WHERE id = ? AND telegram_id = ?`,
      [reaction, message_id, tid]
    )

    // Si rowsAffected es 0, el mensaje no existe o no le pertenece al usuario
    if (updated.rowsAffected === 0) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    // 3. MANTENER TU LÓGICA DE APRENDIZAJE (Lo original)
    // Reacciones positivas
    const hotReactions = ['❤️', '🔥', '😍', '🥵', '💦']
    const isPositive = hotReactions.includes(reaction)

    if (isPositive) {
      // Como el frontend ya no envía el texto, lo buscamos en la base de datos
      const msg = await queryOne<{ content: string }>(
        `SELECT content FROM conversation_history WHERE id = ? AND telegram_id = ?`,
        [message_id, tid]
      )

      if (msg && msg.content) {
        const text = String(msg.content).toLowerCase()
        const words = text.replace(/[^\w\sáéíóúñ]/g, '').split(/\s+/)
        const uniqueWords = Array.from(new Set(words)).filter(w => w.length > 2 && !STOP_WORDS.has(w)).slice(0, 5)

        for (const word of uniqueWords) {
          await execute(
            `INSERT INTO learned_triggers (word, type, weight) VALUES (?, 'heat', 2)
             ON CONFLICT(word, type) DO UPDATE SET weight = weight + 2`,
            [word]
          )
        }
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('[react] error:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
