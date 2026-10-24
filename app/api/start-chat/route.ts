// app/api/start-chat/route.ts

import { NextResponse } from 'next/server'
import {
  ensureUser,
  getCharacter,
  hasAnyMessage,
  insertMessage,
  insertGemTransaction,
} from '@/lib/db-queries'
import { queryOne } from '@/lib/turso' // ✅ Importamos queryOne para el UPDATE atómico
import { OPENING_LINES, GEM_COSTS } from '@/lib/constants'

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const character_id = body?.character_id

    const user = await ensureUser(tid)
    if (!user) {
      return NextResponse.json({ error: 'Error cargando tu cuenta' }, { status: 500 })
    }

    const character = await getCharacter(character_id, tid)
    if (!character) {
      return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })
    }

    // 🛡️ FIX CRÍTICO: COBRO ATÓMICO Y VERIFICACIÓN EN UN SOLO PASO
    // Solo resta 1 gema SI el usuario tiene saldo Y NO tiene historial previo.
    const charged = await queryOne<{ gems: number }>(
      `UPDATE users
       SET gems = gems - ?
       WHERE telegram_id = ?
         AND gems >= ?
         AND NOT EXISTS (
           SELECT 1 FROM conversation_history WHERE telegram_id = ? AND character_id = ?
         )
       RETURNING gems`,
      [GEM_COSTS.message, tid, GEM_COSTS.message, tid, character_id]
    )

    if (!charged) {
      // Si falló el UPDATE, verificamos por qué para dar el mensaje correcto
      const alreadyStarted = await hasAnyMessage(tid, character_id)
      if (alreadyStarted) {
        return NextResponse.json({ already_started: true })
      }
      // Si no ha empezado, es porque no tiene gemas
      return NextResponse.json({
        blocked: true,
        response: '',
        remaining_gems: user.gems || 0,
      })
    }

    // El usuario ya fue cobrado exitosamente de forma segura
    await insertGemTransaction({
      telegram_id: tid,
      amount: -GEM_COSTS.message,
      transaction_type: 'message',
      description: 'Mensaje de apertura',
    })

    const lang = (user.language === 'en' ? 'en' : 'es') as 'es' | 'en'
    const openingTemplate = OPENING_LINES[character.archetype]
    const fallback =
      lang === 'es'
        ? `*{name} te mira al entrar y sonríe con intención*\n\n"Hola... estaba esperándote. ¿Qué te trae por aquí?"`
        : `*{name} looks at you as you enter and smiles with intent*\n\n"Hey... I was waiting for you. What brings you here?"`
    const template = openingTemplate ? openingTemplate[lang] : fallback
    const openingMessage = template.replace(/{name}/g, character.character_name)

    await insertMessage({
      telegram_id: tid,
      character_id,
      role: 'assistant',
      content: openingMessage,
    })

    return NextResponse.json({
      response: openingMessage,
      remaining_gems: charged.gems, // Usamos las gemas devueltas por la DB
    })
  } catch (e: any) {
    console.error('Error en start-chat:', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
