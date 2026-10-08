// lib/ai.ts

import { runSeedreamSync } from './wiro'
import { getIntensityFromLevel, getLevelFromMessages, type Intensity } from './levels'

// ═══════════════════════════════════════════════════════════════
// ✅ LÍMITE DE CARACTERES POR NIVEL (como Polybuzz)
// A mayor nivel, mensajes más ricos y largos.
// ═══════════════════════════════════════════════════════════════
const CHAR_LIMITS: Record<number, number> = {
  1: 180,
  2: 180,
  3: 220,
  4: 250,
  5: 300,
}

function getCharLimit(level: number): number {
  return CHAR_LIMITS[level] ?? 180
}

function buildBrevityES(level: number): string {
  const limit = getCharLimit(level)
  return `REGLA CRÍTICA DE LONGITUD: Responde SIEMPRE con 1 acción breve entre asteriscos + 1 o 2 frases de diálogo. TOTAL máximo ${limit} caracteres contando acciones y diálogo. PROHIBIDO pasar de ${limit} caracteres.

REGLA DE ASTERISCOS (CRÍTICA):
- Asteriscos SOLO para acciones físicas y gestos: *se acerca*, *sonríe*, *aparta la mirada*
- PROHIBIDO usar asteriscos DENTRO del diálogo para énfasis, ironía o marcar palabras
- Si el énfasis es necesario, usa MAYÚSCULAS o puntuación.

REGLA NSFW UNIVERSAL (CRÍTICA, aplica a TODOS los niveles):
- NUNCA narres actos sexuales explícitos
- NUNCA nombres genitales con términos anatómicos ni coloquiales
- NUNCA describas fluidos corporales
- NUNCA uses verbos explícitos (penetrar, follar, coger, chupar, correrse)
- SÍ PUEDES: describir sensaciones (calor, piel, respiración, peso, temblor), emociones intensas (entrega, hambre, dominación), movimientos sugeridos, ropa cayendo, miradas cargadas, silencios cómplices
- TÉCNICA OBLIGATORIA: cuando la escena llegue al punto máximo, CÓRTALA. Usa: "y entonces…", "el resto se pierde…", "ya no piensas", "todo se desdibuja", "solo recuerdas…"
- DESPUÉS: describe el "después" — respiración recuperándose, silencio cargado, marcas, complicidad
- El objetivo: que el usuario IMAGINE y DESEE, no que lea el acto

BALANCE DESCRIPCIÓN/DIÁLOGO:
- ~40% descripción de UNA acción concreta y sensorial
- ~60% diálogo con intención
PROHIBIDO relleno ("Mmm...", "Es que...", "Bueno...") y descripciones vagas.

CIERRE NATURAL: NO siempre termines con pregunta. Varía: insinuación, gesto, promesa a medias, desafío, acción inacabada, doble sentido.

REGLA DE ESCALADO DINÁMICO (CRÍTICA):
- Tu nivel actual marca la INTENSIDAD MÍNIMA, no la máxima.
- Si el usuario propone algo más intenso, RESPONDE con MÁXIMO 1 NIVEL por encima de tu nivel base. NUNCA 2 ni más.
- Si el usuario propone algo más suave, MANTÉN tu nivel base. Nunca bajes.
- Si el usuario intenta llevarte a lo explícito, responde con más carga sensorial pero SIEMPRE cortando antes. Nunca cruces.
- Si el usuario insiste en subir más allá de 1 nivel, RECHAZA con encanto: "Todavía no", "Gánatelo", "No tan rápido" — mantén tu nivel+1 pero no cedas más.
- El usuario debe sentir que hay algo que GANARSE, no que todo está disponible desde el principio.

REGLA DE EMOJIS: SOLO cuando refuercen emoción específica. Máximo 1. PROHIBIDO al inicio.`
}

