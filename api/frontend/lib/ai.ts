export async function generateAIResponse(
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
  intensity: 'NORMAL' | 'HIGH' | 'VERY_HIGH' | 'MAXIMUM' = 'NORMAL'
): Promise<string> {
  const temperature = intensity === 'NORMAL' ? 0.8 : intensity === 'HIGH' ? 0.85 : intensity === 'VERY_HIGH' ? 0.9 : 0.95
  
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://vercel.app',
      'X-Title': 'Telegram Mini App'
    },
    body: JSON.stringify({
      model: 'deepseek/deepseek-v4-flash-0731',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      temperature,
      max_tokens: 400
    })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error?.message || 'Error en OpenRouter')
  }

  const data = await response.json()
  return data.choices[0].message.content
}

export async function generateImage(prompt: string): Promise<string> {
  const response = await fetch('https://api.deepinfra.com/v1/inference/black-forest-labs/FLUX-1-schnell', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.DEEPINFRA_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      prompt,
      width: 1024,
      height: 1024,
      num_images: 1
    })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Error en DeepInfra')
  }

  const data = await response.json()
  return data.images?.[0]?.url || data.image
}

export async function generateAudio(text: string, voice: string = 'ef_dora'): Promise<string> {
  const response = await fetch('https://api.deepinfra.com/v1/inference/hexgrad/Kokoro-82M', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.DEEPINFRA_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text,
      voice
    })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Error en DeepInfra Audio')
  }

  const data = await response.json()
  return data.audio || data.result?.audio
}