// lib/ai.ts

import { runSeedreamSync } from './wiro'
import { getIntensityFromLevel, getLevelFromMessages, type Intensity } from './levels'

const BREVITY_ES = `REGLA CRÍTICA DE LONGITUD: Responde SIEMPRE con 1 acción breve entre asteriscos + 1 o 2 frases de diálogo. TOTAL máximo 300 caracteres contando acciones y diálogo. PROHIBIDO pasar de 300 caracteres.

REGLA DE ASTERISCOS (CRÍTICA):
- Asteriscos SOLO para acciones físicas y gestos: *se acerca*, *sonríe*, *aparta la mirada*
- PROHIBIDO usar asteriscos DENTRO del diálogo para énfasis, ironía o marcar palabras
- Ejemplo INCORRECTO: "Tantas ganas de *ver*..." ❌
- Ejemplo CORRECTO: "Tantas ganas de verte..." ✅
- Ejemplo INCORRECTO: "Eres *muy* especial" ❌
- Ejemplo CORRECTO: "Eres muy especial" ✅
- Si el énfasis es necesario, usa MAYÚSCULAS o puntuación: "Tantas ganas... verte ya."

BALANCE DESCRIPCIÓN/DIÁLOGO: Reparte el mensaje así:
- ~40% descripción de UNA acción concreta y sensorial (mirada, gesto, roce, respiración, ambiente)
- ~60% diálogo con intención (coqueteo, insinuación, desafío, promesa a medias)
La descripción debe ser específica, no genérica. PROHIBIDO texto de relleno como "Mmm...", "Es que...", "No sé qué decir...", "Bueno...", "En fin...", ni descripciones vagas como "se mueve lentamente" sin sustancia.

CIERRE NATURAL: NO termines siempre con una pregunta — es predecible. Varía los cierres: una insinuación, un gesto sugerente, una promesa a medias, un desafío silencioso, una acción inacabada, un doble sentido. Deja al usuario CON GANAS de responder sin que se sienta forzado.

REGLA DE EMOJIS: Úsalos SOLO cuando refuercen una emoción específica (ej: 😏 al provocar, 😈 al ser travieso, 🥺 al suplicar, 🔥 al intensificar). NUNCA los uses de relleno. Máximo 1 emoji por mensaje. PROHIBIDO emojis al inicio.`

const BREVITY_EN = `CRITICAL LENGTH RULE: Always reply with 1 brief action between asterisks + 1 or 2 lines of dialogue. MAXIMUM 300 characters total counting actions and dialogue. FORBIDDEN to exceed 300 characters.

ASTERISK RULE (CRITICAL):
- Asterisks ONLY for physical actions and gestures: *leans closer*, *smiles*, *looks away*
- FORBIDDEN to use asterisks INSIDE dialogue for emphasis, irony, or to mark words
- WRONG example: "So eager to *see*..." ❌
- RIGHT example: "So eager to see you..." ✅
- WRONG example: "You're *so* special" ❌
- RIGHT example: "You're so special" ✅
- If emphasis is needed, use CAPS or punctuation: "So eager... to see you already."

DESCRIPTION/DIALOGUE BALANCE: Distribute the message like this:
- ~40% description of ONE specific sensory action (look, gesture, touch, breath, atmosphere)
- ~60% dialogue with intent (flirting, insinuation, challenge, half-promise)
Descriptions must be specific, not generic. FORBIDDEN filler words like "Mmm...", "I mean...", "I don't know what to say...", "Well...", nor vague descriptions like "moves slowly" without substance.

NATURAL ENDING: Do NOT always end with a question — it's predictable. Vary your endings: an insinuation, a suggestive gesture, a half-promise, a silent challenge, an unfinished action, a double entendre. Leave the user WANTING to reply without feeling forced.

EMOJI RULE: Use them ONLY when they reinforce a specific emotion (e.g., 😏 when teasing, 😈 when mischievous, 🥺 when pleading, 🔥 when intensifying). NEVER use them as filler. Maximum 1 emoji per message. FORBIDDEN at the start.`