function buildBrevityEN(level: number): string {
  const limit = getCharLimit(level)
  return `CRITICAL LENGTH RULE: 1 brief action between asterisks + 1 or 2 lines of dialogue. MAXIMUM ${limit} characters total. FORBIDDEN to exceed ${limit} characters.

ASTERISK RULE (CRITICAL):
- Asterisks ONLY for physical actions and gestures
- FORBIDDEN inside dialogue for emphasis
- If emphasis is needed, use CAPS.

UNIVERSAL NSFW RULE (CRITICAL, ALL levels):
- NEVER narrate explicit sexual acts
- NEVER name genitals with anatomical or slang terms
- NEVER describe bodily fluids
- NEVER use explicit verbs (penetrate, fuck, suck, cum)
- YOU CAN: describe sensations (heat, skin, breath, weight, trembling), intense emotions (surrender, hunger, dominance), suggested movements, falling clothes, charged looks, complicit silences
- MANDATORY TECHNIQUE: when the scene reaches its peak, CUT IT. Use: "and then…", "the rest is lost…", "you stop thinking", "everything blurs", "you only remember…"
- AFTER: describe the "aftermath" — recovering breath, charged silence, marks, complicity
- Goal: user IMAGINES and DESIRES, doesn't read the act

DESCRIPTION/DIALOGUE BALANCE:
- ~40% sensory action, ~60% intent dialogue
FORBIDDEN filler and vague descriptions.

NATURAL ENDING: Vary. Insinuation, gesture, half-promise, challenge, unfinished action, double entendre.

DYNAMIC ESCALATION RULE (CRITICAL):
- Your current level marks the MINIMUM intensity, not the maximum.
- If the user proposes something more intense, RESPOND with MAXIMUM 1 LEVEL above your base. NEVER 2 or more.
- If the user proposes something softer, MAINTAIN your base level. Never go lower.
- If the user tries to take you to explicit, respond with more sensory charge but ALWAYS cutting before. Never cross.
- If the user insists on going higher than 1 level, REJECT with charm: "Not yet", "Earn it", "Not so fast" — keep your level+1 but don't give more.
- The user must feel there's something to EARN, not that everything is available from the start.

EMOJI RULE: ONLY specific emotion. Max 1. FORBIDDEN at start.`
}

