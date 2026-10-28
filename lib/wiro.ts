// lib/wiro.ts

import { WiroClient } from '@wiro-ai/wiro-mcp/client'

export async function generateWiroImage(
  prompt: string,
  seedImageUrl: string,
  level: number
): Promise<string> {
  const WIRO_API_KEY = process.env.WIRO_API_KEY
  if (!WIRO_API_KEY) {
    throw new Error('Falta la API Key de Wiro en las variables de entorno')
  }

  const client = new WiroClient(WIRO_API_KEY)

  // Ajustamos la fuerza de la imagen de referencia según el nivel.
  // Para niveles bajos, mantenemos más la foto original; para altos, damos más libertad.
  // Seedream no tiene un parámetro "strength" directo, pero podemos usar "imageWeight" si está disponible.
  // Por ahora, confiamos en el prompt para guiar el cambio.

  const modelId = 'bytedance/seedream-v4-5-uncensored'

  const run = await client.runModel(modelId, {
    prompt: prompt,
    inputImage: seedImageUrl, // La foto base del personaje
    aspectRatio: '3:4',       // Formato vertical para la Mini App
    resolution: '2k',         // 2K es suficiente y más económico
    maxImages: 1,             // Solo una imagen por generación
    watermark: 'false',
  })

  if (!run.result) {
    console.error('[Wiro] Error al iniciar tarea:', run.errors)
    throw new Error(run.errors?.[0] || 'Error al iniciar la generación en Wiro')
  }

  // Esperar a que la tarea termine
  const result = await client.waitForTask(run.socketaccesstoken, 120000) // 2 minutos de timeout
  const task = result.tasklist[0]

  if (!task || task.pexit !== '0') {
    console.error('[Wiro] Tarea fallida:', task)
    throw new Error('La generación en Wiro falló o expiró')
  }

  // La URL de la imagen generada está en task.outputs[0].url
  const imageUrl = task.outputs?.[0]?.url
  if (!imageUrl) {
    console.error('[Wiro] Respuesta sin URL de imagen:', task)
    throw new Error('Wiro no devolvió una URL de imagen válida')
  }

  return imageUrl
}