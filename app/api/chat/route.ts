// app/api/chat/route.ts

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ensureUser } from '@/lib/user-helpers'
import {
  GEM_COSTS,
  HOOK_MODE_MESSAGES,
  GEMS_PER_REFERRAL,
  REFERRAL_MIN_MESSAGES,
  LOW_GEMS_THRESHOLD,
  getLevelPersonality,
} from '@/lib/constants'
import {
  getLevelFromMessages,
  getImageCost,
  isPhotoMilestone,
  getNextLevelThreshold,
} from '@/lib/levels'
import { generateAIResponse, getIntensity, buildSystemPrompt } from '@/lib/ai'

export const maxDuration = 60

const PHOTO_INVITES_ES: Array<(name: string) => string> = [
  (name) => `📸 *${name} se muerde el labio y te mira fijamente...*\n_"Espera... quiero mandarte algo. Solo para ti."_`,
  (name) => `📸 *${name} sonríe de lado y saca el teléfono...*\n_"No te muevas... esto te va a encantar."_`,
  (name) => `📸 *${name} baja la voz y se acerca...*\n_"Ven... quiero mostrarte algo que nadie más ha visto."_`,
  (name) => `📸 *${name} te mira con ojos brillantes...*\n_"Confía en mí. Tengo algo preparado para ti."_`,
  (name) => `📸 *${name} se recoge el pelo y te dedica una mirada...*\n_"¿Quieres ver lo que estaba pensando? Solo tienes que pedirlo."_`,
]

const PHOTO_INVITES_EN: Array<(name: string) => string> = [
  (name) => `📸 *${name} bites their lip and stares at you...*\n_"Wait... I want to send you something. Just for you."_`,
  (name) => `📸 *${name} smirks and pulls out their phone...*\n_"Don't move... you're going to love this."_`,
  (name) => `📸 *${name} lowers their voice and leans in...*\n_"Come here... I want to show you something no one else has seen."_`,
  (name) => `📸 *${name} looks at you with gleaming eyes...*\n_"Trust me. I have something prepared for you."_`,
  (name) => `📸 *${name} tucks their hair back and gives you a look...*\n_"Want to see what I was thinking about? Just ask."_`,
]

const PHOTO_KEYWORDS_ES = [
  'foto', 'selfie', 'imagen', 'picture', 'fotito',
  'mándame', 'mandame', 'envíame', 'enviame',
  'muéstrame', 'muestrame', 'enséñame', 'ensename',
  'manda una', 'envía una', 'envia una', 'mandame una',
]

const PHOTO_KEYWORDS_EN = [
  'photo', 'selfie', 'picture', 'pic',
  'send me', 'show me', 'give me',
]

function detectPhotoRequest(message: string, lang: 'es' | 'en'): boolean {
  const lower = message.toLowerCase()
  const keywords = lang === 'es' ? PHOTO_KEYWORDS_ES : PHOTO_KEYWORDS_EN
  return keywords.some((k) => lower.includes(k))
}

const PROVOCATIVE_HINT_ES = `\n\n⚠️ CONTEXTO CRÍTICO: Al usuario le quedan MUY pocas gemas. Este podría ser tu último mensaje con él. Habla de forma MÁS provocativa, insinuante, urgente y sensual. Hazle sentir que sería una tragedia detenerse justo ahora. Cierra con un gancho que le haga querer continuar. NO menciones gemas, precios o compras — eso lo hace el sistema. Solo intensifica tu rol.`

