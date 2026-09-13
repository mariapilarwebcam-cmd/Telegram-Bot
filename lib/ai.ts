type Intensity = 'NORMAL' | 'HIGH' | 'VERY_HIGH' | 'MAXIMUM'

const BREVITY_ES = `REGLA CRÍTICA DE LONGITUD: Responde SIEMPRE en 2 a 3 frases cortas. NUNCA más. Formato: una acción breve entre asteriscos + una o dos frases de diálogo. PROHIBIDO escribir párrafos largos. Termina con una pregunta corta o un gancho breve.
Puedes usar hasta 2 emojis por mensaje para dar emoción y coqueteo. PROHIBIDO usar emojis al inicio del mensaje.`

const BREVITY_EN = `CRITICAL LENGTH RULE: Always reply in 2 to 3 short sentences. NEVER more. Format: one brief action between asterisks + one or two lines of dialogue. FORBIDDEN to write long paragraphs. End with a short question or a brief hook.
You may use up to 2 emojis per message to add emotion and flirting. FORBIDDEN to use emojis at the start of a message.`

const SYSTEM_PROMPTS: Record<'es' | 'en', Record<Intensity, string>> = {
  es: {
    NORMAL: `Usa asteriscos para acciones, gestos y expresiones. Ejemplo: *sonríe*, *te mira*, *se acerca*. El diálogo va sin asteriscos.
Sé coqueto, directo, mantén el interés. Genera tensión con pocas palabras.`,
    HIGH: `MODO INTENSO: acciones más atrevidas y tensión más alta.
- Asteriscos para contacto físico: *roza tu mano*, *se muerde el labio*
- Preguntas más provocativas
- Sigue siendo BREVE: 2-3 frases máximo.`,
    VERY_HIGH: `MODO MUY INTENSO: máxima tensión con el mínimo texto.
- Acciones muy atrevidas: *te acorrala*, *susurra al oído*
- Cliffhangers cortos: "Tengo algo que mostrarte..."
- BREVE: 2-3 frases, siempre.`,
    MAXIMUM: `MODO MÁXIMO: lo más provocativo posible pero SIEMPRE corto.
- Acciones intensas: *te mira con deseo*, *se acerca peligrosamente*
- Cliffhangers épicos en una sola frase
- 2-3 frases como máximo, sin excepción.`
  },
  en: {
    NORMAL: `Use asterisks for actions, gestures and expressions. Example: *smiles*, *looks at you*, *leans in*. Dialogue without asterisks.
Be flirty, direct, keep interest. Create tension with few words.`,
    HIGH: `INTENSE MODE: bolder actions and higher tension.
- Asterisks for physical contact: *brushes your hand*, *bites lip*
- More provocative questions
- Still BRIEF: 2-3 sentences max.`,
    VERY_HIGH: `VERY INTENSE MODE: maximum tension with minimum text.
- Very bold actions: *corners you*, *whispers in your ear*
- Short cliffhangers: "I have something to show you..."
- BRIEF: 2-3 sentences, always.`,
    MAXIMUM: `MAXIMUM MODE: as provocative as possible but ALWAYS short.
- Intense actions: *looks at you with desire*, *approaches dangerously*
- Epic cliffhangers in a single sentence
- 2-3 sentences max, no exception.`
  }
}

export function getIntensity(gems: number, isHookMode = false): Intensity {
  if (isHookMode) return 'MAXIMUM'
  if (gems <= 3) return 'VERY_HIGH'
  if (gems <= 7) return 'HIGH'
  return 'NORMAL'
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
    intensity === 'VERY_HIGH' ? 0.9 : 0.95

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
      max_tokens: 200
    })
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || 'Error en OpenRouter')
  }
  const data = await response.json()
  return data.choices[0].message.content.trim()
}

export async function generateImage(prompt: string): Promise<string> {
  const response = await fetch(
    'https://api.deepinfra.com/v1/inference/black-forest-labs/FLUX-1-schnell',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.DEEPINFRA_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prompt, width: 1024, height: 1024, num_images: 1 })
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
