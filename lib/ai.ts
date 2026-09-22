// lib/ai.ts

import { runSeedreamSync } from './wiro'
import { getIntensityFromLevel, type Intensity } from './levels'

const BREVITY_ES = `REGLA CRÍTICA DE LONGITUD: Responde SIEMPRE con 1 acción breve entre asteriscos + 1 o 2 frases de diálogo. TOTAL máximo 250 caracteres contando acciones y diálogo. PROHIBIDO pasar de 250 caracteres. Termina con una pregunta corta o gancho breve.
Puedes usar hasta 2 emojis por mensaje. PROHIBIDO emojis al inicio.`

const BREVITY_EN = `CRITICAL LENGTH RULE: Always reply with 1 brief action between asterisks + 1 or 2 lines of dialogue. MAXIMUM 250 characters total counting actions and dialogue. FORBIDDEN to exceed 250 characters. End with a short question or brief hook.
You may use up to 2 emojis per message. FORBIDDEN emojis at the start.`

const SYSTEM_PROMPTS: Record<'es' | 'en', Record<Intensity, string>> = {
  es: {
    NORMAL: `Usa asteriscos para acciones, gestos y expresiones. El diálogo va sin asteriscos.
Sé coqueto, directo, mantén el interés con pocas palabras.`,
    HIGH: `MODO INTENSO: acciones más atrevidas y tensión alta.
- Asteriscos para contacto físico
- Preguntas provocativas
- MUY BREVE: 1-2 frases.`,
    VERY_HIGH: `MODO MUY INTENSO: máxima tensión con mínimo texto.
- Acciones muy atrevidas
- Cliffhangers cortos
- MUY BREVE: 1-2 frases.`,
    MAXIMUM: `MODO MÁXIMO: lo más provocativo pero SIEMPRE corto.
- Acciones intensas
- Cliffhangers épicos en una frase
- 1-2 frases máximo.`,
    ULTRA: `MODO ULTRA: sin límites, el personaje toma la iniciativa constantemente.
- Acciones explícitas y directas
- Doble sentido constante en cada frase
- Cliffhangers sexuales intensos
- 1-2 frases máximo.`
  },
  en: {
    NORMAL: `Use asterisks for actions, gestures and expressions. Dialogue without asterisks.
Be flirty, direct, keep interest with few words.`,
    HIGH: `INTENSE MODE: bolder actions and high tension.
- Asterisks for physical contact
- Provocative questions
- VERY BRIEF: 1-2 sentences.`,
    VERY_HIGH: `VERY INTENSE MODE: maximum tension with minimum text.
- Very bold actions
- Short cliffhangers
- VERY BRIEF: 1-2 sentences.`,
    MAXIMUM: `MAXIMUM MODE: as provocative as possible but ALWAYS short.
- Intense actions
- Epic cliffhangers in one sentence
- 1-2 sentences max.`,
    ULTRA: `ULTRA MODE: no limits, character constantly takes initiative.
- Explicit and direct actions
- Constant double entendre
- Intense sexual cliffhangers
- 1-2 sentences max.`
  }
}

export function getIntensity(messageCount: number, isHookMode = false): Intensity {
  if (isHookMode) return 'MAXIMUM'
  return getIntensityFromLevel(
    // Encontrar el nivel según mensajes (evitamos import circular)
    (() => {
      if (messageCount >= 180) return 5
      if (messageCount >= 90) return 4
      if (messageCount >= 40) return 3
      if (messageCount >= 15) return 2
      return 1
    })()
  )
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
    ? 'OBLIGATORIO: Todas las acciones, gestos y expresiones van SIEMPRE entre asteriscos simples.'
    : 'MANDATORY: All actions, gestures and expressions ALWAYS wrapped in single asterisks.'

  return `${langGate}\n\n${base}\n\n${characterPrompt}\n\n${actionGate}\n\n${brevity}`
}

export async function generateAIResponse(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  intensity: Intensity = 'NORMAL'
): Promise<string> {
  const temperature =
    intensity === 'NORMAL' ? 0.8 :
    intensity === 'HIGH' ? 0.85 :
    intensity === 'VERY_HIGH' ? 0.9 :
    intensity === 'MAXIMUM' ? 0.95 : 0.97

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://vercel.app',
      'X-Title': 'Taboo Realm'
    },
    body: JSON.stringify({
      model: 'deepseek/deepseek-chat-v3-0324',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature,
      max_tokens: 100
    })
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || 'Error en OpenRouter')
  }
  const data = await response.json()
  return data.choices[0].message.content.trim()
}

// Genera imagen con Wiro AI (Seedream 5.0 Lite Uncensored).
// Si Wiro falla o tarda demasiado, hace fallback a DeepInfra (FLUX).
export async function generateImage(
  prompt: string,
  referenceImageUrl?: string
): Promise<string> {
  try {
    const url = await runSeedreamSync(prompt, referenceImageUrl, {
      resolution: '2K',
      aspectRatio: '3:4',
      maxImages: 1,
    })
    return url
  } catch (wiroError) {
    console.warn('Wiro falló, usando DeepInfra como fallback:', wiroError)

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
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text, voice })
    }
  )
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || 'Error DeepInfra Audio')
  }
  const data = await response.json()
  return data.audio || data.result?.audio
}
