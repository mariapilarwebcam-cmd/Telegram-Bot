// lib/runware.ts

export async function generateRunwareImage(
  prompt: string,
  seedImageUrl: string,
  level: number
): Promise<string> {
  const RUNWARE_API_KEY = process.env.RUNWARE_API_KEY
  if (!RUNWARE_API_KEY) {
    throw new Error('Falta la API Key de Runware en las variables de entorno')
  }

  // ✅ SUBIMOS LA FUERZA A 0.75
  // Esto obliga a la IA a ignorar el vestido rojo y el fondo de la foto original,
  // y le da libertad para crear la escena que pide el prompt.
  const strength = level <= 2 ? 0.75 : level === 3 ? 0.80 : 0.85

  const payload = {
    taskType: "imageInference",
    taskUUID: crypto.randomUUID(),
    model: "runware:z-image@turbo", 
    positivePrompt: prompt,
    // 🛡️ BLINDAJE ANTI-BAN (Quitamos red dress del negativo, confiamos en el prompt positivo)
    negativePrompt: "ugly, deformed, bad anatomy, bad hands, mutated hands, missing fingers, extra digits, text, watermark, low quality, multiple people, worst quality, jpeg artifacts, explicit, nude, naked, nudity, genitals, penis, vagina, sex, penetration, cum, bodily fluids, pubic hair, areola, nipples, child, minor, underage, cp, gore, blood, extreme violence",
    steps: 10,
    CFGScale: 1.5,
    width: 832,
    height: 1216,
    
    // ✅ LORA ACTIVADO
    lora: [
      {
        model: "taboorealm:10011@1", 
        weight: 0.80 
      }
    ],
    
    seedImage: seedImageUrl, 
    strength: strength
  }

  try {
    const res = await fetch("https://api.runware.ai/v1", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RUNWARE_API_KEY}`
      },
      body: JSON.stringify([payload])
    })

    const data = await res.json()

    if (data.data && data.data[0] && data.data[0].imageURL) {
      return data.data[0].imageURL
    }

    console.error('[Runware] Respuesta inesperada:', JSON.stringify(data))
    throw new Error(data.errors?.[0]?.message || 'Error generando imagen en Runware')
    
  } catch (error: any) {
    console.error('[Runware] Error de red:', error)
    throw new Error('Error de conexión con Runware: ' + error.message)
  }
}
