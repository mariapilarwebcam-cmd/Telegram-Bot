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

  // ✅ STRENGTH BAJADO A 0.50
  // Esto obliga a la IA a copiar los rasgos faciales de la imagen semilla.
  const strength = level <= 2 ? 0.50 : level === 3 ? 0.55 : 0.65

  const payload = {
    taskType: "imageInference",
    taskUUID: crypto.randomUUID(),
    model: "runware:z-image@turbo", 
    positivePrompt: prompt,
    // 🛡️ BLINDAJE ANTI-BAN + ORDEN DE BORRAR EL ENTORNO VIEJO
    negativePrompt: "ugly, deformed, bad anatomy, bad hands, mutated hands, missing fingers, extra digits, text, watermark, low quality, worst quality, jpeg artifacts, explicit, nude, naked, nudity, genitals, penis, vagina, sex, penetration, cum, bodily fluids, pubic hair, areola, nipples, child, minor, underage, cp, gore, blood, extreme violence, (red dress, red robe, wine glass, holding glass, mirror, reflection, second person, male, man, multiple people:1.5)",
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
