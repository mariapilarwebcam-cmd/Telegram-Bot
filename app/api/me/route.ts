// app/api/me/route.ts
// Endpoint usado por UserContext para cargar al usuario.

import { NextResponse } from 'next/server'
import { ensureUser } from '@/lib/db-queries'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

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