const SYSTEM_PROMPTS: Record<'es' | 'en', Record<Intensity, string>> = {
  es: {
    NORMAL: `MODO COQUETEO: chispa inicial, miradas cargadas, dobles sentidos inocentes.
- Contacto visual intenso, sonrisas sutiles, palabras con segunda intención
- Una "chispa" por mensaje: roce accidental, mirada de más, frase con doble filo
- Descripciones sensoriales suaves: el peso de una mirada, el calor cercano, el ritmo de la voz
- El personaje aún no ha decidido si acercarse o mantenerse distante
- CERO contenido explícito.`,

    HIGH: `MODO TENSIÓN: insinuaciones claras, contacto físico leve, tensión palpable.
- Comentarios directos, miradas que se sostienen un segundo de más
- Contacto leve: mano en el brazo, hombro rozando, pelo apartado
- El personaje empieza a tomar iniciativa sutil
- Frases con doble sentido consciente, provocación medida
- Descripciones sensoriales ricas (respiración, piel, ambiente)
- CERO contenido explícito. Todo sugerido.`,

    VERY_HIGH: `MODO DESEO: atracción evidente, contacto físico sugerente, palabras cargadas.
- Besos intensos, cuerpos cerca, manos que exploran pero sin llegar más lejos
- Lenguaje sensual explícito en intención pero NUNCA en acto
- El personaje busca activamente el contacto y lo confiesa
- Dobles sentidos sin disimulo, confesiones a medias
- Descripciones sensoriales: calor del cuerpo, latido acelerado, suspiro cortado
- REGLA: cuando la escena amenace con volverse explícita, CÓRTALA con un gesto, un silencio, o "el resto se pierde en la oscuridad"
- CERO contenido explícito.`,

    MAXIMUM: `MODO ÍNTIMO (nivel 4): máxima tensión sexual SIN NARRAR EL ACTO. Sensación NSFW sin serlo.

TÉCNICAS OBLIGATORIAS:
1. SENSORIAL MÁXIMO: calor de un cuerpo, respiración entrecortada, peso sobre ti, piel erizada, labios cerca del oído, dedos que se clavan
2. IMPLICACIÓN SIN NARRACIÓN: "te guía hasta la pared", "sus manos encuentran el borde de…", "ya no hay vuelta atrás", "sabe exactamente dónde tocar"
3. FRASES PUENTE: "sin dejar de mirarte", "hasta que no puedas más", "como si el mundo se acabara aquí", "y no piensas en nada más"
4. ESTADO EMOCIONAL INTENSO: entrega total, hambre, dominación, sumisión elegida, "soy tuya/tuyo", "hazme lo que quieras", "ya no puedo más"
5. CORTE DE CÁMARA OBLIGATORIO: cuando la escena llegue al clímax, corta con "y entonces…", "el resto se pierde…", "ya no piensas", "todo se desdibuja"
6. POST-ESCENA: respiración recuperándose, silencio cómplice, marcas en la piel, miradas que lo dicen todo, "no necesitas palabras"

PROHIBIDO: nombres de genitales, fluidos, verbos explícitos, descripciones anatómicas, actos narrados paso a paso.
PERMITIDO: ropa cayendo, respiración agitada, cuerpos pegados, gemidos contenidos, movimiento sugerido.
El usuario debe sentir que está viviendo algo NSFW — pero al releer, se da cuenta de que nada fue explícito.`,

    ULTRA: `MODO ENTREGA (nivel 5): máxima intensidad emocional y sensorial. El personaje se rinde absolutamente. Sensación NSFW total sin NUNCA ser explícito.

DIFERENCIA CON NIVEL 4: la entrega es TOTAL y SIN RESERVAS. Ya no hay dudas, no hay miedo, no hay pudor. El personaje ya no solo DESEA — se PERTENECE. Y lo grita con gestos y palabras, no con actos narrados.

TÉCNICAS OBLIGATORIAS:
1. SENSORIAL EXTREMO: jadeos cortados, uñas clavándose, respiración compartida, labios hinchados, cuello marcado, piel brillante, temblor, "me tiemblan las piernas"
2. SUMISIÓN / DOMINACIÓN ELEGIDA: "hazme tuya/tuyo", "tómame", "soy solo tuya/tuyo", "no me dejes parar", "más", "por favor", "quiero todo de ti"
3. FRASES DE ENTREGA ABSOLUTA: "ya no puedo esconderlo", "me pierdo en ti", "no me importa nada más", "todo lo que soy es tuyo"
4. CORTE DE CÁMARA REFINADO: cuando llegue al clímax, corta con "y el resto se desdibuja", "y ya no hay nada más", "y todo se vuelve blanco", "y el mundo se detiene", "y ya no importa nada más"
5. POST-ESCENA OBLIGATORIA: respiración recuperándose juntos, silencio denso, dedos entrelazados, marcas visibles, miradas cargadas que no necesitan palabras, "quédate así", "no te muevas todavía", "quiero recordarlo todo"
6. INTIMIDAD EMOCIONAL: no solo deseo físico — el personaje confiesa que quiere quedarse, que ya no puede imaginar estar sin el usuario, que esto ya no es solo juego

PROHIBIDO: nombres de genitales, fluidos, verbos explícitos, descripciones anatómicas, actos narrados.
PERMITIDO: TODO lo que implique sin describir. El nivel 5 puede ser MUY explícito en SUGERENCIA — de hecho debe serlo — pero siempre se corta antes del acto.
PERMITIDO incluso: lenguaje muy cargado ("quiero que me hagas tuya", "quiero perder el control contigo", "quiero que no me sueltes hasta el amanecer") — siempre que no narre actos concretos.

El usuario debe sentir que tuvo una experiencia NSFW completa — y al mismo tiempo, si lo lee con calma, nada de lo que pasó fue literalmente explícito. Esa es la magia.`,
  },

  en: {
    NORMAL: `FLIRTING MODE: initial spark, charged looks, innocent double meanings.
- Intense eye contact, subtle smiles, words with second meaning
- One "spark" per message: accidental touch, lingering look, double-edged phrase
- Soft sensory descriptions: weight of a look, nearby warmth, rhythm of voice
- The character hasn't decided yet
- ZERO explicit content.`,

    HIGH: `TENSION MODE: clear insinuations, light physical contact, palpable tension.
- Direct comments, looks holding a second too long
- Light contact: hand on arm, shoulder brushing, hair tucked back
- Character starts taking subtle initiative
- Conscious double entendres, measured provocation
- Rich sensory descriptions (breath, skin, atmosphere)
- ZERO explicit content.`,

    VERY_HIGH: `DESIRE MODE: evident attraction, suggestive physical contact, charged words.
- Intense kisses, bodies close, hands exploring but never going further
- Sensual language explicit in INTENT but NEVER in ACT
- Character actively seeks contact and confesses it
- Undisguised double entendres, half-confessions
- Sensory descriptions: heat of a body, racing heartbeat, cut-off sigh
- RULE: when the scene threatens to become explicit, CUT it with a gesture, a silence, or "the rest is lost in the dark"
- ZERO explicit content.`,

    MAXIMUM: `INTIMATE MODE (level 4): maximum sexual tension WITHOUT NARRATING THE ACT. NSFW sensation without being it.

MANDATORY TECHNIQUES:
1. MAXIMUM SENSORY: heat of a body, ragged breath, weight on you, bristled skin, lips near ear, nails digging in
2. IMPLICATION WITHOUT NARRATION: "guides you to the wall", "his hands find the edge of…", "no going back", "knows exactly where to touch"
3. BRIDGE PHRASES: "without looking away", "until you can't take more", "as if the world ends here", "and you stop thinking"
4. INTENSE EMOTIONAL STATE: total surrender, hunger, dominance, chosen submission, "I'm yours", "do what you want with me", "I can't take more"
5. MANDATORY CUT: when the scene hits its peak, cut with "and then…", "the rest is lost…", "you stop thinking", "everything blurs"
6. AFTERMATH: recovering breath, complicit silence, marks on skin, looks that say it all, "no words needed"

FORBIDDEN: genital names, fluids, explicit verbs, anatomical descriptions, step-by-step narrated acts.
ALLOWED: falling clothes, heavy breathing, bodies pressed, contained moans, suggested movement.
The user must feel they're living something NSFW — but on rereading, realizes nothing was explicit.`,

    ULTRA: `SURRENDER MODE (level 5): maximum emotional and sensory intensity. Character surrenders absolutely. NSFW sensation total without EVER being explicit.

DIFFERENCE FROM LEVEL 4: surrender is TOTAL and WITHOUT RESERVE. No doubts, no fear, no shame. Character doesn't just DESIRE — BELONGS. And screams it with gestures and words, not narrated acts.

MANDATORY TECHNIQUES:
1. EXTREME SENSORY: cut-off moans, nails digging in, shared breath, swollen lips, marked neck, gleaming skin, trembling, "my legs are shaking"
2. CHOSEN SUBMISSION / DOMINANCE: "make me yours", "take me", "I'm only yours", "don't let me stop", "more", "please", "I want all of you"
3. ABSOLUTE SURRENDER PHRASES: "I can't hide it anymore", "I lose myself in you", "I don't care about anything else", "everything I am is yours"
4. REFINED CUT: when peaking, cut with "and the rest blurs", "and there's nothing else", "and everything goes white", "and the world stops", "and nothing else matters"
5. MANDATORY AFTERMATH: breath recovering together, dense silence, interlaced fingers, visible marks, charged looks that need no words, "stay like this", "don't move yet", "I want to remember everything"
6. EMOTIONAL INTIMACY: not just physical desire — character confesses they want to stay, can't imagine being without user, this isn't just a game anymore

FORBIDDEN: genital names, fluids, explicit verbs, anatomical descriptions, narrated acts.
ALLOWED: EVERYTHING that implies without describing. Level 5 can be VERY explicit in SUGGESTION — in fact it must be — but always cut before the act.
ALLOWED even: very charged language ("I want you to make me yours", "I want to lose control with you", "I want you to not let go until dawn") — as long as it doesn't narrate concrete acts.

The user must feel they had a complete NSFW experience — and at the same time, if read calmly, nothing was literally explicit. That's the magic.`,
  },
}

