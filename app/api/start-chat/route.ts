// app/api/start-chat/route.ts

import { NextResponse } from 'next/server'
import {
  ensureUser,
  getCharacter,
  hasAnyMessage,
  insertMessage,
  insertGemTransaction,
  getActiveSubscription, // ✅ IMPORTAMOS ESTO
} from '@/lib/db-queries'
import { queryOne } from '@/lib/turso' 
import { OPENING_LINES, GEM_COSTS, isVipArchetype } from '@/lib/constants' // ✅ IMPORTAMOS isVipArchetype

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

    // ✅ BUG FIX VIP: Bloquear el inicio de chat si el personaje es VIP y el usuario no lo es
    const vipSub = await getActiveSubscription(tid)
    const isVip = !!vipSub

    if (isVipArchetype(character.archetype) && !isVip) {
      return NextResponse.json({ 
        blocked: true, 
        vip_expired: true,
        response: 'Este personaje es exclusivo VIP. Renueva tu suscripción para hablar con él.' 
      }, { status: 403 })
    }

    // 🛡️ FIX CRÍTICO: COBRO ATÓMICO Y VERIFICACIÓN EN UN SOLO PASO
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
      const alreadyStarted = await hasAnyMessage(tid, character_id)
      if (alreadyStarted) {
        return NextResponse.json({ already_started: true })
      }
      return NextResponse.json({
        blocked: true,
        response: '',
        remaining_gems: user.gems || 0,
      })
    }

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

    const insertedMsg = await insertMessage({
      telegram_id: tid,
      character_id,
      role: 'assistant',
      content: openingMessage,
    })

    return NextResponse.json({
      response: openingMessage,
      assistant_message_id: insertedMsg?.id,
      remaining_gems: charged.gems,
    })
  } catch (e: any) {
    console.error('Error en start-chat:', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
