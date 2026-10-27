// app/api/start-chat/route.ts

import { NextResponse } from 'next/server'
import {
  ensureUser,
  getCharacter,
  hasAnyMessage,
  insertMessage,
  insertGemTransaction,
  getActiveSubscription,
} from '@/lib/db-queries'
import { queryOne } from '@/lib/turso' 
import { OPENING_LINES, GEM_COSTS, isVipArchetype } from '@/lib/constants'

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

    // 🛡️ Verificar si el chat ya fue iniciado para no cobrar doble
    const alreadyStarted = await hasAnyMessage(tid, character_id)
    if (alreadyStarted) {
      return NextResponse.json({ already_started: true })
    }

    let charged = false
    let newBonusGems = user.bonus_gems || 0
    let newGems = user.gems || 0
    let newHookRemaining = user.hook_messages_remaining || 0
    const lang = (user.language === 'en' ? 'en' : 'es') as 'es' | 'en'

    if (isVip) {
      // ✅ VIP no paga por iniciar el chat (tienen su límite diario)
      charged = true
    } else {
      // ✅ 1. Intentar cobrar 1 Mensaje (bonus_gems)
      const bonusResult = await queryOne<{ bonus_gems: number }>(
        `UPDATE users 
         SET bonus_gems = COALESCE(bonus_gems, 0) - ? 
         WHERE telegram_id = ? AND COALESCE(bonus_gems, 0) >= ? 
         RETURNING bonus_gems`,
        [GEM_COSTS.message, tid, GEM_COSTS.message]
      )

      if (bonusResult) {
        newBonusGems = bonusResult.bonus_gems
        charged = true
        await insertGemTransaction({
          telegram_id: tid,
          amount: -GEM_COSTS.message,
          transaction_type: 'message',
          description: 'Mensaje de apertura',
        })
      } else {
        // ✅ 2. Intentar usar el Hook Mode (mensajes gratis de bienvenida)
        const hookRemaining = user.hook_messages_remaining || 0
        if (hookRemaining > 0) {
          const hookResult = await queryOne<{ hook_messages_remaining: number }>(
            `UPDATE users 
             SET hook_messages_remaining = hook_messages_remaining - 1 
             WHERE telegram_id = ? AND hook_messages_remaining >= 1 
             RETURNING hook_messages_remaining`,
            [tid]
          )
          if (hookResult) {
            newHookRemaining = hookResult.hook_messages_remaining
            charged = true
          }
        }
      }
    }

    // 🚫 Si no hay mensajes ni hook, bloquear
    if (!charged) {
      return NextResponse.json({
        blocked: true,
        response: lang === 'es' ? 'Necesitas al menos 1 mensaje para empezar a chatear.' : 'You need at least 1 message to start chatting.',
        remaining_gems: newGems,
        remaining_bonus_gems: newBonusGems,
        hook_messages_remaining: newHookRemaining
      })
    }

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

    // Devolvemos los saldos actualizados para que el frontend los pinte
    return NextResponse.json({
      response: openingMessage,
      assistant_message_id: insertedMsg?.id,
      remaining_gems: newGems,
      remaining_bonus_gems: newBonusGems,
      hook_messages_remaining: newHookRemaining
    })
  } catch (e: any) {
    console.error('Error en start-chat:', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
