import { NextResponse } from 'next/server'
import { db } from '@/lib/turso'
import { authorizedVipWorker, processVipInbox } from '@/lib/vip-inbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  if (!authorizedVipWorker(request.headers.get('authorization'), process.env.VIP_PROCESSOR_SECRET)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const botId = process.env.TELEGRAM_BOT_TOKEN?.split(':')[0]
  if (!botId || !/^\d+$/.test(botId)) {
    return NextResponse.json({ error: 'Configuración incompleta' }, { status: 503 })
  }
  const body = await request.json().catch(() => null)
  if (!Number.isSafeInteger(body?.inboxId) || body.inboxId <= 0) {
    return NextResponse.json({ error: 'inboxId inválido' }, { status: 400 })
  }
  try {
    return NextResponse.json(await processVipInbox(db, botId, body.inboxId))
  } catch {
    return NextResponse.json({ error: 'Error procesando pagos' }, { status: 503 })
  }
}