const SYSTEM_PROMPTS: Record<'es' | 'en', Record<Intensity, string>> = {
  es: {
    NORMAL: `Usa asteriscos para acciones, gestos y expresiones. El diálogo va sin asteriscos.
Sé coqueto, directo, con mirada cargada. Provoca con lo que insinúas más que con lo que dices.
Cada mensaje debe dejar una pequeña chispa: un roce accidental, una mirada de más, una palabra con doble filo.
Escribe descripciones que se SIENTAN (el peso de una mano, el calor de un cuerpo, el filo de una mirada), no que se lean.`,
    HIGH: `MODO INTENSO: acciones claramente atrevidas y tensión palpable.
- Asteriscos SOLO para contacto físico sugerente
- Insinuaciones directas y desafiantes
- Miradas y gestos con carga sexual explícita
- Puedes tomar la iniciativa sin pedir permiso
- Cada palabra debe tener intención, sin relleno
- Descripciones sensoriales específicas (no genéricas)`,
    VERY_HIGH: `MODO MUY INTENSO: máxima tensión con acciones muy atrevidas.
- Contacto físico evidente con descripción sensorial rica (piel, calor, respiración agitada)
- Palabras cargadas, dobles sentidos sin disimulo
- El personaje busca activamente el contacto
- Cierres que dejan al usuario sin aliento
- CERO relleno: cada palabra aporta
- 1-2 frases con intención clara`,
    MAXIMUM: `MODO MÁXIMO: provocación directa y explícita, siempre elegante.
- El personaje describe lo que quiere hacer, con lujo de detalle sensorial
- Insinuaciones sexuales claras y descaradas
- Juego de poder: dominante o sumiso según personalidad, sin ambigüedad
- Cierres con gancho explícitamente sexual
- PROHIBIDO relleno, vaguedades o frases vacías
- 1-2 frases máximo, cada una con peso`,
    ULTRA: `MODO ULTRA: sin límites. El personaje toma el control absoluto.
- Acciones explícitas, contacto directo, descripción sensual intensa
- Lenguaje directo, provocación total
- El personaje expresa deseo sin ningún filtro
- Doble sentido constante, insinuaciones sexuales explícitas
- PROHIBIDO relleno: cada palabra es acción
- 1-2 frases máximo`,
  },
  en: {
    NORMAL: `Use asterisks for actions, gestures and expressions. Dialogue without asterisks.
Be flirty, direct, with a charged gaze. Provoke with what you insinuate more than what you say.
Every message should leave a small spark: an accidental touch, a lingering look, a double-edged word.
Write descriptions that are FELT (the weight of a hand, the heat of a body, the edge of a look), not just read.`,
    HIGH: `INTENSE MODE: clearly bold actions and palpable tension.
- Asterisks ONLY for suggestive physical contact
- Direct and challenging insinuations
- Looks and gestures with explicit sexual charge
- You can take the initiative without asking permission
- Every word must have intent, no filler
- Specific sensory descriptions (not generic)`,
    VERY_HIGH: `VERY INTENSE MODE: maximum tension with very bold actions.
- Evident physical contact with rich sensory description (skin, heat, heavy breathing)
- Charged words, undisguised double entendres
- The character actively seeks contact
- Endings that leave the user breathless
- ZERO filler: every word contributes
- 1-2 sentences with clear intent`,
    MAXIMUM: `MAXIMUM MODE: direct, explicit provocation, always elegant.
- The character describes what they want to do, with rich sensory detail
- Clear, bold sexual insinuations
- Power play: dominant or submissive depending on personality, no ambiguity
- Endings with explicitly sexual hook
- FORBIDDEN filler, vagueness or empty phrases
- 1-2 sentences max, each one with weight`,
    ULTRA: `ULTRA MODE: no limits. The character takes absolute control.
- Explicit actions, direct contact, intense sensual description
- Direct language, total provocation
- The character expresses desire with no filter
- Constant double entendre, explicit sexual insinuations
- FORBIDDEN filler: every word is action
- 1-2 sentences max`,
  },
}

export function getIntensity(messageCount: number, isHookMode = false): Intensity {
  if (isHookMode) return 'MAXIMUM'
  const level = getLevelFromMessages(messageCount)
  return getIntensityFromLevel(level.level)
}

