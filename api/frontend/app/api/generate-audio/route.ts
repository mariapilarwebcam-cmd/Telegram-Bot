import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { GEM_COSTS } from '@/lib/constants'

// Mapeo de voces de Kokoro (igual que en tu Python)
const KOKORO_VOICES: Record<string, Record<string, string>> = {
  es: { male: 'em_alex', female: 'ef_dora' },
  en: { male: 'am_michael', female: 'af_bella' }
}

export async function POST(request: Request) {
  try {
    const { telegram_id, character_id, text } = await request.json()

    // 1. Validar gemas (cuesta 5 gemas)
    const { data: user } = await supabase
      .from('users')
      .select('gems, language')
      .eq('telegram_id', telegram_id)
      .single()

    if (!user || user.gems < GEM_COSTS.audio) {
      return NextResponse.json({ error: 'Necesitas 5 gemas para generar audio' }, { status: 402 })
    }

    // 2. Obtener personaje para saber el género y elegir la voz
    const { data: character } = await supabase
      .from('user_characters')
      .select('gender')
      .eq('id', character_id)
      .single()

    if (!character) {
      return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })
    }

    // 3. Limpiar el texto (quitar las acciones entre asteriscos *sonríe*)
    const cleanText = text.replace(/\*[^*]*\*/g, '').trim()
    if (!cleanText) {
      return NextResponse.json({ error: 'No hay diálogo para convertir a audio' }, { status: 400 })
    }

    // 4. Seleccionar voz según idioma y género
    const lang = user.language || 'es'
    const gender = character.gender === 'male' ? 'male' : 'female'
    const voice = KOKORO_VOICES[lang]?.[gender] || 'ef_dora'

    // 5. Llamar a DeepInfra (Modelo Kokoro)
    const response = await fetch('https://api.deepinfra.com/v1/inference/hexgrad/Kokoro-82M', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.DEEPINFRA_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: cleanText,
        voice: voice
      })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return NextResponse.json({ error: errorData.error || 'Error en la API de audio' }, { status: 500 })
    }

    const data = await response.json()
    const audioData = data.audio || data.result?.audio

    if (!audioData) {
      return NextResponse.json({ error: 'No se recibió audio de la API' }, { status: 500 })
    }

    // 6. Deducir gemas y registrar transacción
    const newGems = user.gems - GEM_COSTS.audio
    await supabase.from('users').update({ gems: newGems }).eq('telegram_id', telegram_id)
    
    await supabase.from('gem_transactions').insert({
      telegram_id,
      amount: -GEM_COSTS.audio,
      transaction_type: 'audio',
      description: 'Generación de audio TTS'
    })

    // 7. Devolver el audio en base64
    return NextResponse.json({
      audio: audioData, 
      remaining_gems: newGems
    })

  } catch (error: any) {
    console.error('Error generando audio:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}