// app/api/generate-audio/route.ts

import { NextResponse } from 'next/server'
import {
  ensureUser,
  getCharacter,
  countUserMessages,
  decrementGemsAndPurchased,
  insertGemTransaction,
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

    const purchasedGems = user.purchased_gems || 0
    if (purchasedGems <= 0) {
      return NextResponse.json(
        {
          error: 'premium_required',
          message:
            user.language === 'en'
              ? 'Voice audio is a Premium feature. Buy gems with Stars to unlock it.'
              : 'El audio de voz es Premium. Compra gemas con Stars para desbloquearlo.',
        },
        { status: 403 }
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

    if (purchasedGems < audioCost) {
      return NextResponse.json(
        {
          error: 'insufficient_gems',
          message:
            user.language === 'en'
              ? `You need ${audioCost} purchased gems`
              : `Necesitas ${audioCost} gemas compradas`,
          required: audioCost,
          available: purchasedGems,
        },
        { status: 402 }
      )
    }

    const cleanText = (text || '')
      .replace(/\*[^*]*\*/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
      .trim()

    if (!cleanText) {
      return NextResponse.json({ error: 'No hay diálogo' }, { status: 400 })
    }

    const gender = character.gender === 'male' ? 'male' : 'female'
    const lang = (user.language === 'en' ? 'en' : 'es') as 'es' | 'en'

    const audioData = await generateAudio(cleanText, gender, lang)
    if (!audioData) {
      return NextResponse.json({ error: 'Sin audio' }, { status: 500 })
    }

    // RPC atómica: descuenta de gems Y purchased_gems
    const rpcData = await decrementGemsAndPurchased(tid, audioCost)
    const newGems = rpcData.new_gems
    const newPurchasedGems = rpcData.new_purchased

    await insertGemTransaction({
      telegram_id: tid,
      amount: -audioCost,
      transaction_type: 'audio',
      description: `Audio TTS nivel ${level.level}`,
    })

    return NextResponse.json({
      audio: audioData,
      remaining_gems: newGems,
      remaining_purchased_gems: newPurchasedGems,
      level: level.level,
      cost: audioCost,
    })
  } catch (error: any) {
    console.error('Error audio:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
