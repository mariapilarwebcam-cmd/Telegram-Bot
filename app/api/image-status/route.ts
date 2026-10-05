// app/api/image-status/route.ts

import { NextResponse } from 'next/server'
import { getTaskDetail } from '@/lib/wiro'

// ✅ Timeout Vercel — 10s es suficiente (solo consulta estado en Wiro)
export const maxDuration = 10

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const taskid = searchParams.get('taskid')

  if (!taskid) {
    return NextResponse.json({ error: 'taskid required' }, { status: 400 })
  }

  try {
    const detail = await getTaskDetail(taskid)
    return NextResponse.json({
      status: detail.status,
      url: detail.outputs?.[0]?.url || null,
      error: detail.error || null,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
