// app/api/generate-audio/route.ts

import { NextResponse } from 'next/server'
import {
  ensureUser,
  getCharacter,
  countUserMessages,
  incrementGems,
  insertGemTransaction,
  getActiveSubscription,
  ensureAudioTokensRefilled,
} from '@/lib/db-queries'
import { queryOne } from '@/lib/turso'
import { generateShortAudioLine, generateAudio } from '@/lib/ai'
import { getLevelFromMessages, getAudioCost } from '@/lib/levels'
import { getLevelPersonality } from '@/lib/constants'

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { character_id, recent_messages, text } = body

    const user = await ensureUser(tid)
    if (!user) {
      return NextResponse.json({ error: 'Error cargando tu cuenta' }, { status: 500 })
    }

    const character = await getCharacter(character_id, tid)
    if (!character) {
      return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })
    }

    const userMsgCount = await countUserMessages(tid, character_id)
    const level = getLevelFromMessages(userMsgCount || 0)
    const audioCost = getAudioCost(level.level)
    const lang = (user.language === 'en' ? 'en' : 'es') as 'es' | 'en'

    const vipSub = await getActiveSubscription(tid)
    const isVip = !!vipSub

    // ═══════════════════════════════════════════════════════════
    // PASO 1 — COBRO ATÓMICO ANTICIPADO (Previene DoS)
    // ═══════════════════════════════════════════════════════════
    let paymentMode: 'vip_token' | 'gems' = 'gems'
    let availableTokens = 0

    if (isVip) {
      availableTokens = await ensureAudioTokensRefilled(tid)
      if (availableTokens > 0) {
        // Descontar token de forma atómica (solo si tiene > 0)
        const tokenDeducted = await queryOne<{ audio_tokens: number }>(
          `UPDATE users SET audio_tokens = audio_tokens - 1 WHERE telegram_id = ? AND audio_tokens > 0 RETURNING audio_tokens`,
          [tid]
        )
        if (tokenDeducted) {
          paymentMode = 'vip_token'
        }
      }
    }

    if (paymentMode === 'gems') {
      // Descontar gemas de forma atómica (solo si tiene saldo suficiente)
      const gemDeducted = await queryOne<{ purchased_gems: number, gems: number }>(
        `UPDATE users 
         SET purchased_gems = purchased_gems - ?, 
             gems = gems - ? 
         WHERE telegram_id = ? AND purchased_gems >= ? 
         RETURNING purchased_gems, gems`,
        [audioCost, audioCost, tid, audioCost]
      )

      if (!gemDeducted) {
        return NextResponse.json(
          {
            error: 'insufficient_gems',
            message: lang === 'en'
              ? `You need ${audioCost} purchased gems`
              : `Necesitas ${audioCost} gemas compradas`,
            required: audioCost,
            available: user.purchased_gems || 0,
          },
          { status: 402 }
        )
      }
    }

    // ═══════════════════════════════════════════════════════════
    // Función interna para reembolsar si la IA falla
    // ═══════════════════════════════════════════════════════════
    const refund = async () => {
      if (paymentMode === 'vip_token') {
        await queryOne(`UPDATE users SET audio_tokens = audio_tokens + 1 WHERE telegram_id = ?`, [tid])
      } else {
        await queryOne(
          `UPDATE users SET purchased_gems = purchased_gems + ?, gems = gems + ? WHERE telegram_id = ?`,
          [audioCost, audioCost, tid]
        )
      }
    }

    // ═══════════════════════════════════════════════════════════
    // PASO 2 — GENERAR CONTEXTO Y AUDIO
    // ═══════════════════════════════════════════════════════════
    let contextMessages: Array<{ role: string; content: string }> = []
    if (Array.isArray(recent_messages) && recent_messages.length > 0) {
      contextMessages = recent_messages
        .filter((m: any) => m && typeof m.content === 'string' && m.content.trim().length > 0 && (m.role === 'user' || m.role === 'assistant'))
        .slice(-3)
        .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 600) }))
    } else if (typeof text === 'string' && text.trim().length > 0) {
      contextMessages = [{ role: 'assistant', content: text.slice(0, 600) }]
    }

    const levelPersonality = getLevelPersonality(character.archetype, level.level, lang)
    const characterPrompt = lang === 'es'
      ? `Eres ${character.character_name}. Rol: ${character.archetype}.\n${levelPersonality}\n\nEl usuario se llama ${user.first_name || 'él'}.\nNivel de relación: ${level.level}/5.`
      : `You are ${character.character_name}. Role: ${character.archetype}.\n${levelPersonality}\n\nThe user's name is ${user.first_name || 'him'}.\nRelationship level: ${level.level}/5.`

    let generatedLine: { text: string; emotion: string; exaggeration: number }
    try {
      generatedLine = await generateShortAudioLine(
        contextMessages.length > 0 ? contextMessages : [{ role: 'user', content: '...' }],
        characterPrompt,
        lang,
        level.level
      )
      if (!generatedLine?.text) throw new Error('Frase vacía')
    } catch (lineError: any) {
      console.error('[generate-audio] generateShortAudioLine error:', lineError?.message)
      await refund() // ✅ Reembolsamos si falla
      return NextResponse.json({ error: 'Error al preparar el audio' }, { status: 500 })
    }

    const gender = character.gender === 'male' ? 'male' : 'female'
    let audioData: string
    try {
      audioData = await generateAudio(generatedLine.text, gender, lang, generatedLine.exaggeration)
      if (!audioData) throw new Error('Audio vacío')
    } catch (audioError: any) {
      console.error('[generate-audio] Chatterbox error:', audioError?.message)
      await refund() // ✅ Reembolsamos si falla
      return NextResponse.json({ error: 'Error al generar audio' }, { status: 500 })
    }

    // ═══════════════════════════════════════════════════════════
    // PASO 3 — REGISTRAR TRANSACCIÓN
    // ═══════════════════════════════════════════════════════════
    let newGems = user.gems || 0
    let newPurchasedGems = user.purchased_gems || 0

    if (paymentMode === 'gems') {
      newGems = Math.max(0, (user.gems || 0) - audioCost)
      newPurchasedGems = Math.max(0, (user.purchased_gems || 0) - audioCost)
      await insertGemTransaction({
        telegram_id: tid,
        amount: -audioCost,
        transaction_type: 'audio',
        description: `Audio TTS nivel ${level.level} (${generatedLine.emotion})`,
      })
    } else {
      // Para VIP token, restamos 1 token visualmente pero no gemas
      console.log(`[generate-audio] 🎫 VIP token consumed (was ${availableTokens})`)
    }

    return NextResponse.json({
      audio: audioData,
      audio_text: generatedLine.text,
      emotion: generatedLine.emotion,
      remaining_gems: newGems,
      remaining_purchased_gems: newPurchasedGems,
      level: level.level,
      cost: paymentMode === 'vip_token' ? 0 : audioCost,
      vip_token_used: paymentMode === 'vip_token',
    })

  } catch (error: any) {
    console.error('[generate-audio] Error fatal:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