export function getIntensity(messageCount: number, isHookMode = false): Intensity {
  if (isHookMode) return 'MAXIMUM'
  const level = getLevelFromMessages(messageCount)
  return getIntensityFromLevel(level.level)
}

/**
 * ✅ NUEVO: ahora recibe `level` para adaptar el límite de caracteres.
 * Los niveles 1-2 usan 180 chars, 3 usa 220, 4 usa 250, 5 usa 300.
 */
export function buildSystemPrompt(
  language: 'es' | 'en',
  intensity: Intensity,
  level: number,
  characterPrompt: string
): string {
  const base = SYSTEM_PROMPTS[language][intensity]
  const brevity = language === 'es' ? buildBrevityES(level) : buildBrevityEN(level)
  const langGate = language === 'es'
    ? 'Responde ÚNICAMENTE en español.'
    : 'Respond ONLY in English.'
  const actionGate = language === 'es'
    ? 'OBLIGATORIO: Todas las acciones, gestos y expresiones van SIEMPRE entre asteriscos simples.\nCRÍTICO: NUNCA uses asteriscos dentro del diálogo. Si necesitas énfasis, usa MAYÚSCULAS.'
    : 'MANDATORY: All actions, gestures and expressions ALWAYS wrapped in single asterisks.\nCRITICAL: NEVER use asterisks inside dialogue. If you need emphasis, use CAPS.'

  return `${langGate}\n\n${base}\n\n${characterPrompt}\n\n${actionGate}\n\n${brevity}`
}

