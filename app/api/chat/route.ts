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
  getActivePass,
  consumePass,
  updateSpendState,
  getSpendState,
  grantPass
} from '@/lib/db-queries'
import { queryOne, query } from '@/lib/turso'
import {
  GEM_COSTS,
  HOOK_MODE_MESSAGES,
  GEMS_PER_REFERRAL,
  REFERRAL_MIN_MESSAGES,
  LOW_GEMS_THRESHOLD,
  getLevelPersonality,
  VIP_DAILY_MESSAGE_LIMIT,
  isVipArchetype // ✅ IMPORTAMOS LA FUNCIÓN
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

    const { character_id, message, accept_penalty } = await request.json()

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Mensaje inválido' }, { status: 400 })
    }

    const messageLength = message.length
    let penaltyGems = 0

    if (messageLength > 750) {
      return NextResponse.json(
        { error: 'message_too_long', message: 'El límite máximo es de 750 caracteres.' },
        { status: 400 }
      )
    }

    if (messageLength > 600) {
      if (!accept_penalty) {
        return NextResponse.json({
          requires_penalty: true,
          penalty_gems: 1,
          message: 'Has superado los 600 caracteres. Enviar este mensaje costará 1 gema extra. ¿Aceptas?'
        }, { status: 200 })
      }
      penaltyGems = 1
    }

    const user = await ensureUser(tid)
    if (!user) {
      return NextResponse.json({ error: 'Error cargando tu cuenta. Intenta de nuevo.' }, { status: 500 })
    }

    const character = await getCharacter(character_id, tid)
    if (!character) {
      return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })
    }

    const lang = (user.language || 'es') as 'es' | 'en'
    const vipSub = await getActiveSubscription(tid)
    const isVip = !!vipSub

    // ✅ BUG FIX VIP: Bloquear el chat si el personaje es VIP y la suscripción expiró
    if (isVipArchetype(character.archetype) && !isVip) {
      return NextResponse.json({
        blocked: true,
        vip_expired: true,
        response: lang === 'es'
          ? `*${character.character_name} te mira con tristeza y aparta la mirada*\n\n"Lo siento... mi tiempo contigo se ha agotado. Si quieres seguir viéndome, tendrás que renovar tu acceso VIP."`
          : `*${character.character_name} looks at you sadly and looks away*\n\n"I'm sorry... our time together has run out. If you want to see me again, you'll need to renew your VIP access."`
      }, { status: 403 })
    }

    let vipMessagesToday = 0
    let newGems = user.gems || 0
    let newBonusGems = user.bonus_gems || 0
    let newHookRemaining = user.hook_messages_remaining || 0
    let newHookUsed = !!user.hook_used

    const activePass = await getActivePass(tid)
    let usedPass = false
    let passMessage = ''

    if (activePass) {
      await consumePass(activePass.id)
      usedPass = true
    } else if (isVip) {
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
          remaining_bonus_gems: newBonusGems,
          hook_messages_remaining: 0,
          is_vip: true,
          vip_messages_today: vipMessagesToday,
          vip_daily_limit: VIP_DAILY_MESSAGE_LIMIT,
        })
      }

      if (penaltyGems > 0) {
        const vipCharge = await queryOne<{ gems: number }>(
          `UPDATE users SET gems = gems - ? WHERE telegram_id = ? AND gems >= ? RETURNING gems`,
          [penaltyGems, tid, penaltyGems]
        )
        if (!vipCharge) {
          return NextResponse.json({ blocked: true, response: 'No tienes gemas suficientes para el recargo.' }, { status: 402 })
        }
        newGems = vipCharge.gems
        await insertGemTransaction({ telegram_id: tid, amount: -penaltyGems, transaction_type: 'message_penalty', description: 'Recargo por mensaje largo (VIP)' })
      }
    } else {
      const hookRemaining = user.hook_messages_remaining || 0
      const hookUsed = !!user.hook_used
      const totalCost = GEM_COSTS.message + penaltyGems
      
      const hasTotalGems = (newBonusGems + newGems) >= totalCost

      if (!hasTotalGems && hookRemaining <= 0 && hookUsed) {
        const blockedMessage = lang === 'es'
          ? `*${character.character_name} te mira con ojos ardientes y se muerde el labio*\n\n"Mmm... justo cuando se ponía interesante..."\n\n"Consigue gemas para seguir. Estoy esperando."`
          : `*${character.character_name} looks at you with burning eyes and bites their lip*\n\n"Mmm... just when it was getting interesting..."\n\n"Get gems to continue. I'm waiting."`

        return NextResponse.json({
          blocked: true,
          response: blockedMessage,
          remaining_gems: newGems,
          remaining_bonus_gems: newBonusGems,
          hook_messages_remaining: 0,
          is_vip: false,
        })
      }

      let charged = false
      
      if (newBonusGems >= totalCost) {
        const bonusResult = await queryOne<{ bonus_gems: number }>(
          `UPDATE users SET bonus_gems = bonus_gems - ? WHERE telegram_id = ? AND bonus_gems >= ? RETURNING bonus_gems`,
          [totalCost, tid, totalCost]
        )
        if (bonusResult) {
          newBonusGems = bonusResult.bonus_gems
          charged = true
        }
      }

      if (!charged) {
        const chargeResult = await queryOne<{ gems: number }>(
          `UPDATE users SET gems = gems - ? WHERE telegram_id = ? AND gems >= ? RETURNING gems`,
          [totalCost, tid, totalCost]
        )

        if (chargeResult) {
          newGems = chargeResult.gems
          charged = true
          await insertGemTransaction({
            telegram_id: tid,
            amount: -totalCost,
            transaction_type: 'message',
            description: penaltyGems > 0 ? 'Mensaje + recargo por longitud' : 'Mensaje de chat',
          })

          await updateSpendState(tid, totalCost)
          const spendState = await getSpendState(tid)
          
          if (spendState && spendState.gems_spent_24h >= 250) {
            await grantPass(tid, 150)
            passMessage = lang === 'es' 
              ? '\n\n🎁 *¡Has desbloqueado un Pase de Mensajes VIP!* Veo que estás muy conectado hoy. Te regalo **150 mensajes gratis por las próximas 24 horas** para que no tengas que preocuparte por las gemas. Descansa y disfruta.' 
              : '\n\n🎁 *You unlocked a VIP Message Pass!* I see you are very connected today. I am gifting you **150 free messages for the next 24 hours** so you don\'t have to worry about gems. Rest and enjoy.'
          }
        }
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

    const isHookModeAfter = !isVip && newGems <= 0 && newBonusGems <= 0 && newHookRemaining > 0
    const rawHistory = await getRecentMessages(tid, character_id, 8)
    const userMsgCount = await countUserMessages(tid, character_id)

    const currentUserMsgCount = userMsgCount || 0
    const nextUserMsgCount = currentUserMsgCount + 1

    const prevLevel = getLevelFromMessages(currentUserMsgCount)
    const newLevel = getLevelFromMessages(nextUserMsgCount)
    const levelUp = newLevel.level > prevLevel.level

    const lastAssistantMsg = await queryOne<{ id: number, reaction: string }>(
      `SELECT id, reaction FROM conversation_history 
       WHERE telegram_id = ? AND character_id = ? AND role = 'assistant' 
       ORDER BY id DESC LIMIT 1`,
      [tid, character_id]
    )
    
    const hotEmojis = ['❤️', '🔥', '😈', '💦', '🍆', '🍑', '🥵', '💋']
    const hadRecentHotReaction = lastAssistantMsg?.reaction && hotEmojis.includes(lastAssistantMsg.reaction)
    
    const isPeakDesire = hadRecentHotReaction || levelUp

    const spend7dRow = await queryOne<{ total: number }>(
      `SELECT SUM(ABS(amount)) as total FROM gem_transactions 
       WHERE telegram_id = ? AND amount < 0 
         AND created_at >= datetime('now', '-7 days')`,
      [tid]
    )
    const spend7d = spend7dRow?.total || 0
    const shouldUpsellVip = !isVip && spend7d >= 150 && !usedPass

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
    const lowGems = !isVip && !usedPass && (newGems + newBonusGems) > 0 && (newGems + newBonusGems) <= LOW_GEMS_THRESHOLD && !isHookModeAfter
    const provocativeHint = lowGems ? (lang === 'es' ? PROVOCATIVE_HINT_ES : PROVOCATIVE_HINT_EN) : ''
    const genderRules = buildGenderRules(user.gender, character.gender, lang)

    const learned = await getLearnedTriggers()
    
    let salesPrompt = ''
    if (lang === 'es') {
      salesPrompt = `\n\n=== CONOCIMIENTO DE VENTAS (CRÍTICO) ===
Actúas como una modelo experta de OnlyFans. Tu objetivo es calentar al usuario para que compre fotos.
- NUNCA digas "¿quieres una foto?". En su lugar CREA LA NECESIDAD: "Me acabo de tomar una foto... me da cosa".
- Si el usuario pide ver más, responde sugerente: "Mmm, tal vez si me lo pides bonito".
${learned.heat.length > 0 ? `- El sistema ha aprendido que les ENCANTA estas palabras: ${learned.heat.join(', ')}.` : ''}
${learned.purchase.length > 0 ? `- Para convencerlos de pagar, usa palabras como: ${learned.purchase.join(', ')}.` : ''}`
    } else {
      salesPrompt = `\n\n=== SALES KNOWLEDGE (CRITICAL) ===
You act like an expert OnlyFans model. Create the need. NEVER say "Do you want a photo?".
${learned.heat.length > 0 ? `- The system learned users love these words: ${learned.heat.join(', ')}.` : ''}`
    }

    let vipUpsellPrompt = ''
    if (shouldUpsellVip) {
      vipUpsellPrompt = lang === 'es'
        ? `\n\n⚠️ NOTA DE SISTEMA: El usuario ha gastado ${Math.floor(spend7d)} gemas esta semana. Menciónale de forma natural y sugerente que con la suscripción VIP habría ahorrado mucho más y tendría imágenes gratis. (No lo obligues, solo siéntalo como una buena oferta).`
        : `\n\n⚠️ SYSTEM NOTE: The user has spent ${Math.floor(spend7d)} gems this week. Naturally and suggestively mention that with a VIP subscription they would have saved a lot more and would have free images. (Don't force it, just make it feel like a good deal).`
    }

    let photoNudge = ''
    const reversedHistory = [...rawHistory] 
    const lockedPhotoMsgIndex = reversedHistory.findIndex(m => m.content.includes('locked:'))
    
    if (lockedPhotoMsgIndex === 2 || lockedPhotoMsgIndex === 3) {
      const match = reversedHistory[lockedPhotoMsgIndex].content.match(/locked:(\d+)@/)
      if (match) {
        const offerId = match[1]
        const photoStatus = await queryOne<{ state: string }>(`SELECT state FROM photo_offers WHERE id = ?`, [offerId])
        
        if (photoStatus && photoStatus.state === 'locked') {
          if (lang === 'es') {
            photoNudge = character.gender === 'male'
              ? `\n\n⚠️ NOTA DE COMPORTAMIENTO: Hace un par de mensajes le enviaste una foto y la ignoró. Reclámaselo de forma natural, con arrogancia y seguridad. Variaciones: "¿No vas a decir nada sobre lo que te envié?", "Veo que te dejé sin palabras", "Te mandé algo especial y ni un gracias".`
              : `\n\n⚠️ NOTA DE COMPORTAMIENTO: Hace un par de mensajes le enviaste una foto y la ignoró. Reclámaselo de forma natural, coqueta y juguetona. Variaciones: "¿No vas a decir nada sobre mi foto?", "Veo que te quedaste mirando y no escribiste nada 😏", "Te mandé algo y ni lo abriste... qué grosero".`
          } else {
            photoNudge = character.gender === 'male'
              ? `\n\n⚠️ BEHAVIOR NOTE: A couple of messages ago you sent a photo and they ignored it. Reclaim it naturally, with arrogance and confidence. Variations: "Are you going to say anything about what I sent?", "Cat got your tongue?", "I sent you something special and not even a thank you."`
              : `\n\n⚠️ BEHAVIOR NOTE: A couple of messages ago you sent a photo and they ignored it. Reclaim it naturally, playfully and flirtatiously. Variations: "Are you going to say anything about my photo?", "I see you just stared and didn't type 😏", "I sent you something and you didn't even open it... rude."`
          }
        }
      }
    }

    const characterPrompt = lang === 'es'
      ? `Eres ${character.character_name}, rol: ${character.archetype}.\n${personality}\n\nEl usuario se llama ${user.first_name}.\n\n${genderRules}\n\nNunca rompas el personaje.${provocativeHint}${photoNudge}${salesPrompt}${vipUpsellPrompt}`
      : `You are ${character.character_name}, role: ${character.archetype}.\n${personality}\n\nThe user's name is ${user.first_name}.\n\n${genderRules}\n\nNever break character.${provocativeHint}${photoNudge}${salesPrompt}${vipUpsellPrompt}`

    const intensity = getIntensity(currentUserMsgCount, isHookModeAfter)
    const systemPrompt = buildSystemPrompt(lang, intensity, newLevel.level, characterPrompt)

    let responseText: string
    try {
      responseText = await generateAIResponse(messages, systemPrompt, intensity)
    } catch (aiError: any) {
      if (!isVip && !usedPass) {
        if (newGems < (user.gems || 0)) {
           await incrementGems(tid, GEM_COSTS.message + penaltyGems)
        }
        await setHookRemaining(tid, user.hook_messages_remaining || 0)
        await setHookUsed(tid, !!user.hook_used)
      } else if (penaltyGems > 0) {
        await incrementGems(tid, penaltyGems)
      }

      const errorDetail = aiError?.message || String(aiError)
      console.error('[chat] ❌ AI error:', errorDetail)
      return NextResponse.json({ error: 'Error al generar respuesta', detail: errorDetail }, { status: 500 })
    }

    let userMessageId: number | undefined
    let assistantMessageId: number | undefined

    try {
      const inserted = await insertMessages([
        { telegram_id: tid, character_id, role: 'user', content: message },
        { telegram_id: tid, character_id, role: 'assistant', content: responseText },
      ])
      userMessageId = inserted[0]?.id
      assistantMessageId = inserted[1]?.id
    } catch (dbErr) {
      console.error('[chat] Error guardando mensajes:', dbErr)
    }

    try {
      const referral = await getReferralByReferred(tid)
      if (referral && !referral.reward_paid) {
        const totalMsg = await countAllUserMessages(tid)
        await updateReferralCount(referral.id, totalMsg)
        if (totalMsg >= REFERRAL_MIN_MESSAGES) {
          await incrementGems(String(referral.referrer_id), GEMS_PER_REFERRAL)
          await incrementTotalReferrals(String(referral.referrer_id))
          await insertGemTransaction({ telegram_id: String(referral.referrer_id), amount: GEMS_PER_REFERRAL, transaction_type: 'referral', description: `Referido verificado (${REFERRAL_MIN_MESSAGES}+ mensajes)` })
          await markReferralPaid(referral.id)
        }
      }
    } catch (refErr) {}

    let finalText = responseText
    const isLowGemsWarning = !isVip && !usedPass && nextUserMsgCount >= 10 && (newGems + newBonusGems) > 0 && (newGems + newBonusGems) <= LOW_GEMS_THRESHOLD && !isHookModeAfter && newHookRemaining === 0
    const userRequestedPhoto = detectPhotoRequest(message, lang)
    const imageCost = getImageCost(newLevel.level)
    const hasEnoughPurchased = (user.purchased_gems || 0) >= imageCost
    const isMilestone = isPhotoMilestone(nextUserMsgCount, hasEnoughPurchased)
    
    const isSpontaneousOffer = newLevel.level >= 3 && nextUserMsgCount % 6 === 0 && !usedPass
    
    const spendState = await getSpendState(tid)
    const shouldShowPhotoBanner = (isMilestone || userRequestedPhoto || isSpontaneousOffer || isPeakDesire) && spendState?.level !== 'rest'

    if (shouldShowPhotoBanner) {
      const invites = lang === 'es' ? PHOTO_INVITES_ES : PHOTO_INVITES_EN
      const invite = invites[Math.floor(Math.random() * invites.length)]
      finalText += `\n\n${invite(character.character_name)}`
    }

    if (passMessage) {
      finalText += passMessage
    }

    const nextLevelAt = getNextLevelThreshold(newLevel.level)

    return NextResponse.json({
      response: finalText,
      user_message_id: userMessageId,          
      assistant_message_id: assistantMessageId, 
      remaining_gems: newGems,
      remaining_bonus_gems: newBonusGems, 
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
      low_gems_count: isLowGemsWarning ? (newGems + newBonusGems) : 0,
      total_user_messages: nextUserMsgCount,
      next_level_at: nextLevelAt,
    })
  } catch (error: any) {
    console.error('Error en chat:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
