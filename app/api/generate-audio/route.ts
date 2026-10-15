// app/api/generate-audio/route.ts

import { NextResponse } from 'next/server'
import {
  ensureUser,
  getCharacter,
  countUserMessages,
  decrementGemsAndPurchased,
  insertGemTransaction,
  getActiveSubscription,
  ensureAudioTokensRefilled,
  consumeAudioToken,
} from '@/lib/db-queries'
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
      return NextResponse.json(
        { error: 'Error cargando tu cuenta' },
        { status: 500 }
      )
    }

    const character = await getCharacter(character_id, tid)
    if (!character) {
      return NextResponse.json(
        { error: 'Personaje no encontrado' },
        { status: 404 }
      )
    }

    const userMsgCount = await countUserMessages(tid, character_id)
    const level = getLevelFromMessages(userMsgCount || 0)
    const audioCost = getAudioCost(level.level)
    const lang = (user.language === 'en' ? 'en' : 'es') as 'es' | 'en'

    // ═══════════════════════════════════════════════════════════
    // Determinar modo de pago
    // ═══════════════════════════════════════════════════════════
    const vipSub = await getActiveSubscription(tid)
    const isVip = !!vipSub

    let paymentMode: 'vip_token' | 'gems' = 'gems'
    let availableTokens = 0

    if (isVip) {
      availableTokens = await ensureAudioTokensRefilled(tid)
      if (availableTokens > 0) {
        paymentMode = 'vip_token'
      }
    }

    // Validar pago con gemas (solo si no hay token VIP)
    if (paymentMode === 'gems') {
      const purchasedGems = user.purchased_gems || 0

      if (purchasedGems <= 0) {
        return NextResponse.json(
          {
            error: 'premium_required',
            message:
              lang === 'en'
                ? 'Voice audio is a Premium feature. Buy gems with Stars to unlock it.'
                : 'El audio de voz es Premium. Compra gemas con Stars para desbloquearlo.',
          },
          { status: 403 }
        )
      }

      if (purchasedGems < audioCost) {
        return NextResponse.json(
          {
            error: 'insufficient_gems',
            message:
              lang === 'en'
                ? `You need ${audioCost} purchased gems`
                : `Necesitas ${audioCost} gemas compradas`,
            required: audioCost,
            available: purchasedGems,
          },
          { status: 402 }
        )
      }
    }

    // ═══════════════════════════════════════════════════════════
    // Preparar contexto de conversación
    // ═══════════════════════════════════════════════════════════
    // Prioridad 1: recent_messages (nuevo flujo — últimos 3 mensajes)
    // Prioridad 2: text (backward compat — último mensaje)
    // Prioridad 3: sin contexto (genera desde personalidad)
    let contextMessages: Array<{ role: string; content: string }> = []

    if (Array.isArray(recent_messages) && recent_messages.length > 0) {
      contextMessages = recent_messages
        .filter(
          (m: any) =>
            m &&
            typeof m.content === 'string' &&
            m.content.trim().length > 0 &&
            (m.role === 'user' || m.role === 'assistant')
        )
        .slice(-3)
        .map((m: any) => ({
          role: m.role,
          content: String(m.content).slice(0, 600),
        }))
    } else if (typeof text === 'string' && text.trim().length > 0) {
      // Backward compat: usar text como único mensaje del asistente
      contextMessages = [
        { role: 'assistant', content: text.slice(0, 600) },
      ]
    }

    // ═══════════════════════════════════════════════════════════
    // Construir prompt del personaje (para la frase de audio)
    // ═══════════════════════════════════════════════════════════
    const levelPersonality = getLevelPersonality(
      character.archetype,
      level.level,
      lang
    )
    const characterPrompt = lang === 'es'
      ? `Eres ${character.character_name}. Rol: ${character.archetype}.\n${levelPersonality}\n\nEl usuario se llama ${user.first_name || 'él'}.\nNivel de relación: ${level.level}/5.`
      : `You are ${character.character_name}. Role: ${character.archetype}.\n${levelPersonality}\n\nThe user's name is ${user.first_name || 'him'}.\nRelationship level: ${level.level}/5.`

    // ═══════════════════════════════════════════════════════════
    // PASO 1 — Generar frase corta con DeepSeek
    // ═══════════════════════════════════════════════════════════
    let generatedLine: { text: string; emotion: string; exaggeration: number }

    try {
      generatedLine = await generateShortAudioLine(
        contextMessages.length > 0
          ? contextMessages
          : [{ role: 'user', content: '...' }],
        characterPrompt,
        lang,
        level.level
      )
    } catch (lineError: any) {
      console.error('[generate-audio] generateShortAudioLine error:', lineError?.message)
      return NextResponse.json(
        { error: 'Error al preparar el audio' },
        { status: 500 }
      )
    }

    if (!generatedLine?.text) {
      return NextResponse.json(
        { error: 'No se pudo generar la frase' },
        { status: 500 }
      )
    }

    console.log(`[generate-audio] 🎙️ Line generated:`, {
      emotion: generatedLine.emotion,
      exaggeration: generatedLine.exaggeration,
      chars: generatedLine.text.length,
      preview: generatedLine.text.slice(0, 80),
    })

    // ═══════════════════════════════════════════════════════════
    // PASO 2 — Generar audio con Chatterbox
    // ═══════════════════════════════════════════════════════════
    const gender = character.gender === 'male' ? 'male' : 'female'

    let audioData: string
    try {
      audioData = await generateAudio(
        generatedLine.text,
        gender,
        lang,
        generatedLine.exaggeration
      )
    } catch (audioError: any) {
      console.error('[generate-audio] Chatterbox error:', audioError?.message)
      return NextResponse.json(
        { error: 'Error al generar audio' },
        { status: 500 }
      )
    }

    if (!audioData) {
      return NextResponse.json({ error: 'Sin audio' }, { status: 500 })
    }

    // ═══════════════════════════════════════════════════════════
    // PASO 3 — Cobrar (solo después del éxito)
    // ═══════════════════════════════════════════════════════════
    let newGems = user.gems || 0
    let newPurchasedGems = user.purchased_gems || 0
    let usedVipToken = false

    if (paymentMode === 'vip_token') {
      await consumeAudioToken(tid)
      usedVipToken = true
      console.log(
        `[generate-audio] 🎫 VIP token consumed (was ${availableTokens}, now ${availableTokens - 1})`
      )
    } else {
      const rpcData = await decrementGemsAndPurchased(tid, audioCost)
      newGems = rpcData.new_gems
      newPurchasedGems = rpcData.new_purchased

      await insertGemTransaction({
        telegram_id: tid,
        amount: -audioCost,
        transaction_type: 'audio',
        description: `Audio TTS nivel ${level.level} (${generatedLine.emotion})`,
      })

      console.log(
        `[generate-audio] 💎 Charged ${audioCost} gems (level ${level.level}, emotion ${generatedLine.emotion})`
      )
    }

    // ═══════════════════════════════════════════════════════════
    // RESPUESTA
    // ═══════════════════════════════════════════════════════════
    return NextResponse.json({
      audio: audioData,
      // ✅ NUEVO: incluir el texto generado para debug/UI
      audio_text: generatedLine.text,
      emotion: generatedLine.emotion,
      remaining_gems: newGems,
      remaining_purchased_gems: newPurchasedGems,
      level: level.level,
      cost: usedVipToken ? 0 : audioCost,
      vip_token_used: usedVipToken,
    })
  } catch (error: any) {
    console.error('[generate-audio] Error:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
