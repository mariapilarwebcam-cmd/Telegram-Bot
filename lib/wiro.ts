// lib/wiro.ts

const WIRO_API_KEY = process.env.WIRO_API_KEY!
const WIRO_BASE = 'https://api.wiro.ai/v1'

// ✅ Modelo actualizado a v4-5-uncensored
const WIRO_MODEL = 'bytedance/seedream-v4-5-uncensored'

// Timeouts (Vercel Hobby: máx 60s)
const WIRO_TIMEOUT_MS = 50000
const WIRO_POLL_INTERVAL_MS = 2000

// ═══════════════════════════════════════════════════════════════
// ✅ Statuses normalizados de Wiro
// Wiro devuelve distintos statuses; algunos no son "completed"
// ═══════════════════════════════════════════════════════════════
const WIRO_DONE_STATUSES = new Set([
  'task_postprocess_end',
  'task_completed',
  'completed',
  'success',
  'finished',
])

const WIRO_FAIL_STATUSES = new Set([
  'task_failed',
  'failed',
  'error',
  'task_error',
])

const WIRO_RUNNING_STATUSES = new Set([
  'task_queue',
  'task_processing',
  'task_postprocess',
  'running',
  'pending',
  'queued',
  'processing',
])

export interface WiroTaskDetail {
  id?: string
  taskid?: string
  status?: string
  state?: string
  taskStatus?: string
  outputs?: Array<{ url: string } | string>
  outputUrl?: string
  url?: string
  error?: string
  errorMessage?: string
  task?: any
}

// ═══════════════════════════════════════════════════════════════
// Helper: extrae status + url + error de la respuesta de Wiro
// Wiro puede devolver la info en distintos niveles de anidación
// ═══════════════════════════════════════════════════════════════
function normalizeDetail(detail: WiroTaskDetail): {
  status: string | undefined
  url: string | undefined
  error: string | undefined
} {
  const task = detail.task && typeof detail.task === 'object' ? detail.task : detail

  const status =
    task.status || task.state || task.taskStatus || detail.status

  let url: string | undefined

  const outputs = task.outputs || detail.outputs
  if (Array.isArray(outputs) && outputs.length > 0) {
    const first: any = outputs[0]
    if (typeof first === 'string') url = first
    else if (first && typeof first === 'object') url = first.url || first.downloadUrl
  }

  if (!url) {
    url = task.outputUrl || task.url || detail.outputUrl || detail.url
  }

  const error =
    task.error || task.errorMessage || detail.error || detail.errorMessage

  return { status, url, error }
}

// ═══════════════════════════════════════════════════════════════
// Enviar tarea a Wiro
// ═══════════════════════════════════════════════════════════════
export async function runSeedream(
  prompt: string,
  referenceImageUrl?: string,
  options?: { resolution?: string; aspectRatio?: string; maxImages?: number }
): Promise<{ taskid: string }> {
  const body: Record<string, any> = {
    prompt,
    // ✅ Wiro solo acepta "auto", "2k", "3k" (minúsculas)
    resolution: (options?.resolution || '2k').toLowerCase(),
    aspectRatio: options?.aspectRatio || '3:4',
    maxImages: options?.maxImages ?? 1,
    // ✅ watermark es OBLIGATORIO
    watermark: false,
  }
  if (referenceImageUrl) body.inputImage = referenceImageUrl

  const res = await fetch(`${WIRO_BASE}/Run/${WIRO_MODEL}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': WIRO_API_KEY,
    },
    body: JSON.stringify(body),
  })

  const raw = await res.text()
  let data: any = null
  try {
    data = JSON.parse(raw)
  } catch {
    data = { raw }
  }

  if (!res.ok) {
    throw new Error(
      `Wiro run failed HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`
    )
  }

  // ✅ taskid puede venir en la raíz o anidado
  const taskid =
    data.taskid || data.task?.taskid || data.task?.id || data.id

  if (!taskid) {
    throw new Error(`Wiro did not return a taskid: ${JSON.stringify(data).slice(0, 300)}`)
  }

  return { taskid }
}

// ═══════════════════════════════════════════════════════════════
// Consultar estado de una tarea
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// Esperar a que la tarea termine
// ═══════════════════════════════════════════════════════════════
export async function waitForTask(
  taskid: string,
  maxWaitMs = WIRO_TIMEOUT_MS,
  intervalMs = WIRO_POLL_INTERVAL_MS
): Promise<string> {
  const start = Date.now()

  while (Date.now() - start < maxWaitMs) {
    const detail = await getTaskDetail(taskid)
    const { status, url, error } = normalizeDetail(detail)

    // ✅ Terminado
    if (status && WIRO_DONE_STATUSES.has(status)) {
      if (!url) {
        throw new Error(
          `Wiro completed without output URL. status=${status} raw=${JSON.stringify(detail).slice(0, 300)}`
        )
      }
      return url
    }

    // ❌ Fallo
    if (status && WIRO_FAIL_STATUSES.has(status)) {
      throw new Error(error || `Wiro task failed (status=${status})`)
    }

    // ⏳ Sigue corriendo
    if (status && WIRO_RUNNING_STATUSES.has(status)) {
      await new Promise((r) => setTimeout(r, intervalMs))
      continue
    }

    // Status desconocido → log + esperar
    console.warn(`[wiro] status desconocido: ${status}. raw=${JSON.stringify(detail).slice(0, 200)}`)
    await new Promise((r) => setTimeout(r, intervalMs))
  }

  throw new Error('Wiro timeout')
}

// ═══════════════════════════════════════════════════════════════
// Función principal (envía + espera)
// ═══════════════════════════════════════════════════════════════
export async function runSeedreamSync(
  prompt: string,
  referenceImageUrl?: string,
  options?: { resolution?: string; aspectRatio?: string; maxImages?: number }
): Promise<string> {
  const { taskid } = await runSeedream(prompt, referenceImageUrl, options)
  return waitForTask(taskid, WIRO_TIMEOUT_MS, WIRO_POLL_INTERVAL_MS)
}