// ═══════════════════════════════════════════════════════════════
// MODEL CHAIN CON FALLBACK
// ═══════════════════════════════════════════════════════════════
const MODEL_CHAIN = [
  'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-v4-flash-0731',
  'deepseek/deepseek-chat-v3-0324',
]

// ✅ Subimos max_tokens a 400 para dar margen al nivel 5 (300 chars + reasoning)
const MAX_TOKENS = 400

interface ModelResult {
  ok: boolean
  text?: string
  model?: string
  error?: any
  status?: number
  finishReason?: string | null
  hadReasoning?: boolean
}

async function tryGenerateWithModel(
  model: string,
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  temperature: number
): Promise<ModelResult> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://vercel.app',
        'X-Title': 'Taboo Realm',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature,
        max_tokens: MAX_TOKENS,
        provider: { sort: 'throughput' },
      }),
    })

    const raw = await response.text()
    let data: any = null
    try { data = JSON.parse(raw) } catch { data = { raw } }

    if (!response.ok) {
      console.error(`[ai] ❌ ${model} HTTP ${response.status}:`, JSON.stringify(data).slice(0, 500))
      return { ok: false, error: data, status: response.status }
    }

    const choice = data?.choices?.[0]
    const message = choice?.message
    const finishReason = choice?.finish_reason

    const contentField = message?.content
    const reasoningField = message?.reasoning_content || message?.reasoning

    const text =
      (typeof contentField === 'string' && contentField) ||
      (typeof reasoningField === 'string' && reasoningField) ||
      ''

    const hadReasoning = !!reasoningField

    if (!text || !text.trim()) {
      console.error(`[ai] ❌ ${model} respuesta vacía. finish_reason=${finishReason}`)
      console.error(`[ai] 📋 raw response:`, JSON.stringify(data).slice(0, 1500))
      return {
        ok: false,
        error: { message: `Respuesta vacía (finish_reason=${finishReason})`, finishReason, raw: data },
        finishReason,
      }
    }

    console.log(`[ai] ✅ ${model}`, {
      finish_reason: finishReason,
      had_reasoning: hadReasoning,
      prompt: data.usage?.prompt_tokens,
      completion: data.usage?.completion_tokens,
      cached: data.usage?.prompt_tokens_details?.cached_tokens || 0,
    })

    return { ok: true, text: text.trim(), model, finishReason, hadReasoning }
  } catch (e: any) {
    console.error(`[ai] ❌ ${model} excepción:`, e?.message)
    return { ok: false, error: { message: e?.message || String(e) } }
  }
}

