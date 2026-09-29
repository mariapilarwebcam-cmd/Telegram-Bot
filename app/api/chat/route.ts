// app/api/chat/route.ts

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  GEM_COSTS,
  HOOK_MODE_MESSAGES,
  GEMS_PER_REFERRAL,
  getLevelPersonality,
} from '@/lib/constants'
import { getLevelFromMessages, isPhotoMilestone } from '@/lib/levels'
import { generateAIResponse, getIntensity, buildSystemPrompt } from '@/lib/ai'

// ============================================================
// ✅ MENSAJES CINEMÁTICOS DE INVITACIÓN A LA FOTO
// Se eligen al azar para no cansar al usuario
// ============================================================
const PHOTO_INVITES_ES: Array<(name: string) => string> = [
  (name) =>
    `📸 *${name} se muerde el labio y te mira fijamente...*\n_"Espera... quiero mandarte algo. Solo para ti."_`,
  (name) =>
    `📸 *${name} sonríe de lado y saca el teléfono...*\n_"No te muevas... esto te va a encantar."_`,
  (name) =>
    `📸 *${name} baja la voz y se acerca...*\n_"Ven... quiero mostrarte algo que nadie más ha visto."_`,
  (name) =>
    `📸 *${name} te mira con ojos brillantes...*\n_"Confía en mí. Tengo algo preparado para ti."_`,
  (name) =>
    `📸 *${name} se recoge el pelo y te dedica una mirada...*\n_"¿Quieres ver lo que estaba pensando? Solo tienes que pedirlo."_`,
]

const PHOTO_INVITES_EN: Array<(name: string) => string> = [
  (name) =>
    `📸 *${name} bites their lip and stares at you...*\n_"Wait... I want to send you something. Just for you."_`,
  (name) =>
    `📸 *${name} smirks and pulls out their phone...*\n_"Don't move... you're going to love this."_`,
  (name) =>
    `📸 *${name} lowers their voice and leans in...*\n_"Come here... I want to show you something no one else has seen."_`,
  (name) =>
    `📸 *${name} looks at you with gleaming eyes...*\n_"Trust me. I have something prepared for you."_`,
  (name) =>
    `📸 *${name} tucks their hair back and gives you a look...*\n_"Want to see what I was thinking about? Just ask."_`,
]

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { character_id, message } = await request.json()

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

      const { error: updateError } = await supabaseAdmin
        .from('users')
        .update({ gems: newGems, hook_messages_remaining: newHookRemaining })
        .eq('telegram_id', tid)

      if (updateError) {
        console.error('[chat] ❌ Update gems FAILED:', updateError)
        return NextResponse.json({
          error: 'Error actualizando gemas',
          detail: updateError.message,
        }, { status: 500 })
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

    // Historial con ordenamiento estable (created_at + id)
    const { data: history } = await supabaseAdmin
      .from('conversation_history')
      .select('id, role, content, created_at')
      .eq('telegram_id', tid)
      .eq('character_id', character_id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(8)

    const { count: userMsgCount } = await supabaseAdmin
      .from('conversation_history')
      .select('*', { count: 'exact', head: true })
      .eq('telegram_id', tid)
      .eq('character_id', character_id)
      .eq('role', 'user')

    const currentUserMsgCount = userMsgCount || 0
    const nextUserMsgCount = currentUserMsgCount + 1
    const level = getLevelFromMessages(currentUserMsgCount)

    const rawHistory = history || []
    const sortedHistory = [...rawHistory].sort((a: any, b: any) => {
      const cmp = String(a.created_at || '').localeCompare(String(b.created_at || ''))
      if (cmp !== 0) return cmp
      return (a.id || 0) - (b.id || 0)
    })

    const messages = sortedHistory.reverse().map((m: any) => ({
      role: m.role,
      content: m.content,
    }))
    messages.push({ role: 'user', content: message })

    const personality = getLevelPersonality(character.archetype, level.level, lang)

    const characterPrompt = lang === 'es'
      ? `Eres ${character.character_name}, rol: ${character.archetype}.\n${personality}\n\nEl usuario se llama ${user.first_name}. Recuerda su nombre y úsalo naturalmente.\nMantén siempre tu personalidad y rol. Nunca rompas el personaje.`
      : `You are ${character.character_name}, role: ${character.archetype}.\n${personality}\n\nThe user's name is ${user.first_name}. Remember their name and use it naturally.\nAlways maintain your personality and role. Never break character.`

    const intensity = getIntensity(currentUserMsgCount, isHookMode)
    const systemPrompt = buildSystemPrompt(lang, intensity, characterPrompt)

    let responseText: string
    try {
      responseText = await generateAIResponse(messages, systemPrompt, intensity)
    } catch (aiError) {
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

    // ✅ Hook mode warning
    if (isHookMode || (newHookRemaining > 0 && newGems <= 0)) {
      finalText += lang === 'es'
        ? `\n\n⚠️ ${newHookRemaining} mensajes gratis restantes`
        : `\n\n⚠️ ${newHookRemaining} free messages remaining`
    }

    // ✅ Mensaje cinemático de invitación cuando se alcanza un hito
    const photoOfferAvailable = isPhotoMilestone(nextUserMsgCount)
    if (photoOfferAvailable) {
      const invites = lang === 'es' ? PHOTO_INVITES_ES : PHOTO_INVITES_EN
      const invite = invites[Math.floor(Math.random() * invites.length)]
      finalText += `\n\n${invite(character.character_name)}`
    }

    return NextResponse.json({
      response: finalText,
      remaining_gems: newGems,
      hook_messages_remaining: newHookRemaining,
      is_hook_mode: isHookMode,
      intensity,
      level: level.level,
      photo_offer_available: photoOfferAvailable,
    })
  } catch (error: any) {
    console.error('Error en chat:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
