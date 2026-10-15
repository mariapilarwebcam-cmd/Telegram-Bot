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
import { generateAudio } from '@/lib/ai'
import { getLevelFromMessages, getAudioCost } from '@/lib/levels'

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { character_id, text } = body

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
    // Determine payment path
    // ═══════════════════════════════════════════════════════════
    // VIP con tokens disponibles → gratis (consume token)
    // VIP sin tokens → cobra con gemas compradas
    // No-VIP → cobra con gemas compradas
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

    // ═══════════════════════════════════════════════════════════
    // Validar pago con gemas (solo si no hay token VIP)
    // ═══════════════════════════════════════════════════════════
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
    // Clean text
    // ═══════════════════════════════════════════════════════════
    const cleanText = (text || '')
      .replace(/\*[^*]*\*/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
      .trim()

    if (!cleanText) {
      return NextResponse.json({ error: 'No hay diálogo' }, { status: 400 })
    }

    // ═══════════════════════════════════════════════════════════
    // Generate audio (Chatterbox Multilingual)
    // ═══════════════════════════════════════════════════════════
    const gender = character.gender === 'male' ? 'male' : 'female'

    let audioData: string
    try {
      audioData = await generateAudio(cleanText, gender, lang)
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
    // Charge (only AFTER successful generation)
    // ═══════════════════════════════════════════════════════════
    let newGems = user.gems || 0
    let newPurchasedGems = user.purchased_gems || 0
    let usedVipToken = false

    if (paymentMode === 'vip_token') {
      // Consume 1 token — no gem charge
      await consumeAudioToken(tid)
      usedVipToken = true
      console.log(
        `[generate-audio] 🎫 VIP token consumed (was ${availableTokens}, now ${availableTokens - 1})`
      )
    } else {
      // Charge with gems
      const rpcData = await decrementGemsAndPurchased(tid, audioCost)
      newGems = rpcData.new_gems
      newPurchasedGems = rpcData.new_purchased

      await insertGemTransaction({
        telegram_id: tid,
        amount: -audioCost,
        transaction_type: 'audio',
        description: `Audio TTS nivel ${level.level}`,
      })

      console.log(
        `[generate-audio] 💎 Charged ${audioCost} gems (level ${level.level})`
      )
    }

    // ═══════════════════════════════════════════════════════════
    // Response
    // ═══════════════════════════════════════════════════════════
    return NextResponse.json({
      audio: audioData,
      remaining_gems: newGems,
      remaining_purchased_gems: newPurchasedGems,
      level: level.level,
      cost: usedVipToken ? 0 : audioCost,
      vip_token_used: usedVipToken,
    })
  } catch (error: any) {
    console.error('Error audio:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
