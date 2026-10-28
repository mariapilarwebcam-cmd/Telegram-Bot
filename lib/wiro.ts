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
  const modelId = 'bytedance/seedream-v4-5-uncensored'

  const run = await client.runModel(modelId, {
    prompt: prompt,
    inputImage: seedImageUrl,
    aspectRatio: '3:4',
    resolution: '2k',
    maxImages: 1,
    watermark: 'false',
  })

  if (!run.result) {
    // ✅ FIX TYPESCRIPT: Extraemos el mensaje de error correctamente
    const errorObj = run.errors?.[0]
    const errorMessage = typeof errorObj === 'string' 
      ? errorObj 
      : (errorObj as any)?.message || 'Error desconocido en Wiro'
      
    console.error('[Wiro] Error al iniciar tarea:', run.errors)
    throw new Error(errorMessage)
  }

  // Esperar a que la tarea termine (Timeout de 2 minutos)
  const result = await client.waitForTask(run.socketaccesstoken, 120000)
  const task = result.tasklist[0]

  if (!task || task.pexit !== '0') {
    console.error('[Wiro] Tarea fallida:', task)
    throw new Error('La generación en Wiro falló o expiró')
  }

  const imageUrl = task.outputs?.[0]?.url
  if (!imageUrl) {
    console.error('[Wiro] Respuesta sin URL de imagen:', task)
    throw new Error('Wiro no devolvió una URL de imagen válida')
  }

  return imageUrl
}
