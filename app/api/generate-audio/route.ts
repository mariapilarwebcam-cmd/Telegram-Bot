// app/api/generate-audio/route.ts

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { generateAudio } from '@/lib/ai'
import { getLevelFromMessages, getAudioCost } from '@/lib/levels'

export async function POST(request: Request) {
  try {
    const { telegram_id, character_id, text } = await request.json()
    const tid = String(telegram_id)

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('gems, language')
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!user) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })

    const { data: purchases } = await supabaseAdmin
      .from('star_purchases')
      .select('id')
      .eq('telegram_id', tid)
      .limit(1)

    if (!purchases || purchases.length === 0) {
      return NextResponse.json({
        error: 'premium_required',
        message: user.language === 'en'
          ? 'Voice audio is a Premium feature. Buy gems with Stars to unlock it.'
          : 'El audio de voz es Premium. Compra gemas con Stars para desbloquearlo.',
      }, { status: 403 })
    }

    const { data: character } = await supabaseAdmin
      .from('user_characters')
      .select('gender')
      .eq('id', character_id)
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!character) return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })

    const { count: userMsgCount } = await supabaseAdmin
      .from('conversation_history')
      .select('*', { count: 'exact', head: true })
      .eq('telegram_id', tid)
      .eq('character_id', character_id)
      .eq('role', 'user')

    const level = getLevelFromMessages(userMsgCount || 0)
    const audioCost = getAudioCost(level.level)

    if (user.gems < audioCost) {
      return NextResponse.json({
        error: 'insufficient_gems',
        message: user.language === 'en'
          ? `You need ${audioCost} gems`
          : `Necesitas ${audioCost} gemas`,
        required: audioCost,
      }, { status: 402 })
    }

    const cleanText = (text || '')
      .replace(/\*[^*]*\*/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
      .trim()

    if (!cleanText) return NextResponse.json({ error: 'No hay diálogo' }, { status: 400 })

    const gender = character.gender === 'male' ? 'male' : 'female'
    const lang = (user.language === 'en' ? 'en' : 'es') as 'es' | 'en'

    const audioData = await generateAudio(cleanText, gender, lang)
    if (!audioData) return NextResponse.json({ error: 'Sin audio' }, { status: 500 })

    const newGems = user.gems - audioCost
    await supabaseAdmin.from('users').update({ gems: newGems }).eq('telegram_id', tid)
    await supabaseAdmin.from('gem_transactions').insert({
      telegram_id: tid,
      amount: -audioCost,
      transaction_type: 'audio',
      description: `Audio TTS nivel ${level.level}`,
    })

    return NextResponse.json({
      audio: audioData,
      remaining_gems: newGems,
      level: level.level,
      cost: audioCost,
    })
  } catch (error: any) {
    console.error('Error audio:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
