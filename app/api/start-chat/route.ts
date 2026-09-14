import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { OPENING_LINES, GEM_COSTS } from '@/lib/constants'

export async function POST(request: Request) {
  try {
    const { telegram_id, character_id } = await request.json()
    const tid = String(telegram_id)

    // Verificar usuario
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('gems, language, first_name')
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    // Verificar personaje
    const { data: character } = await supabaseAdmin
      .from('user_characters')
      .select('*')
      .eq('id', character_id)
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!character) {
      return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })
    }

    // ¿Ya existe historial? => no cobrar de nuevo
    const { count } = await supabaseAdmin
      .from('conversation_history')
      .select('*', { count: 'exact', head: true })
      .eq('telegram_id', tid)
      .eq('character_id', character_id)

    if ((count || 0) > 0) {
      return NextResponse.json({ already_started: true })
    }

    // ¿Tiene gemas suficientes?
    const gems = user.gems || 0
    if (gems < GEM_COSTS.message) {
      return NextResponse.json({
        blocked: true,
        response: '',
        remaining_gems: gems,
      })
    }

    // Cobrar 1 gema
    const newGems = gems - GEM_COSTS.message
    await supabaseAdmin
      .from('users')
      .update({ gems: newGems })
      .eq('telegram_id', tid)

    await supabaseAdmin.from('gem_transactions').insert({
      telegram_id: tid,
      amount: -GEM_COSTS.message,
      transaction_type: 'message',
      description: 'Mensaje de apertura',
    })

    // Obtener frase de apertura del arquetipo
    const lang = (user.language === 'en' ? 'en' : 'es') as 'es' | 'en'
    const openingTemplate = OPENING_LINES[character.archetype]
    const fallback = lang === 'es'
      ? `*{name} te mira al entrar y sonríe con intención*\n\n"Hola... estaba esperándote. ¿Qué te trae por aquí?"`
      : `*{name} looks at you as you enter and smiles with intent*\n\n"Hey... I was waiting for you. What brings you here?"`
    const template = openingTemplate ? openingTemplate[lang] : fallback
    const openingMessage = template.replace(/{name}/g, character.character_name)

    // Guardar en historial
    await supabaseAdmin.from('conversation_history').insert({
      telegram_id: tid,
      character_id,
      role: 'assistant',
      content: openingMessage,
    })

    return NextResponse.json({
      response: openingMessage,
      remaining_gems: newGems,
    })
  } catch (e: any) {
    console.error('Error en start-chat:', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}