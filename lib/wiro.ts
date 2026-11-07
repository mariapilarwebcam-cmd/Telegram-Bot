// lib/wiro.ts

import { WiroClient } from '@wiro-ai/wiro-mcp/client'
import { createOperationBudget } from '@/lib/operation-budget'

export type WiroImageOptions = Readonly<{
  deadlineAt: number
  signal: AbortSignal
  startTimeoutMs: number
  waitTimeoutMs: number
}>

export async function generateWiroImage(
  prompt: string,
  seedImageUrl: string,
  level: number,
  options?: WiroImageOptions
): Promise<string> {
  const WIRO_API_KEY = process.env.WIRO_API_KEY
  if (!WIRO_API_KEY) {
    throw new Error('Falta la API Key de Wiro en las variables de entorno')
  }

  const client = new WiroClient(WIRO_API_KEY)
  const modelId = 'bytedance/seedream-v4-5-uncensored'

  const params = {
    prompt: prompt,
    inputImage: seedImageUrl,
    aspectRatio: '3:4',
    resolution: '2k',
    maxImages: 1,
    watermark: 'false',
  }

  const run = await (async () => {
    if (!options) return client.runModel(modelId, params)
    const start = createOperationBudget(
      Math.min(options.deadlineAt, Date.now() + options.startTimeoutMs),
      options.signal
    )
    try {
      start.check()
      const result = await client.runModel(modelId, params, start.signal)
      start.check()
      return result
    } finally {
      start.dispose()
    }
  })()

  if (!run.result) {
    // ✅ FIX TYPESCRIPT: Extraemos el mensaje de error correctamente
    const errorObj = run.errors?.[0]
    const errorMessage = typeof errorObj === 'string' 
      ? errorObj 
      : (errorObj as any)?.message || 'Error desconocido en Wiro'
      
    console.error('[Wiro] Error al iniciar tarea:', run.errors)
    throw new Error(errorMessage)
  }

  const result = await (async () => {
    // Preserve existing callers: 55s polling, unchanged invocation.
    if (!options) return client.waitForTask(run.socketaccesstoken, 55_000)
    const wait = createOperationBudget(
      Math.min(options.deadlineAt, Date.now() + options.waitTimeoutMs),
      options.signal
    )
    try {
      wait.check()
      const remainingMs = Math.min(options.waitTimeoutMs, options.deadlineAt - Date.now())
      const detail = await client.waitForTask(run.socketaccesstoken, remainingMs, { signal: wait.signal })
      wait.check()
      return detail
    } finally {
      wait.dispose()
    }
  })()
  const task = result.tasklist[0]

  if (!task || task.pexit !== '0') {
    console.error('[Wiro] Tarea fallida o timeout:', task)
    throw new Error('La generación en Wiro falló o expiró')
  }

  const imageUrl = task.outputs?.[0]?.url
  if (!imageUrl) {
    console.error('[Wiro] Respuesta sin URL de imagen:', task)
    throw new Error('Wiro no devolvió una URL de imagen válida')
  }

  return imageUrl
}
