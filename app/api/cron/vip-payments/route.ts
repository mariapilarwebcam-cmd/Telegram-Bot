import { NextResponse } from 'next/server'
import { db } from '@/lib/turso'
import { authorizedVipWorker, processVipInbox } from '@/lib/vip-inbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  if (!authorizedVipWorker(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const botId = process.env.TELEGRAM_BOT_TOKEN?.split(':')[0]
  if (!botId || !/^\d+$/.test(botId)) {
    return NextResponse.json({ error: 'Configuración incompleta' }, { status: 503 })
  }
  try {
    return NextResponse.json(await processVipInbox(db, botId))
  } catch {
    return NextResponse.json({ error: 'Error procesando pagos' }, { status: 503 })
  }
}