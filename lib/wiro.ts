// lib/wiro.ts

const WIRO_API_KEY = process.env.WIRO_API_KEY!
const WIRO_BASE = 'https://api.wiro.ai/v1'

export interface WiroTaskDetail {
  id: string
  status: 'running' | 'completed' | 'failed'
  outputs?: Array<{ url: string }>
  error?: string
}

export async function runSeedream(
  prompt: string,
  referenceImageUrl?: string,
  options?: { resolution?: string; aspectRatio?: string; maxImages?: number }
): Promise<{ taskid: string }> {
  const body: Record<string, any> = {
    prompt,
    resolution: options?.resolution || '2K',
    aspectRatio: options?.aspectRatio || '3:4',
    maxImages: options?.maxImages ?? 1,
  }
  if (referenceImageUrl) body.inputImage = referenceImageUrl

  const res = await fetch(`${WIRO_BASE}/Run/bytedance/seedream-v5-lite-uncensored`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': WIRO_API_KEY,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Wiro run failed: ${res.status}`)
  }

  const data = await res.json()
  if (!data.taskid) throw new Error('Wiro did not return a taskid')
  return { taskid: data.taskid }
}

export async function getTaskDetail(taskid: string): Promise<WiroTaskDetail> {
  const res = await fetch(`${WIRO_BASE}/Task/Detail`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': WIRO_API_KEY,
    },
    body: JSON.stringify({ taskid }),
  })

  if (!res.ok) throw new Error(`Wiro task detail failed: ${res.status}`)
  return (await res.json()) as WiroTaskDetail
}

// Espera activa hasta que la tarea termine (máx 50s)
export async function waitForTask(
  taskid: string,
  maxWaitMs = 50000,
  intervalMs = 2500
): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const detail = await getTaskDetail(taskid)
    if (detail.status === 'completed') {
      const url = detail.outputs?.[0]?.url
      if (!url) throw new Error('Wiro completed without output URL')
      return url
    }
    if (detail.status === 'failed') {
      throw new Error(detail.error || 'Wiro task failed')
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error('Wiro timeout')
}

export async function runSeedreamSync(
  prompt: string,
  referenceImageUrl?: string,
  options?: { resolution?: string; aspectRatio?: string; maxImages?: number }
): Promise<string> {
  const { taskid } = await runSeedream(prompt, referenceImageUrl, options)
  return waitForTask(taskid, 50000, 2500)
}