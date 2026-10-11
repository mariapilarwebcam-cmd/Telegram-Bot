// app/api/character/[id]/route.ts
// Carga personaje + historial + premium + contador + imágenes vistas.

import { NextResponse } from 'next/server'
import {
  getCharacter,
  getAllMessages,
  countUserMessages,
  getLastPurchase,
  getSeenImageCount,
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

    const [character, messages, count, purchase, seenCount] = await Promise.all([
      getCharacter(characterId, tid),
      getAllMessages(tid, characterId, 50),
      countUserMessages(tid, characterId),
      getLastPurchase(tid),
      getSeenImageCount(tid, characterId),
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
      seen_image_count: seenCount,
    })
  } catch (e: any) {
    console.error('[character/[id]] error:', e)
    return NextResponse.json(
      { error: 'Error interno', detail: e?.message || String(e) },
      { status: 500 }
    )
  }
}
