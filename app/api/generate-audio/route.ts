import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { GEM_COSTS } from '@/lib/constants'
import { generateAudio } from '@/lib/ai'

export async function POST(request: Request) {
  try {
    const { telegram_id, character_id, text } = await request.json()
    const tid = String(telegram_id)

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('gems, language')
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    // ✅ PREMIUM GATE: debe haber comprado Stars
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
          : 'El audio de voz es Premium. Compra gemas con Stars para desbloquearlo.'
      }, { status: 403 })
    }

    if (user.gems < GEM_COSTS.audio) {
      return NextResponse.json({ error: 'Necesitas 5 gemas' }, { status: 402 })
    }

    const { data: character } = await supabaseAdmin
      .from('user_characters')
      .select('gender')
      .eq('id', character_id)
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!character) return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })

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

    const newGems = user.gems - GEM_COSTS.audio
    await supabaseAdmin.from('users').update({ gems: newGems }).eq('telegram_id', tid)
    await supabaseAdmin.from('gem_transactions').insert({
      telegram_id: tid,
      amount: -GEM_COSTS.audio,
      transaction_type: 'audio',
      description: `Generación de audio TTS (${lang.toUpperCase()})`
    })

    return NextResponse.json({ audio: audioData, remaining_gems: newGems })
  } catch (error: any) {
    console.error('Error audio:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
