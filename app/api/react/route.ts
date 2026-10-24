// app/api/react/route.ts
import { NextResponse } from 'next/server'
import { execute } from '@/lib/turso'

const STOP_WORDS = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'y', 'o', 'de', 'en', 'que', 'es', 'por', 'para', 'con', 'no', 'si', 'me', 'te', 'se', 'lo', 'mi', 'tu', 'su', 'al', 'del', 'como', 'mas', 'pero'])

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { message_content, reaction } = await request.json()

    // Reacciones positivas y negativas
    const hotReactions = ['❤️', '🔥', '😍', '🥵', '💦']
    const isPositive = hotReactions.includes(reaction)

    if (isPositive && message_content) {
      // El bot aprende de lo que al usuario le gustó
      const text = String(message_content).toLowerCase()
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

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}