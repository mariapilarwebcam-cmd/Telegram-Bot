// app/api/chat/route.ts

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  GEM_COSTS,
  HOOK_MODE_MESSAGES,
  GEMS_PER_REFERRAL,
  getLevelPersonality,
} from '@/lib/constants'
import { getLevelFromMessages } from '@/lib/levels'
import { generateAIResponse, getIntensity, buildSystemPrompt } from '@/lib/ai'

export async function POST(request: Request) {
  try {
    const { telegram_id, character_id, message } = await request.json()
    const tid = String(telegram_id)

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('gems, language, first_name, hook_messages_remaining')
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!user) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })

    const { data: character } = await supabaseAdmin
      .from('user_characters')
      .select('*')
      .eq('id', character_id)
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!character) return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })

    const lang = (user.language || 'es') as 'es' | 'en'
    const hookRemaining = user.hook_messages_remaining || 0

    if (user.gems <= 0 && hookRemaining <= 0) {
      const blockedMessage = lang === 'es'
        ? `*${character.character_name} te mira con ojos ardientes y se muerde el labio*\n\n"Mmm... justo cuando se ponía interesante..."\n\n"Recarga gemas o invita a un amigo y te regalo 5 💎"`
        : `*${character.character_name} looks at you with burning eyes and bites their lip*\n\n"Mmm... just when it was getting interesting..."\n\n"Recharge gems or invite a friend and I'll gift you 5 💎"`

      return NextResponse.json({
        blocked: true,
        response: blockedMessage,
        remaining_gems: 0,
        hook_messages_remaining: 0,
      })
    }

    const isHookMode = user.gems <= 0 && hookRemaining > 0
    let newHookRemaining = hookRemaining
    let newGems = user.gems

    if (!isHookMode) {
      newGems = user.gems - GEM_COSTS.message
      if (newGems <= 0 && newHookRemaining <= 0) {
        newHookRemaining = HOOK_MODE_MESSAGES
      }

      // ✅ UPDATE VERIFICADO
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('users')
        .update({ gems: newGems, hook_messages_remaining: newHookRemaining })
        .eq('telegram_id', tid)
        .select('gems, hook_messages_remaining')
        .single()

      if (updateError) {
        console.error('[chat] ❌ Update gems FAILED:', updateError)
        return NextResponse.json({
          error: 'Error actualizando gemas',
          detail: updateError.message,
        }, { status: 500 })
      }

      // Verificar que los valores coincidan con lo esperado
      if (updated.gems !== newGems) {
        console.warn('[chat] ⚠️ Gem mismatch:', updated.gems, 'vs expected', newGems)
        newGems = updated.gems
      }

      await supabaseAdmin.from('gem_transactions').insert({
        telegram_id: tid,
        amount: -GEM_COSTS.message,
        transaction_type: 'message',
        description: 'Mensaje de chat',
      })
    } else {
      newHookRemaining = Math.max(0, hookRemaining - 1)
      const { error: updateError } = await supabaseAdmin
        .from('users')
        .update({ hook_messages_remaining: newHookRemaining })
        .eq('telegram_id', tid)

      if (updateError) {
        console.error('[chat] ❌ Update hook mode FAILED:', updateError)
      }
    }

    // Historial reciente
    const { data: history } = await supabaseAdmin
      .from('conversation_history')
      .select('role, content')
      .eq('telegram_id', tid)
      .eq('character_id', character_id)
      .order('created_at', { ascending: false })
      .limit(10)

    const { count: userMsgCount } = await supabaseAdmin
      .from('conversation_history')
      .select('*', { count: 'exact', head: true })
      .eq('telegram_id', tid)
      .eq('character_id', character_id)
      .eq('role', 'user')

    const level = getLevelFromMessages(userMsgCount || 0)

    const messages = (history || []).reverse().map((m: any) => ({
      role: m.role,
      content: m.content,
    }))
    messages.push({ role: 'user', content: message })

    const personality = getLevelPersonality(character.archetype, level.level, lang)

    const characterPrompt = lang === 'es'
      ? `Eres ${character.character_name}, rol: ${character.archetype}.\n${personality}\n\nEl usuario se llama ${user.first_name}. Recuerda su nombre y úsalo naturalmente.\nMantén siempre tu personalidad y rol. Nunca rompas el personaje.`
      : `You are ${character.character_name}, role: ${character.archetype}.\n${personality}\n\nThe user's name is ${user.first_name}. Remember their name and use it naturally.\nAlways maintain your personality and role. Never break character.`

    const intensity = getIntensity(userMsgCount || 0, isHookMode)
    const systemPrompt = buildSystemPrompt(lang, intensity, characterPrompt)

    let responseText: string
    try {
      responseText = await generateAIResponse(messages, systemPrompt, intensity)
    } catch (aiError) {
      // Rollback
      await supabaseAdmin
        .from('users')
        .update({ gems: user.gems, hook_messages_remaining: hookRemaining })
        .eq('telegram_id', tid)
      console.error('AI error:', aiError)
      return NextResponse.json({ error: 'Error al generar respuesta' }, { status: 500 })
    }

    await supabaseAdmin.from('conversation_history').insert([
      { telegram_id: tid, character_id, role: 'user', content: message },
      { telegram_id: tid, character_id, role: 'assistant', content: responseText },
    ])

    // Referidos
    try {
      const { data: referral } = await supabaseAdmin
        .from('referrals')
        .select('id, referrer_id, reward_paid')
        .eq('referred_id', tid)
        .maybeSingle()

      if (referral && !referral.reward_paid) {
        const { count } = await supabaseAdmin
          .from('conversation_history')
          .select('*', { count: 'exact', head: true })
          .eq('telegram_id', tid)
          .eq('role', 'user')

        const totalMsg = count || 0

        await supabaseAdmin
          .from('referrals')
          .update({ referred_message_count: totalMsg })
          .eq('id', referral.id)

        if (totalMsg >= 3) {
          const { data: refUser } = await supabaseAdmin
            .from('users')
            .select('gems, total_referrals')
            .eq('telegram_id', String(referral.referrer_id))
            .maybeSingle()

          if (refUser) {
            await supabaseAdmin
              .from('users')
              .update({
                gems: (refUser.gems || 0) + GEMS_PER_REFERRAL,
                total_referrals: (refUser.total_referrals || 0) + 1,
              })
              .eq('telegram_id', String(referral.referrer_id))

            await supabaseAdmin.from('gem_transactions').insert({
              telegram_id: String(referral.referrer_id),
              amount: GEMS_PER_REFERRAL,
              transaction_type: 'referral',
              description: 'Referido verificado (3+ mensajes)',
            })

            await supabaseAdmin
              .from('referrals')
              .update({ reward_paid: true, reward_paid_at: new Date().toISOString() })
              .eq('id', referral.id)
          }
        }
      }
    } catch (refErr) {
      console.error('Referral payout error:', refErr)
    }

    let finalText = responseText
    if (isHookMode || (newHookRemaining > 0 && newGems <= 0)) {
      finalText += lang === 'es'
        ? `\n\n⚠️ ${newHookRemaining} mensajes gratis restantes`
        : `\n\n⚠️ ${newHookRemaining} free messages remaining`
    }

    return NextResponse.json({
      response: finalText,
      remaining_gems: newGems,
      hook_messages_remaining: newHookRemaining,
      is_hook_mode: isHookMode,
      intensity,
      level: level.level,
    })
  } catch (error: any) {
    console.error('Error en chat:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
