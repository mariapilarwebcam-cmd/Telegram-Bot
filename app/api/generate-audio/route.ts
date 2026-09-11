import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { GEM_COSTS } from '@/lib/constants'
import { generateAudio } from '@/lib/ai'

export async function POST(request: Request) {
  try {
    const { telegram_id, character_id, text } = await request.json()
    const tid = String(telegram_id)

    const { data: user } = await supabase
      .from('users')
      .select('gems')
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!user || user.gems < GEM_COSTS.audio) {
      return NextResponse.json({ error: 'Necesitas 5 gemas' }, { status: 402 })
    }

    const { data: character } = await supabase
      .from('user_characters')
      .select('gender')
      .eq('id', character_id)
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!character) return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })

    const cleanText = (text || '')
      .replace(/\*[^*]*\*/g, '')
      .replace(/<[^>]+>/g, '')
      .trim()

    if (!cleanText) return NextResponse.json({ error: 'No hay diálogo' }, { status: 400 })

    const gender = character.gender === 'male' ? 'male' : 'female'
    const audioData = await generateAudio(cleanText, gender)
    if (!audioData) return NextResponse.json({ error: 'Sin audio' }, { status: 500 })

    const newGems = user.gems - GEM_COSTS.audio
    await supabase.from('users').update({ gems: newGems }).eq('telegram_id', tid)
    await supabase.from('gem_transactions').insert({
      telegram_id: tid,
      amount: -GEM_COSTS.audio,
      transaction_type: 'audio',
      description: 'Generación de audio TTS (EN)'
    })

    return NextResponse.json({ audio: audioData, remaining_gems: newGems })
  } catch (error: any) {
    console.error('Error audio:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
