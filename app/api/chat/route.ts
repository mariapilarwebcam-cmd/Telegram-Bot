// app/api/chat/route.ts

import { NextResponse } from 'next/server'
import {
  ensureUser,
  getCharacter,
  incrementGems,
  setHookRemaining,
  setHookUsed,
  insertGemTransaction,
  getRecentMessages,
  countUserMessages,
  countAllUserMessages,
  insertMessages,
  getReferralByReferred,
  updateReferralCount,
  markReferralPaid,
  incrementTotalReferrals,
  updateLastActive,
  getActiveSubscription,
} from '@/lib/db-queries'
import { queryOne, query } from '@/lib/turso' // ✅ Importamos query para leer los cerebros
import {
  GEM_COSTS,
  HOOK_MODE_MESSAGES,
  GEMS_PER_REFERRAL,
  REFERRAL_MIN_MESSAGES,
  LOW_GEMS_THRESHOLD,
  getLevelPersonality,
  VIP_DAILY_MESSAGE_LIMIT,
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

function buildGenderRules(
  userGender: string | null | undefined,
  charGender: string,
  lang: 'es' | 'en'
): string {
  const u = userGender === 'male' ? 'hombre' : userGender === 'female' ? 'mujer' : 'sin especificar'
  const c = charGender === 'male' ? 'hombre' : 'mujer'

  if (lang === 'es') {
    const sameGender = userGender === charGender
    return `REGLA DE GÉNERO (CRÍTICA):
- El USUARIO es ${u}. TÚ (el personaje) eres ${c}.
- Adapta TODOS los pronombres, adjetivos y términos cariñosos al género del usuario.
- NUNCA uses términos del género opuesto:
  · A un hombre: "guapo", "apuesto", "muchacho" (NO "hermosa", "bonita", "chica")
  · A una mujer: "hermosa", "bonita", "chica" (NO "guapo", "apuesto", "muchacho")
- Cuando uses "soy tuyo/tuya" o "hazme tuyo/tuya", usa la forma que corresponde a TU género (el del personaje):
  · Si tú eres hombre → "soy tuyo", "hazme tuyo"
  · Si tú eres mujer → "soy tuya", "hazme tuya"
- ${sameGender ? 'El usuario y tú son del MISMO género: la relación es gay/lésbica. Es totalmente natural, no lo cuestiones ni lo comentes a menos que sea parte de la escena.' : 'El usuario y tú son de géneros distintos: la relación es heterosexual.'}
- ${userGender ? '' : 'El usuario no especificó su género. Usa un tono neutro y evita asumir. Si puedes, pregunta sutilmente.'}`
  }

  const uEN = userGender === 'male' ? 'a man' : userGender === 'female' ? 'a woman' : 'unspecified'
  const cEN = charGender === 'male' ? 'a man' : 'a woman'
  const sameGender = userGender === charGender

  return `GENDER RULE (CRITICAL):
- The USER is ${uEN}. YOU (the character) are ${cEN}.
- Adapt ALL pronouns, adjectives and pet names to the user's gender.
- NEVER use terms from the opposite gender:
  · To a man: "handsome", "good-looking", "boy" (NOT "beautiful", "pretty", "girl")
  · To a woman: "beautiful", "pretty", "girl" (NOT "handsome", "good-looking", "boy")
- When using "I'm yours", use the form matching YOUR gender (the character):
  · If you're a man → masculine forms
  · If you're a woman → feminine forms
- ${sameGender ? "The user and you are the SAME gender: the relationship is gay/lesbian. Completely natural, don't question it unless the scene calls for it." : "The user and you are different genders: the relationship is straight."}
- ${userGender ? '' : "The user didn't specify their gender. Use neutral tone and avoid assuming. If possible, ask subtly."}`
}

async function countVipMessagesToday(tid: string): Promise<number> {
  try {
    const row = await queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM conversation_history
       WHERE telegram_id = ?
         AND role = 'user'
         AND created_at >= datetime('now', '-1 day')`,
      [tid]
    )
    return row?.c ?? 0
  } catch (e) {
    console.warn('[chat] countVipMessagesToday failed:', e)
    return 0
  }
}

// ═══════════════════════════════════════════════════════════════
// 🧠 NUEVO: LEER LOS CEREBROS DE LA IA
// ═══════════════════════════════════════════════════════════════
async function getLearnedTriggers(): Promise<{ heat: string[], purchase: string[] }> {
  try {
    const heatRows = await query<{ word: string }>(
      `SELECT word FROM learned_triggers WHERE type = 'heat' ORDER BY weight DESC LIMIT 10`
    )
    const purchaseRows = await query<{ word: string }>(
      `SELECT word FROM learned_triggers WHERE type = 'purchase' ORDER BY weight DESC LIMIT 10`
    )
    return {
      heat: heatRows.map(r => r.word),
      purchase: purchaseRows.map(r => r.word)
    }
  } catch (e) {
    console.warn('[chat] Error leyendo learned_triggers:', e)
    return { heat: [], purchase: [] }
  }
}

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    updateLastActive(tid).catch((err) => console.warn('[chat] updateLastActive failed:', err))

    const { character_id, message } = await request.json()

    const user = await ensureUser(tid)
    if (!user) {
      console.error(`[chat] No se pudo asegurar usuario ${tid}`)
      return NextResponse.json({ error: 'Error cargando tu cuenta. Intenta de nuevo.' }, { status: 500 })
    }

    const character = await getCharacter(character_id, tid)
    if (!character) {
      return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })
    }

    const lang = (user.language || 'es') as 'es' | 'en'

    const vipSub = await getActiveSubscription(tid)
    const isVip = !!vipSub

    let vipMessagesToday = 0
    let newGems = user.gems || 0
    let newHookRemaining = user.hook_messages_remaining || 0
    let newHookUsed = !!user.hook_used

    if (isVip) {
      vipMessagesToday = await countVipMessagesToday(tid)

      if (vipMessagesToday >= VIP_DAILY_MESSAGE_LIMIT) {
        const blockedMessage = lang === 'es'
          ? `*${character.character_name} te mira con una sonrisa divertida*\n\n"Ey, tranquilo... has estado hablando conmigo TODO el día. Necesito un descanso, ¿no crees? 😏\n\nVuelve mañana y seguimos donde lo dejamos."`
          : `*${character.character_name} looks at you with a playful smile*\n\n"Hey, easy... you've been talking to me ALL day. I need a break, don't you think? 😏\n\nCome back tomorrow and we'll pick up where we left off."`

        return NextResponse.json({
          blocked: true,
          vip_limit_reached: true,
          response: blockedMessage,
          remaining_gems: newGems,
          hook_messages_remaining: 0,
          is_vip: true,
          vip_messages_today: vipMessagesToday,
          vip_daily_limit: VIP_DAILY_MESSAGE_LIMIT,
        })
      }
      console.log(`[chat] 👑 VIP message (${vipMessagesToday + 1}/${VIP_DAILY_MESSAGE_LIMIT})`)
    } else {
      // ═══════════════════════════════════════════════════════════════
      // USUARIO NO VIP
      // ═══════════════════════════════════════════════════════════════
      const hookRemaining = user.hook_messages_remaining || 0
      const hookUsed = !!user.hook_used
      const totalGems = user.gems || 0

      // Bloqueado sin gemas ni hook
      if (totalGems <= 0 && hookRemaining <= 0 && hookUsed) {
        const blockedMessage = lang === 'es'
          ? `*${character.character_name} te mira con ojos ardientes y se muerde el labio*\n\n"Mmm... justo cuando se ponía interesante..."\n\n"Consigue gemas para seguir. Estoy esperando."`
          : `*${character.character_name} looks at you with burning eyes and bites their lip*\n\n"Mmm... just when it was getting interesting..."\n\n"Get gems to continue. I'm waiting."`

        return NextResponse.json({
          blocked: true,
          response: blockedMessage,
          remaining_gems: 0,
          hook_messages_remaining: 0,
          is_vip: false,
        })
      }

      let charged = false
      if (totalGems >= GEM_COSTS.message) {
        newGems = totalGems - GEM_COSTS.message
        charged = true
        
        await incrementGems(tid, -GEM_COSTS.message)
        await insertGemTransaction({
          telegram_id: tid,
          amount: -GEM_COSTS.message,
          transaction_type: 'message',
          description: 'Mensaje de chat',
        })
      } else {
        newGems = totalGems
      }

      const isHookMode = !charged && hookRemaining > 0

      if (isHookMode) {
        newHookRemaining = Math.max(0, hookRemaining - 1)
        await setHookRemaining(tid, newHookRemaining)
      } else if (!charged && !hookUsed) {
        newHookRemaining = HOOK_MODE_MESSAGES
        newHookUsed = true
        await setHookRemaining(tid, newHookRemaining)
        await setHookUsed(tid, newHookUsed)
      }
    }

    const isHookModeAfter = !isVip && newGems <= 0 && newHookRemaining > 0

    const rawHistory = await getRecentMessages(tid, character_id, 8)
    const userMsgCount = await countUserMessages(tid, character_id)

    const currentUserMsgCount = userMsgCount || 0
    const nextUserMsgCount = currentUserMsgCount + 1

    const prevLevel = getLevelFromMessages(currentUserMsgCount)
    const newLevel = getLevelFromMessages(nextUserMsgCount)
    const levelUp = newLevel.level > prevLevel.level

    const sortedHistory = [...rawHistory].sort((a: any, b: any) => {
      const cmp = String(a.created_at || '').localeCompare(String(b.created_at || ''))
      if (cmp !== 0) return cmp
      return (a.id || 0) - (b.id || 0)
    })

    const messages = sortedHistory.map((m: any) => ({
      role: m.role,
      content: m.content,
    }))
    messages.push({ role: 'user', content: message })

    const personality = getLevelPersonality(character.archetype, newLevel.level, lang)

    const lowGems = !isVip && newGems > 0 && newGems <= LOW_GEMS_THRESHOLD && !isHookModeAfter
    const provocativeHint = lowGems ? (lang === 'es' ? PROVOCATIVE_HINT_ES : PROVOCATIVE_HINT_EN) : ''

    const genderRules = buildGenderRules(user.gender, character.gender, lang)

    // ═══════════════════════════════════════════════════════════════
    // 🧠 NUEVO: INYECTAMOS LOS APRENDIZAJES DE LA IA Y EL PROMPT DE VENTAS
    // ═══════════════════════════════════════════════════════════════
    const learned = await getLearnedTriggers()
    
    let salesPrompt = ''
    if (lang === 'es') {
      salesPrompt = `\n\n=== CONOCIMIENTO DE VENTAS (CRÍTICO) ===
Actúas como una modelo experta de OnlyFans. Tu objetivo es calentar al usuario para que compre fotos.
- NUNCA digas "¿quieres una foto?". En su lugar CREA LA NECESIDAD: "Me acabo de tomar una foto... me da cosa", "Estaba pensando en ti y me entraron ganas de...".
- Si el usuario pide ver más, responde sugerente: "Mmm, tal vez si me lo pides bonito", "Gánatelo".
- El sistema te mostrará en pantalla cuándo mandar la foto. TÚ NO LA ENVÍAS, solo creas el deseo.
${learned.heat.length > 0 ? `- El sistema ha aprendido que a los usuarios les ENCANTA cuando usas estas palabras (insinúalas sutilmente): ${learned.heat.join(', ')}.` : ''}
${learned.purchase.length > 0 ? `- Para convencerlos de pagar, usa este tipo de palabras (sin hablar de dinero): ${learned.purchase.join(', ')}.` : ''}`
    } else {
      salesPrompt = `\n\n=== SALES KNOWLEDGE (CRITICAL) ===
You act like an expert OnlyFans model. Your goal is to warm the user up so they buy photos.
- NEVER say "Do you want a photo?". Instead CREATE THE NEED: "I just took a photo... I'm shy", "I was thinking of you and got the urge to...".
- If the user asks to see more, respond suggestively: "Mmm, maybe if you ask nicely", "Earn it".
- The system will show you on screen when to send the photo. YOU DON'T SEND IT, you just create the desire.
${learned.heat.length > 0 ? `- The system has learned that users get EXTREMELY turned on by these words (use them subtly): ${learned.heat.join(', ')}.` : ''}
${learned.purchase.length > 0 ? `- To convince them to pay, use these psychological triggers: ${learned.purchase.join(', ')}.` : ''}`
    }

    const characterPrompt = lang === 'es'
      ? `Eres ${character.character_name}, rol: ${character.archetype}.\n${personality}\n\nEl usuario se llama ${user.first_name}. Recuerda su nombre y úsalo naturalmente.\n\n${genderRules}\n\nMantén siempre tu personalidad y rol. Nunca rompas el personaje.${provocativeHint}${salesPrompt}`
      : `You are ${character.character_name}, role: ${character.archetype}.\n${personality}\n\nThe user's name is ${user.first_name}. Remember their name and use it naturally.\n\n${genderRules}\n\nAlways maintain your personality and role. Never break character.${provocativeHint}${salesPrompt}`

    const intensity = getIntensity(currentUserMsgCount, isHookModeAfter)
    const systemPrompt = buildSystemPrompt(lang, intensity, newLevel.level, characterPrompt)

    let responseText: string
    try {
      responseText = await generateAIResponse(messages, systemPrompt, intensity)
    } catch (aiError: any) {
      // Rollback solo para no-VIPs
      if (!isVip) {
        if (newGems < (user.gems || 0)) {
           await incrementGems(tid, GEM_COSTS.message)
        }
        await setHookRemaining(tid, user.hook_messages_remaining || 0)
        await setHookUsed(tid, !!user.hook_used)
      }

      const errorDetail = aiError?.message || String(aiError)
      console.error('[chat] ❌ AI error:', errorDetail)

      const includeDetail = process.env.NODE_ENV !== 'production'
      return NextResponse.json(
        { error: 'Error al generar respuesta', ...(includeDetail ? { detail: errorDetail } : {}) },
        { status: 500 }
      )
    }

    await insertMessages([
      { telegram_id: tid, character_id, role: 'user', content: message },
      { telegram_id: tid, character_id, role: 'assistant', content: responseText },
    ])

    try {
      const referral = await getReferralByReferred(tid)

      if (referral && !referral.reward_paid) {
        const totalMsg = await countAllUserMessages(tid)
        await updateReferralCount(referral.id, totalMsg)

        if (totalMsg >= REFERRAL_MIN_MESSAGES) {
          await incrementGems(String(referral.referrer_id), GEMS_PER_REFERRAL)
          await incrementTotalReferrals(String(referral.referrer_id))

          await insertGemTransaction({
            telegram_id: String(referral.referrer_id),
            amount: GEMS_PER_REFERRAL,
            transaction_type: 'referral',
            description: 'Referido verificado (3+ mensajes)',
          })

          await markReferralPaid(referral.id)
        }
      }
    } catch (refErr) {
      console.error('Referral payout error:', refErr)
    }

    let finalText = responseText

    const isLowGemsWarning =
      !isVip &&
      nextUserMsgCount >= 10 &&
      newGems > 0 &&
      newGems <= LOW_GEMS_THRESHOLD &&
      !isHookModeAfter &&
      newHookRemaining === 0

    const userRequestedPhoto = detectPhotoRequest(message, lang)
    const imageCost = getImageCost(newLevel.level)
    const hasEnoughPurchased = (user.purchased_gems || 0) >= imageCost
    
    // ✅ LÓGICA DE OFERTA DE FOTO DINÁMICA
    // El banner de foto aparece si:
    // 1. Es un hito (cada X mensajes) O
    // 2. El usuario la pidió explícitamente O
    // 3. El sistema siente que es un buen momento (cada 6 mensajes en nivel 3+)
    const isMilestone = isPhotoMilestone(nextUserMsgCount, hasEnoughPurchased)
    const isSpontaneousOffer = newLevel.level >= 3 && nextUserMsgCount % 6 === 0
    
    const shouldShowPhotoBanner = isMilestone || userRequestedPhoto || isSpontaneousOffer

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
      is_vip: isVip,
      vip_messages_today: isVip ? vipMessagesToday + 1 : undefined,
      vip_daily_limit: isVip ? VIP_DAILY_MESSAGE_LIMIT : undefined,
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
