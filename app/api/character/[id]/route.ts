// app/api/character/[id]/route.ts
import { NextResponse } from 'next/server'
import {
  getCharacter,
  getAllMessages,
  countUserMessages,
  getLastPurchase,
  getSeenImageCount,
  getActivePass,
} from '@/lib/db-queries'
import { queryOne } from '@/lib/turso' // ✅ Importamos para buscar el inventario

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

    const [character, messages, count, purchase, seenCount, activePass] = await Promise.all([
      getCharacter(characterId, tid),
      getAllMessages(tid, characterId, 50),
      countUserMessages(tid, characterId),
      getLastPurchase(tid),
      getSeenImageCount(tid, characterId),
      getActivePass(tid),
    ])

    if (!character) {
      return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })
    }

    // ✅ NUEVO: Verificamos si el usuario tiene un Pase de Fantasía
    const fantasyPass = await queryOne<{ item_key: string }>(
      `SELECT item_key FROM user_inventory WHERE user_id = ? AND item_type = 'fantasy_pass' LIMIT 1`,
      [tid]
    )

    return NextResponse.json({
      character,
      messages: messages || [],
      user_message_count: count,
      is_premium: !!purchase,
      seen_image_count: seenCount,
      active_pass: activePass || null,
      has_fantasy_pass: !!fantasyPass, // ✅ Enviamos el estado al frontend
    })
  } catch (e: any) {
    console.error('[character/[id]] error:', e)
    return NextResponse.json(
      { error: 'Error interno', detail: e?.message || String(e) },
      { status: 500 }
    )
  }
}