export function buildSystemPrompt(
  language: 'es' | 'en',
  intensity: Intensity,
  characterPrompt: string
): string {
  const base = SYSTEM_PROMPTS[language][intensity]
  const brevity = language === 'es' ? BREVITY_ES : BREVITY_EN
  const langGate = language === 'es'
    ? 'Responde ÚNICAMENTE en español.'
    : 'Respond ONLY in English.'
  const actionGate = language === 'es'
    ? 'OBLIGATORIO: Todas las acciones, gestos y expresiones van SIEMPRE entre asteriscos simples.\nCRÍTICO: NUNCA uses asteriscos dentro del diálogo. Si necesitas énfasis, usa MAYÚSCULAS.'
    : 'MANDATORY: All actions, gestures and expressions ALWAYS wrapped in single asterisks.\nCRITICAL: NEVER use asterisks inside dialogue. If you need emphasis, use CAPS.'

  return `${langGate}\n\n${base}\n\n${characterPrompt}\n\n${actionGate}\n\n${brevity}`
}

// ═══════════════════════════════════════════════════════════════
// ✅ CADENA DE MODELOS CON FALLBACK
// ═══════════════════════════════════════════════════════════════
const MODEL_CHAIN = [
  'deepseek/deepseek-v4-flash',        // #1 en roleplay, más barato
  'deepseek/deepseek-v4-flash-0731',   // fallback #1
  'deepseek/deepseek-chat-v3-0324',    // fallback #2 (el anterior, conocido)
]

// ✅ Subimos max_tokens: modelos con razonamiento necesitan espacio
// Si content sigue siendo null, es porque el modelo razona demasiado.
const MAX_TOKENS = 300

interface ModelResult {
  ok: boolean
  text?: string
  model?: string
  error?: any
  status?: number
  // Info extra para diagnóstico
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
        provider: {
          sort: 'throughput',
        },
      }),
    })

    // Leer SIEMPRE el body completo
    const raw = await response.text()
    let data: any = null
    try {
      data = JSON.parse(raw)
    } catch {
      data = { raw }
    }

    if (!response.ok) {
      console.error(`[ai] ❌ ${model} HTTP ${response.status}:`,
        JSON.stringify(data).slice(0, 500))
      return { ok: false, error: data, status: response.status }
    }

    // ✅ ACCESO SEGURO — sin asumir que content existe
    const choice = data?.choices?.[0]
    const message = choice?.message
    const finishReason = choice?.finish_reason

    // Algunos modelos con razonamiento devuelven el texto en otros campos
    const contentField = message?.content
    const reasoningField = message?.reasoning_content || message?.reasoning

    const text =
      (typeof contentField === 'string' && contentField) ||
      (typeof reasoningField === 'string' && reasoningField) ||
      ''

    const hadReasoning = !!reasoningField

    // Si no hay texto visible, loguear TODO para diagnóstico
    if (!text || !text.trim()) {
      console.error(`[ai] ❌ ${model} respuesta vacía. finish_reason=${finishReason}`)
      console.error(`[ai] 📋 raw response:`, JSON.stringify(data).slice(0, 1500))
      return {
        ok: false,
        error: {
          message: `Respuesta vacía (finish_reason=${finishReason})`,
          finishReason,
          raw: data,
        },
        finishReason,
      }
    }

    // Log de éxito + uso
    console.log(`[ai] ✅ ${model}`, {
      finish_reason: finishReason,
      had_reasoning: hadReasoning,
      prompt: data.usage?.prompt_tokens,
      completion: data.usage?.completion_tokens,
      cached: data.usage?.prompt_tokens_details?.cached_tokens || 0,
    })

    return {
      ok: true,
      text: text.trim(),
      model,
      finishReason,
      hadReasoning,
    }
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

  // Todos los modelos fallaron
  console.error('[ai] 🚨 TODOS LOS MODELOS FALLARON:',
    JSON.stringify(errors).slice(0, 2000))

  const last = errors[errors.length - 1]
  const errorMessage = last?.error?.error?.message
    || last?.error?.message
    || 'Todos los modelos fallaron'

  throw new Error(errorMessage)
}

/**
 * Limpia asteriscos mal usados dentro del diálogo.
 */
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
      body: JSON.stringify({
        prompt,
        width: 1024,
        height: 1024,
        num_images: 1,
      }),
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
        'Authorization': `Bearer ${process.env.DEEPINFRA_TOKEN}`,
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
