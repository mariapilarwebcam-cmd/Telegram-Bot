// app/api/init-user/route.ts

import { NextResponse } from 'next/server'
import { ensureUser } from '@/lib/db-queries'

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const first_name = typeof body.first_name === 'string' ? body.first_name : ''
    const username = typeof body.username === 'string' ? body.username : null
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
