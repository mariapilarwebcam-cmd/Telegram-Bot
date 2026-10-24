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

  // Ajustamos la fuerza (strength) de img2img según el nivel.
  // Nivel 1-2: 0.45 (mantiene el rostro y la ropa base casi intactos)
  // Nivel 3: 0.55 (mantiene el rostro, pero permite cambiar la ropa)
  // Nivel 4-5: 0.65 (mantiene los rasgos faciales, pero permite cambios de pose y lencería)
  const strength = level <= 2 ? 0.45 : level === 3 ? 0.55 : 0.65

  const payload = {
    taskType: "imageInference",
    taskUUID: crypto.randomUUID(),
    model: "z-image-turbo",
    positivePrompt: prompt,
    // 🛡️ BLINDAJE ANTI-BAN DE TELEGRAM
    negativePrompt: "ugly, deformed, bad anatomy, bad hands, missing fingers, extra digits, text, watermark, low quality, multiple people, worst quality, jpeg artifacts, explicit, nude, naked, nudity, genitals, penis, vagina, sex, penetration, cum, bodily fluids, pubic hair, areola, nipples, child, minor, underage, cp, gore, blood, extreme violence",
    // ✅ Formato vertical (Retrato) 832x1216
    width: 832,
    height: 1216,
    lora: [
      {
        model: "taboorealm:elusarca@1", // ✅ Tu LoRA blindado
        weight: 0.85 // ✅ Fuerza recomendada por el creador
      }
    ],
    seedImage: seedImageUrl, // ✅ La foto base del personaje (img2img)
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

    // Runware devuelve un array en data.data
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
