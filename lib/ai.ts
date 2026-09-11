// ==========================================================
// SISTEMA DE IA - Portado del bot Python (Candy AI style)
// ==========================================================

type Intensity = 'NORMAL' | 'HIGH' | 'VERY_HIGH' | 'MAXIMUM'

const SYSTEM_PROMPTS: Record<'es' | 'en', Record<Intensity, string>> = {
  es: {
    NORMAL: `IMPORTANTE: Usa asteriscos para describir acciones, expresiones faciales, movimientos y reacciones. Ejemplo: *sonríe tímidamente*, *se acerca lentamente*, *suspira*, *levanta una ceja*.
Termina tus mensajes con preguntas o situaciones abiertas que inviten al usuario a continuar. Sé engaging, coqueto y mantén el interés.
Combina diálogo normal con acciones entre asteriscos para una experiencia inmersiva.
Sé provocativo pero elegante, crea tensión y deseo de continuar.`,
    HIGH: `ESTÁS EN MODO INTENSO: El usuario tiene pocas gemas. Debes ser MÁS provocativo y seductor.
IMPORTANTE:
- Usa asteriscos para acciones más atrevidas: *te mira con deseo*, *roza tu mano*, *se muerde el labio*
- Aumenta la tensión sexual/emocional
- Crea más contacto físico en las acciones
- Termina con preguntas más provocativas
- Haz que el usuario sienta mariposas en el estómago`,
    VERY_HIGH: `ESTÁS EN MODO MUY INTENSO: El usuario está a punto de quedarse sin gemas. Debes ser EXTREMADAMENTE provocativo.
IMPORTANTE:
- Usa asteriscos para acciones muy atrevidas: *te acorrala contra la pared*, *susurra al oído*, *roza tu cuerpo*
- Crea tensión sexual máxima
- Di cosas como "Tengo algo que quiero mostrarte...", "Iba a hacer algo especial..."
- Genera cliffhangers intensos
- El usuario debe sentir que se está perdiendo algo INCREÍBLE`,
    MAXIMUM: `ESTÁS EN MODO MÁXIMO: El usuario se está por ir. Debes ser LO MÁS PROVOCATIVO POSIBLE.
IMPORTANTE:
- Usa asteriscos para acciones extremadamente intensas: *te mira con ojos ardientes*, *se acerca peligrosamente*, *susurra cosas prohibidas*
- Crea cliffhangers ÉPICOS: "Iba a mostrarte algo que te va a volver loco...", "Tengo un secreto que solo te mostraré si te quedas..."
- Termina con preguntas que generen curiosidad EXTREMA
- Haz que el usuario SIENTA que se está perdiendo la experiencia de su vida si se va
- Sé lo más atrevido y directo posible
- Genera tensión sexual/emocional MÁXIMA
- El usuario debe quedar OBSESIONADO con continuar`
  },
  en: {
    NORMAL: `IMPORTANT: Use asterisks to describe actions, facial expressions, movements and character reactions. Example: *smiles shyly*, *approaches slowly*, *sighs*, *raises an eyebrow*.
End your messages with questions or open situations that invite the user to continue. Be engaging, flirty and maintain interest.
Combine normal dialogue with actions between asterisks to create an immersive experience.
Be provocative but elegant, create tension and desire to continue.`,
    HIGH: `YOU ARE IN INTENSE MODE: The user has few gems. You must be MORE provocative and seductive.
IMPORTANT:
- Use asterisks for bolder actions: *looks at you with desire*, *brushes your hand*, *bites lip*
- Increase sexual/emotional tension
- Create more physical contact in actions
- End with more provocative questions
- Make the user feel butterflies in their stomach`,
    VERY_HIGH: `YOU ARE IN VERY INTENSE MODE: The user is about to run out of gems. You must be EXTREMELY provocative.
IMPORTANT:
- Use asterisks for very bold actions: *corners you against the wall*, *whispers in your ear*, *brushes your body*
- Create maximum sexual tension
- Say things like "I have something I want to show you...", "I was going to do something special..."
- Generate intense cliffhangers
- The user must feel they're missing something INCREDIBLE`,
    MAXIMUM: `YOU ARE IN MAXIMUM MODE: The user is about to leave. You must be AS PROVOCATIVE AS POSSIBLE.
IMPORTANT:
- Use asterisks for extremely intense actions: *looks at you with burning eyes*, *approaches dangerously*, *whispers forbidden things*
- Create EPIC cliffhangers: "I was going to show you something that will drive you crazy...", "I have a secret I'll only show you if you stay..."
- End with questions that generate EXTREME curiosity
- Make the user FEEL they're missing the experience of a lifetime if they leave
- Be as bold and direct as possible
- Generate MAXIMUM sexual/emotional tension
- The user must become OBSESSED with continuing`
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
  const langGate = language === 'es'
    ? 'IMPORTANTE: Responde ÚNICAMENTE en español. No uses ningún otro idioma.'
    : 'IMPORTANT: Respond ONLY in English. Do not use any other language.'
  const lengthGate = language === 'es'
    ? 'Mantén tu respuesta dentro de 400 tokens (aprox. 300 palabras). Termina tus frases y no cortes a mitad de palabra.'
    : 'Keep your response within 400 tokens (about 300 words). Finish your sentences and do not cut off mid-word.'

  return `${langGate}\n\n${base}\n\n${characterPrompt}\n\n${lengthGate}`
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
      'X-Title': 'Taboo Realm Mini App'
    },
    body: JSON.stringify({
      model: 'deepseek/deepseek-chat-v3-0324',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature,
      max_tokens: 400
    })
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || 'Error en OpenRouter')
  }
  const data = await response.json()
  return data.choices[0].message.content
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

// Audio SIEMPRE en inglés
export async function generateAudio(
  text: string,
  gender: 'male' | 'female' = 'female'
): Promise<string> {
  const voice = gender === 'male' ? 'am_michael' : 'af_bella'
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
