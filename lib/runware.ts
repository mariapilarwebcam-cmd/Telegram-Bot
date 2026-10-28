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

  // ✅ CAMBIO CLAVE: Aumentamos el strength para darle más libertad a la IA
  // Nivel 1-2: 0.65 -> Permite cambiar ropa y fondo.
  // Nivel 3: 0.70 -> Permite cambios más bruscos.
  // Nivel 4-5: 0.80 -> Máxima libertad para poses y lencería.
  const strength = level <= 2 ? 0.65 : level === 3 ? 0.70 : 0.80

  const payload = {
    taskType: "imageInference",
    taskUUID: crypto.randomUUID(),
    model: "runware:z-image@turbo", 
    positivePrompt: prompt,
    // 🛡️ BLINDAJE ANTI-BAN DE TELEGRAM + FIX ROPA
    // Añadimos "red dress, wine glass" al final para forzar a la IA a quitarlos en niveles bajos
    negativePrompt: "ugly, deformed, bad anatomy, bad hands, mutated hands, missing fingers, extra digits, text, watermark, low quality, multiple people, worst quality, jpeg artifacts, explicit, nude, naked, nudity, genitals, penis, vagina, sex, penetration, cum, bodily fluids, pubic hair, areola, nipples, child, minor, underage, cp, gore, blood, extreme violence, red dress, wine glass",
    // ✅ Parámetros de inferencia para ZImage Turbo
    steps: 10,
    CFGScale: 1.5,
    // ✅ Formato vertical (Retrato) 832x1216
    width: 832,
    height: 1216,
    
    // ✅ LORA ACTIVADO CON EL AIR CORRECTO
    lora: [
      {
        model: "taboorealm:10011@1", 
        weight: 0.80 // Mantenemos 0.80 para evitar que la imagen se sature
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
