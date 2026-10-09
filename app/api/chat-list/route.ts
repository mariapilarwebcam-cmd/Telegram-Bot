// app/api/chat-list/route.ts
// Lista de personajes del usuario + preview del último mensaje + contador.
// Usado por app/chats/page.tsx

import { NextResponse } from 'next/server'
import { getChatListData } from '@/lib/db-queries'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const chats = await getChatListData(tid)

    return NextResponse.json({ chats })
  } catch (e: any) {
    console.error('[chat-list] error:', e)
    return NextResponse.json(
      { error: 'Error interno', detail: e?.message || String(e) },
      { status: 500 }
    )
  }
}