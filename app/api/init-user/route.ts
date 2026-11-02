// app/api/init-user/route.ts

import { NextResponse } from 'next/server'
import { ensureUser } from '@/lib/db-queries'
import { authenticateTelegramRequest } from '@/lib/telegram-auth'

export async function POST(request: Request) {
  let tid: string
  let first_name: string
  let username: string | null

  try {
    const authentication = await authenticateTelegramRequest(request)

    if (authentication.ok === false) {
      return NextResponse.json(
        { error: authentication.error },
        { status: authentication.status }
      )
    }

    tid = authentication.telegramId
    first_name = authentication.data.user.first_name
    username = authentication.data.user.username ?? null
  } catch {
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }

  try {
    const body = await request.json().catch(() => ({}))
    const language = body.language === 'en' ? 'en' : 'es'

    // ensureUser crea si no existe; si existe, lo devuelve tal cual
    const user = await ensureUser(tid, { first_name, username, language })

    if (!user) {
      return NextResponse.json(
        { error: 'Error creando usuario' },
        { status: 500 }
      )
    }

    return NextResponse.json({ user, created: false })
  } catch (e: any) {
    console.error('[init-user] error:', e)
    return NextResponse.json(
      { error: 'Error interno', detail: e?.message || String(e) },
      { status: 500 }
    )
  }
}
