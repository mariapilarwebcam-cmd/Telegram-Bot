// app/api/character/[id]/route.ts
// Carga personaje + historial + premium + contador en una sola request.

import { NextResponse } from 'next/server'
import {
  getCharacter,
  getAllMessages,
  countUserMessages,
  getLastPurchase,
} from '@/lib/db-queries'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const characterId = parseInt(params.id, 10)
    if (isNaN(characterId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const [character, messages, count, purchase] = await Promise.all([
      getCharacter(characterId, tid),
      getAllMessages(tid, characterId, 50),
      countUserMessages(tid, characterId),
      getLastPurchase(tid),
    ])

    if (!character) {
      return NextResponse.json(
        { error: 'Personaje no encontrado' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      character,
      messages: messages || [],
      user_message_count: count,
      is_premium: !!purchase,
    })
  } catch (e: any) {
    console.error('[character/[id]] error:', e)
    return NextResponse.json(
      { error: 'Error interno', detail: e?.message || String(e) },
      { status: 500 }
    )
  }
}