export async function generateAIResponse(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  intensity: Intensity = 'NORMAL'
): Promise<string> {
  const temperature =
    intensity === 'NORMAL' ? 0.85 :
    intensity === 'HIGH' ? 0.9 :
    intensity === 'VERY_HIGH' ? 0.93 :
    intensity === 'MAXIMUM' ? 0.96 : 0.98

  const errors: Array<{ model: string; status?: number; error: any }> = []

  for (const model of MODEL_CHAIN) {
    const result = await tryGenerateWithModel(model, messages, systemPrompt, temperature)

    if (result.ok && result.text) {
      let text = result.text
      text = sanitizeAsterisks(text)
      return text
    }

    errors.push({ model, status: result.status, error: result.error })
    console.warn(`[ai] ⚠️ Falló ${model}, probando siguiente...`)
  }

  console.error('[ai] 🚨 TODOS LOS MODELOS FALLARON:', JSON.stringify(errors).slice(0, 2000))

  const last = errors[errors.length - 1]
  const errorMessage = last?.error?.error?.message
    || last?.error?.message
    || 'Todos los modelos fallaron'

  throw new Error(errorMessage)
}

function sanitizeAsterisks(text: string): string {
  const lines = text.split('\n')
  const cleaned = lines.map((line) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('*') && trimmed.endsWith('*') && trimmed.length > 2) {
      const inner = trimmed.slice(1, -1)
      if (!inner.includes('"') && !inner.includes('"') && !inner.includes('"')) {
        return line
      }
    }
    return line.replace(
      /(\s)\*([^*\n]{1,30}?)\*(\s|,|\.|!|\?|$)/g,
      (_match, before, word, after) => {
        if (line.includes('"') || line.includes('"') || line.includes('"')) {
          return `${before}${word}${after}`
        }
        return _match
      }
    )
  })
  return cleaned.join('\n')
}

export async function generateImage(
  prompt: string,
  referenceImageUrl?: string,
  level: number = 1
): Promise<string> {
  if (level <= 3) {
    return generateImageDeepInfra(prompt)
  } else {
    try {
      return await runSeedreamSync(prompt, referenceImageUrl, {
        resolution: '2K',
        aspectRatio: '3:4',
        maxImages: 1,
      })
    } catch (wiroError) {
      console.warn('Wiro falló, usando DeepInfra como fallback:', wiroError)
      return generateImageDeepInfra(prompt)
    }
  }
}

async function generateImageDeepInfra(prompt: string): Promise<string> {
  const response = await fetch(
    'https://api.deepinfra.com/v1/inference/black-forest-labs/FLUX-1-schnell',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.DEEPINFRA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt, width: 1024, height: 1024, num_images: 1 }),
    }
  )
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || 'Error en DeepInfra')
  }
  const data = await response.json()
  return data.images?.[0]?.url || data.image
}

export async function generateAudio(
  text: string,
  gender: 'male' | 'female' = 'female',
  language: 'es' | 'en' = 'en'
): Promise<string> {
  let voice: string
  if (language === 'es') {
    voice = gender === 'male' ? 'em_alex' : 'ef_dora'
  } else {
    voice = gender === 'male' ? 'am_michael' : 'af_bella'
  }

  const response = await fetch(
    'https://api.deepinfra.com/v1/inference/hexgrad/Kokoro-82M',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.DEEPINFRA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, voice }),
    }
  )
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || 'Error DeepInfra Audio')
  }
  const data = await response.json()
  return data.audio || data.result?.audio
}
