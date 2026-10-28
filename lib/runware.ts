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

  // ✅ STRENGTH EQUILIBRADO (0.45 - 0.65)
  const strength = level <= 2 ? 0.45 : level === 3 ? 0.55 : 0.65

  const payload = {
    taskType: "imageInference",
    taskUUID: crypto.randomUUID(),
    // ✅ AIR CORRECTO PARA SDXL
    model: "stability:sdxl@1", 
    positivePrompt: prompt,
    negativePrompt: "ugly, deformed, bad anatomy, bad hands, mutated hands, missing fingers, extra digits, text, watermark, low quality, worst quality, jpeg artifacts, explicit, nude, naked, nudity, genitals, penis, vagina, sex, penetration, cum, bodily fluids, pubic hair, areola, nipples, child, minor, underage, cp, gore, blood, extreme violence, (red dress, red robe, wine glass, holding glass, mirror, reflection, second person, male, man, multiple people, giant eye, close up of eye:1.5), (bad legs, mutated legs, bad feet, missing toes, deformed feet:1.4)",
    steps: 10,
    CFGScale: 1.5,
    width: 832,
    height: 1216,
    
    // ✅ LORA DE ESTILO ANIME
    lora: [
      {
        model: "taboorealm:10011@1", 
        weight: 0.80 
      }
    ],

    // ✅ IP-ADAPTER PARA MANTENER LA CARA
    ipAdapters: [
      {
        model: "runware:55@3", 
        guideImages: [seedImageUrl],
        weight: 0.85 
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
