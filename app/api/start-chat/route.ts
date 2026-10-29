// app/api/start-chat/route.ts

import { NextResponse } from 'next/server'
import {
  ensureUser,
  getCharacter,
  getActiveSubscription,
  getActivePass,
  countVipMessagesToday,
} from '@/lib/db-queries'
import { db } from '@/lib/turso'
import {
  OPENING_LINES,
  GEM_COSTS,
  isVipArchetype,
  VIP_DAILY_MESSAGE_LIMIT,
} from '@/lib/constants'

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const character_id = body?.character_id

    if (!character_id || typeof character_id !== 'number') {
      return NextResponse.json({ error: 'character_id inválido' }, { status: 400 })
    }

    const user = await ensureUser(tid)
    if (!user) {
      return NextResponse.json({ error: 'Error cargando tu cuenta' }, { status: 500 })
    }

    const character = await getCharacter(character_id, tid)
    if (!character) {
      return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })
    }

    const vipSub = await getActiveSubscription(tid)
    const isVip = !!vipSub

    if (isVipArchetype(character.archetype) && !isVip) {
      return NextResponse.json(
        {
          blocked: true,
          vip_expired: true,
          response: 'Este personaje es exclusivo VIP. Renueva tu suscripción para hablar con él.',
        },
        { status: 403 }
      )
    }

    const activePass = await getActivePass(tid)
    const lang = (user.language === 'en' ? 'en' : 'es') as 'es' | 'en'

    // Construir el mensaje de apertura ANTES de la transacción (es JS puro, no toca BD)
    const openingTemplate = OPENING_LINES[character.archetype]
    const fallback =
      lang === 'es'
        ? `*{name} te mira al entrar y sonríe con intención*\n\n"Hola... estaba esperándote. ¿Qué te trae por aquí?"`
        : `*{name} looks at you as you enter and smiles with intent*\n\n"Hey... I was waiting for you. What brings you here?"`
    const template = openingTemplate ? openingTemplate[lang] : fallback
    const openingMessage = template.replace(/{name}/g, character.character_name)

    // ✅ Transacción atómica: verificación + cobro + insert ocurren juntos o no ocurren.
    const tx = await db.transaction('write')

    try {
      // 1. Verificar DENTRO de la transacción (evita race condition con doble request)
      const existing = await tx.execute({
        sql: `SELECT id FROM conversation_history WHERE telegram_id = ? AND character_id = ? LIMIT 1`,
        args: [tid, character_id],
      })

      if (existing.rows.length > 0) {
        await tx.rollback()
        return NextResponse.json({ already_started: true })
      }

      // 2. Determinar método de cobro
      let charged = false
      let newBonusGems = user.bonus_gems || 0
      let newGems = user.gems || 0
      let newHookRemaining = user.hook_messages_remaining || 0
      let paymentMode: 'vip_daily' | 'vip_bonus' | 'pass' | 'bonus_gems' | 'hook' | 'none' = 'none'

      if (isVip) {
        // ✅ FIX #1 (CRÍTICO): VIP consume cupo VIP diario. Si está agotado,
        // cae a bonus_gems. Si tampoco tiene, se bloquea.
        // La apertura consume 1 slot (no hay penalty porque no es mensaje del usuario).
        const vipUsed = await countVipMessagesToday(tid)
        const totalVipCost = 1 // La apertura es 1 slot, sin penalty

        if (vipUsed + totalVipCost <= VIP_DAILY_MESSAGE_LIMIT) {
          // Dentro del cupo VIP diario. No tocar bonus_gems.
          charged = true
          paymentMode = 'vip_daily'
        } else if (newBonusGems >= GEM_COSTS.message) {
          // Cupo VIP agotado → cobrar de bonus_gems
          const bonusResult = await tx.execute({
            sql: `UPDATE users 
                  SET bonus_gems = COALESCE(bonus_gems, 0) - ? 
                  WHERE telegram_id = ? AND COALESCE(bonus_gems, 0) >= ? 
                  RETURNING bonus_gems`,
            args: [GEM_COSTS.message, tid, GEM_COSTS.message],
          })

          if (bonusResult.rows.length > 0) {
            newBonusGems = Number(bonusResult.rows[0].bonus_gems)
            charged = true
            paymentMode = 'vip_bonus'

            await tx.execute({
              sql: `INSERT INTO gem_transactions (telegram_id, amount, transaction_type, description) VALUES (?, ?, ?, ?)`,
              args: [tid, -GEM_COSTS.message, 'message_vip_overflow', 'Apertura VIP (cupo agotado)'],
            })
          }
        }
        // Si no hay cupo VIP ni bonus_gems → charged = false → bloqueado
      } else if (activePass) {
        // ✅ No-VIP con pase activo: la apertura es GRATIS (el pase se consume
        // con los mensajes del usuario, no con la apertura).
        charged = true
        paymentMode = 'pass'
      } else {
        // No-VIP sin pase: cobrar de bonus_gems o hook
        const bonusResult = await tx.execute({
          sql: `UPDATE users 
                SET bonus_gems = COALESCE(bonus_gems, 0) - ? 
                WHERE telegram_id = ? AND COALESCE(bonus_gems, 0) >= ? 
                RETURNING bonus_gems`,
          args: [GEM_COSTS.message, tid, GEM_COSTS.message],
        })

        if (bonusResult.rows.length > 0) {
          newBonusGems = Number(bonusResult.rows[0].bonus_gems)
          charged = true
          paymentMode = 'bonus_gems'

          await tx.execute({
            sql: `INSERT INTO gem_transactions (telegram_id, amount, transaction_type, description) VALUES (?, ?, ?, ?)`,
            args: [tid, -GEM_COSTS.message, 'message', 'Mensaje de apertura'],
          })
        } else {
          // Intentar consumir del Hook Mode
          const hookRemaining = user.hook_messages_remaining || 0
          if (hookRemaining > 0) {
            const hookResult = await tx.execute({
              sql: `UPDATE users 
                    SET hook_messages_remaining = hook_messages_remaining - 1 
                    WHERE telegram_id = ? AND hook_messages_remaining >= 1 
                    RETURNING hook_messages_remaining`,
              args: [tid],
            })
            if (hookResult.rows.length > 0) {
              newHookRemaining = Number(hookResult.rows[0].hook_messages_remaining)
              charged = true
              paymentMode = 'hook'
            }
          }
        }
      }

      // 3. Si no se pudo cobrar, rollback y bloquear
      if (!charged) {
        await tx.rollback()
        return NextResponse.json({
          blocked: true,
          response:
            lang === 'es'
              ? isVip
                ? 'Has agotado tus mensajes VIP de hoy y no te quedan mensajes comprados.'
                : 'Necesitas al menos 1 mensaje para empezar a chatear.'
              : isVip
                ? "You've used your VIP messages today and have no purchased messages left."
                : 'You need at least 1 message to start chatting.',
          remaining_gems: newGems,
          remaining_bonus_gems: newBonusGems,
          hook_messages_remaining: newHookRemaining,
          is_vip: isVip,
        })
      }

      // 4. Insertar mensaje de apertura DENTRO de la transacción
      const insertResult = await tx.execute({
        sql: `INSERT INTO conversation_history (telegram_id, character_id, role, content) VALUES (?, ?, 'assistant', ?)`,
        args: [tid, character_id, openingMessage],
      })

      await tx.commit()

      return NextResponse.json({
        response: openingMessage,
        assistant_message_id: Number(insertResult.lastInsertRowid),
        remaining_gems: newGems,
        remaining_bonus_gems: newBonusGems,
        hook_messages_remaining: newHookRemaining,
        is_vip: isVip,
        payment_mode: paymentMode,
      })
    } catch (txError) {
      await tx.rollback().catch(() => {})
      throw txError
    }
  } catch (e: any) {
    console.error('Error en start-chat:', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
