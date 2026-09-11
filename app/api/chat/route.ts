import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { PERSONALITIES, GEM_COSTS, HOOK_MODE_MESSAGES } from '@/lib/constants'
import { generateAIResponse, getIntensity, buildSystemPrompt } from '@/lib/ai'

export async function POST(request: Request) {
  try {
    const { telegram_id, character_id, message } = await request.json()
    const tid = String(telegram_id)

    const { data: user } = await supabase
      .from('users')
      .select('gems, language, first_name, hook_messages_remaining')
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!user) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })

    const { data: character } = await supabase
      .from('user_characters')
      .select('*')
      .eq('id', character_id)
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!character) return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })

    const lang = (user.language || 'es') as 'es' | 'en'
    const hookRemaining = user.hook_messages_remaining || 0

    // ============ BLOQUEADO ============
    if (user.gems <= 0 && hookRemaining <= 0) {
      const blockedMessage = lang === 'es'
        ? `*${character.character_name} te mira con ojos ardientes y se muerde el labio*\n\n"Mmm... justo cuando las cosas se estaban poniendo interesantes... *se acerca más* Tengo algo especial que quería mostrarte..."\n\n*se aleja con una sonrisa provocativa*\n\n"Pero parece que nuestro tiempo se acabó. Recarga gemas para seguir, o invita a un amigo y te regalo 5 gemas."`
        : `*${character.character_name} looks at you with burning eyes and bites their lip*\n\n"Mmm... just when things were getting interesting... *gets closer* I have something special I wanted to show you..."\n\n*pulls back with a provocative smile*\n\n"But it seems our time is up. Recharge gems to continue, or invite a friend and I'll gift you 5 gems."`

      return NextResponse.json({
        blocked: true,
        response: blockedMessage.replace(/\*([^*]+)\*/g, '<b>*$1*</b>'),
        remaining_gems: 0,
        hook_messages_remaining: 0
      })
    }

    // ============ HOOK MODE o NORMAL ============
    const isHookMode = user.gems <= 0 && hookRemaining > 0
    let newHookRemaining = hookRemaining
    let newGems = user.gems

    if (!isHookMode) {
      newGems = user.gems - GEM_COSTS.message
      await supabase.from('users').update({ gems: newGems }).eq('telegram_id', tid)
      await supabase.from('gem_transactions').insert({
        telegram_id: tid,
        amount: -GEM_COSTS.message,
        transaction_type: 'message',
        description: 'Mensaje de chat'
      })
    } else {
      newHookRemaining = Math.max(0, hookRemaining - 1)
      await supabase
        .from('users')
        .update({ hook_messages_remaining: newHookRemaining })
        .eq('telegram_id', tid)
    }

    // ============ HISTORIAL ============
    const { data: history } = await supabase
      .from('conversation_history')
      .select('role, content')
      .eq('telegram_id', tid)
      .eq('character_id', character_id)
      .order('created_at', { ascending: false })
      .limit(10)

    const messages = (history || []).reverse().map((m: any) => ({
      role: m.role,
      content: m.content
    }))
    messages.push({ role: 'user', content: message })

    // ============ PROMPT ============
    const personality = PERSONALITIES[character.archetype] || ''
    const characterPrompt = lang === 'es'
      ? `Eres ${character.character_name}, ${character.gender}.\n${personality}\n\nEl usuario se llama ${user.first_name}. Recuerda su nombre y úsalo naturalmente.\nMantén siempre tu personalidad y rol. Nunca rompas el personaje.`
      : `You are ${character.character_name}, ${character.gender}.\n${personality}\n\nThe user's name is ${user.first_name}. Remember their name and use it naturally.\nAlways maintain your personality and role. Never break character.`

    const intensity = getIntensity(newGems, isHookMode)
    const systemPrompt = buildSystemPrompt(lang, intensity, characterPrompt)

    const responseText = await generateAIResponse(messages, systemPrompt, intensity)

    // ============ GUARDAR ============
    await supabase.from('conversation_history').insert([
      { telegram_id: tid, character_id, role: 'user', content: message },
      { telegram_id: tid, character_id, role: 'assistant', content: responseText }
    ])

    // ============ AVISO HOOK ============
    let finalText = responseText
    if (isHookMode) {
      finalText += lang === 'es'
        ? `\n\n⚠️ *Momentos especiales restantes: ${newHookRemaining}*`
        : `\n\n⚠️ *Special moments remaining: ${newHookRemaining}*`
    }

    const formatted = finalText.replace(/\*([^*]+)\*/g, '<b>*$1*</b>')

    return NextResponse.json({
      response: formatted,
      remaining_gems: newGems,
      hook_messages_remaining: newHookRemaining,
      is_hook_mode: isHookMode,
      intensity
    })
  } catch (error: any) {
    console.error('Error en chat:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
