import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { PERSONALITIES, GEM_COSTS } from '@/lib/constants'
import { generateAIResponse } from '@/lib/ai'

export async function POST(request: Request) {
  try {
    const { telegram_id, character_id, message } = await request.json()

    // 1. Validar usuario y gemas
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('gems, language, first_name, hook_messages_remaining')
      .eq('telegram_id', telegram_id)
      .single()

    if (userError || !user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    if (user.gems < GEM_COSTS.message) {
      return NextResponse.json({ error: 'No tienes suficientes gemas', remaining_gems: user.gems }, { status: 402 })
    }

    // 2. Obtener personaje
    const { data: character, error: charError } = await supabase
      .from('user_characters')
      .select('*')
      .eq('id', character_id)
      .eq('telegram_id', telegram_id)
      .single()

    if (charError || !character) {
      return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })
    }

    // 3. Obtener historial
    const { data: history } = await supabase
      .from('conversation_history')
      .select('role, content')
      .eq('telegram_id', telegram_id)
      .eq('character_id', character_id)
      .order('created_at', { ascending: false })
      .limit(10)

    const messages = (history || []).reverse().map((msg: any) => ({
      role: msg.role,
      content: msg.content
    }))
    messages.push({ role: 'user', content: message })

    // 4. Crear prompt del sistema
    const personality = PERSONALITIES[character.archetype] || ''
    const systemPrompt = `Eres ${character.character_name}, ${character.gender}. ${personality}
El usuario se llama ${user.first_name}. Úsalo naturalmente.

INSTRUCCIONES:
- Usa asteriscos (*) para acciones: *sonríe*, *se acerca*
- Combina diálogo con acciones
- Termina con preguntas abiertas
- Sé coqueto, provocativo y convincente
- Responde en español neutro, sin modismos
- Mantén tu respuesta dentro de 400 tokens`

    // 5. Generar respuesta con IA
    const intensity = user.gems <= 3 ? 'VERY_HIGH' : user.gems <= 7 ? 'HIGH' : 'NORMAL'
    const responseText = await generateAIResponse(messages, systemPrompt, intensity as any)

    // 6. Guardar mensajes
    await supabase.from('conversation_history').insert([
      { telegram_id, character_id, role: 'user', content: message },
      { telegram_id, character_id, role: 'assistant', content: responseText }
    ])

    // 7. Deducir gema
    const newGems = user.gems - GEM_COSTS.message
    await supabase.from('users').update({ gems: newGems }).eq('telegram_id', telegram_id)
    
    await supabase.from('gem_transactions').insert({
      telegram_id,
      amount: -GEM_COSTS.message,
      transaction_type: 'message',
      description: 'Mensaje de chat'
    })

    // 8. Formatear respuesta (convertir *acciones* a negrita para HTML)
    const formattedResponse = responseText.replace(/\*([^*]+)\*/g, '<b>$1</b>')

    return NextResponse.json({
      response: formattedResponse,
      remaining_gems: newGems
    })

  } catch (error: any) {
    console.error('Error en chat:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}