// app/api/me/route.ts
// Endpoint usado por UserContext para cargar al usuario.

import { NextResponse } from 'next/server'
import { ensureUser } from '@/lib/db-queries'
import { authenticateTelegramRequest } from '@/lib/telegram-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  let tid: string

  try {
    const authentication = await authenticateTelegramRequest(request)

    if (authentication.ok === false) {
      return NextResponse.json(
        { error: authentication.error },
        { status: authentication.status }
      )
    }

    tid = authentication.telegramId
  } catch {
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }

  try {
    // ensureUser lee el user; si no existe lo crea
    const user = await ensureUser(tid)

    if (!user) {
      return NextResponse.json({ error: 'No se pudo cargar la cuenta' }, { status: 500 })
    }

    return NextResponse.json({ user })
  } catch (e: any) {
    console.error('[me] error:', e)
    return NextResponse.json(
      { error: 'Error interno', detail: e?.message || String(e) },
      { status: 500 }
    )
  }
}