const PROVOCATIVE_HINT_EN = `\n\n⚠️ CRITICAL CONTEXT: The user has VERY few gems left. This might be your last message with them. Speak more provocatively, suggestively, urgently and sensually. Make them feel it would be a tragedy to stop right now. End with a hook that makes them want to continue. Do NOT mention gems, prices or purchases — the system handles that. Just intensify your role.`

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { character_id, message } = await request.json()

    // ✅ FIX: crea el usuario si no existe
    const user = await ensureUser(tid)
    if (!user) {
      console.error(`[chat] No se pudo asegurar usuario ${tid}`)
      return NextResponse.json(
        { error: 'Error cargando tu cuenta. Intenta de nuevo.' },
        { status: 500 }
      )
    }

    const { data: character } = await supabaseAdmin
      .from('user_characters')
      .select('*')
      .eq('id', character_id)
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!character) {
      return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })
    }

    const lang = (user.language || 'es') as 'es' | 'en'
    const hookRemaining = user.hook_messages_remaining || 0
    const hookUsed = user.hook_used || false
    const totalGems = user.gems || 0

    if (totalGems <= 0 && hookRemaining <= 0 && hookUsed) {
      const blockedMessage = lang === 'es'
        ? `*${character.character_name} te mira con ojos ardientes y se muerde el labio*\n\n"Mmm... justo cuando se ponía interesante..."\n\n"Consigue gemas para seguir. Estoy esperando."`
        : `*${character.character_name} looks at you with burning eyes and bites their lip*\n\n"Mmm... just when it was getting interesting..."\n\n"Get gems to continue. I'm waiting."`

      return NextResponse.json({
        blocked: true,
        response: blockedMessage,
        remaining_gems: 0,
        hook_messages_remaining: 0,
      })
    }

    const isHookMode = totalGems <= 0 && hookRemaining > 0

    // ✅ FIX: calcular hook state ANTES del update, pero reportar el estado DESPUÉS
    let newHookRemaining = hookRemaining
    let newGems = totalGems
    let newHookUsed = hookUsed

    if (!isHookMode) {
      newGems = totalGems - GEM_COSTS.message

      if (newGems <= 0 && newHookRemaining <= 0 && !hookUsed) {
        newHookRemaining = HOOK_MODE_MESSAGES
        newHookUsed = true
      }

      // ✅ RPC ATÓMICA: descuenta 1 gema sin race condition
      const { error: rpcErr } = await supabaseAdmin.rpc('increment_gems', {
        p_telegram_id: tid,
        p_amount: -GEM_COSTS.message,
      })

      if (rpcErr) {
        console.error('[chat] ❌ RPC increment_gems FAILED:', rpcErr)
        return NextResponse.json(
          { error: 'Error actualizando gemas', detail: rpcErr.message },
          { status: 500 }
        )
      }

      // Actualizar hook state (no atómico pero no es crítico)
      await supabaseAdmin
        .from('users')
        .update({
          hook_messages_remaining: newHookRemaining,
          hook_used: newHookUsed,
        })
        .eq('telegram_id', tid)

      await supabaseAdmin.from('gem_transactions').insert({
        telegram_id: tid,
        amount: -GEM_COSTS.message,
        transaction_type: 'message',
        description: 'Mensaje de chat',
      })
    } else {
      newHookRemaining = Math.max(0, hookRemaining - 1)
      await supabaseAdmin
        .from('users')
        .update({ hook_messages_remaining: newHookRemaining })
        .eq('telegram_id', tid)
    }

    // ✅ Determinar is_hook_mode DESPUÉS de las actualizaciones
    const isHookModeAfter = newGems <= 0 && newHookRemaining > 0

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

    const prevLevel = getLevelFromMessages(currentUserMsgCount)
    const newLevel = getLevelFromMessages(nextUserMsgCount)
    const levelUp = newLevel.level > prevLevel.level

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

    const personality = getLevelPersonality(character.archetype, newLevel.level, lang)

    const lowGems = newGems > 0 && newGems <= LOW_GEMS_THRESHOLD && !isHookModeAfter
    const provocativeHint = lowGems
      ? (lang === 'es' ? PROVOCATIVE_HINT_ES : PROVOCATIVE_HINT_EN)
      : ''

    const characterPrompt = lang === 'es'
      ? `Eres ${character.character_name}, rol: ${character.archetype}.\n${personality}\n\nEl usuario se llama ${user.first_name}. Recuerda su nombre y úsalo naturalmente.\nMantén siempre tu personalidad y rol. Nunca rompas el personaje.${provocativeHint}`
      : `You are ${character.character_name}, role: ${character.archetype}.\n${personality}\n\nThe user's name is ${user.first_name}. Remember their name and use it naturally.\nAlways maintain your personality and role. Never break character.${provocativeHint}`

    const intensity = getIntensity(currentUserMsgCount, isHookModeAfter)
    const systemPrompt = buildSystemPrompt(lang, intensity, characterPrompt)

    let responseText: string
    try {
      responseText = await generateAIResponse(messages, systemPrompt, intensity)
    } catch (aiError: any) {
      // Rollback manual: devolver la gema
      await supabaseAdmin.rpc('increment_gems', {
        p_telegram_id: tid,
        p_amount: GEM_COSTS.message,
      })
      await supabaseAdmin
        .from('users')
        .update({
          hook_messages_remaining: hookRemaining,
          hook_used: hookUsed,
        })
        .eq('telegram_id', tid)

      const errorDetail = aiError?.message || String(aiError)
      console.error('[chat] ❌ AI error:', errorDetail)

      const includeDetail = process.env.NODE_ENV !== 'production'
      return NextResponse.json(
        {
          error: 'Error al generar respuesta',
          ...(includeDetail ? { detail: errorDetail } : {}),
        },
        { status: 500 }
      )
    }

    await supabaseAdmin.from('conversation_history').insert([
      { telegram_id: tid, character_id, role: 'user', content: message },
      { telegram_id: tid, character_id, role: 'assistant', content: responseText },
    ])

    // ── Referidos ──
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

        if (totalMsg >= REFERRAL_MIN_MESSAGES) {
          // ✅ RPC atómica
          await supabaseAdmin.rpc('increment_gems', {
            p_telegram_id: String(referral.referrer_id),
            p_amount: GEMS_PER_REFERRAL,
          })

          // Total referrals (contador, no crítico si hay race)
          const { data: refUser } = await supabaseAdmin
            .from('users')
            .select('total_referrals')
            .eq('telegram_id', String(referral.referrer_id))
            .maybeSingle()

          if (refUser) {
            await supabaseAdmin
              .from('users')
              .update({
                total_referrals: (refUser.total_referrals || 0) + 1,
              })
              .eq('telegram_id', String(referral.referrer_id))
          }

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
    } catch (refErr) {
      console.error('Referral payout error:', refErr)
    }

    let finalText = responseText

    const isLowGemsWarning =
      nextUserMsgCount >= 10 &&
      newGems > 0 &&
      newGems <= LOW_GEMS_THRESHOLD &&
      !isHookModeAfter &&
      newHookRemaining === 0

    const userRequestedPhoto = detectPhotoRequest(message, lang)
    const imageCost = getImageCost(newLevel.level)
    const hasEnoughPurchased = (user.purchased_gems || 0) >= imageCost
    const isMilestone = isPhotoMilestone(nextUserMsgCount, hasEnoughPurchased)
    const shouldShowPhotoBanner = isMilestone || userRequestedPhoto

    if (shouldShowPhotoBanner) {
      const invites = lang === 'es' ? PHOTO_INVITES_ES : PHOTO_INVITES_EN
      const invite = invites[Math.floor(Math.random() * invites.length)]
      finalText += `\n\n${invite(character.character_name)}`
    }

    const nextLevelAt = getNextLevelThreshold(newLevel.level)

    return NextResponse.json({
      response: finalText,
      remaining_gems: newGems,
      hook_messages_remaining: newHookRemaining,
      is_hook_mode: isHookModeAfter,
      intensity,
      level: newLevel.level,
      photo_offer_available: shouldShowPhotoBanner,
      level_up: levelUp,
      new_level: levelUp ? newLevel.level : null,
      new_level_badge: levelUp ? newLevel.badgeKey : null,
      low_gems_warning: isLowGemsWarning,
      low_gems_count: isLowGemsWarning ? newGems : 0,
      total_user_messages: nextUserMsgCount,
      next_level_at: nextLevelAt,
    })
  } catch (error: any) {
    console.error('Error en chat:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
