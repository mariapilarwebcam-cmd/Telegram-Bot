// app/api/image-status/route.ts

import { NextResponse } from 'next/server'
import { getTaskDetail } from '@/lib/wiro'

// ✅ Timeout Vercel — 10s suficiente (solo consulta estado en Wiro)
export const maxDuration = 10

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const taskid = searchParams.get('taskid')

  if (!taskid) {
    return NextResponse.json({ error: 'taskid required' }, { status: 400 })
  }

  try {
    const detail = await getTaskDetail(taskid)

    // ✅ Wiro puede devolver outputs como:
    //   - Array<{ url: string }>
    //   - Array<string>
    //   - url directo en raíz
    //   - anidado en detail.task.outputs
    const task = detail.task && typeof detail.task === 'object' ? detail.task : detail
    const outputs = (task as any)?.outputs || (detail as any).outputs

    let url: string | null = null

    if (Array.isArray(outputs) && outputs.length > 0) {
      const first: any = outputs[0]
      if (typeof first === 'string') {
        url = first
      } else if (first && typeof first === 'object') {
        url = first.url || first.downloadUrl || null
      }
    }

    // Fallbacks
    if (!url) {
      url =
        (task as any)?.outputUrl ||
        (task as any)?.url ||
        (detail as any).outputUrl ||
        (detail as any).url ||
        null
    }

    return NextResponse.json({
      status: detail.status || (task as any)?.status || 'unknown',
      url,
      error: detail.error || (task as any)?.error || null,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
