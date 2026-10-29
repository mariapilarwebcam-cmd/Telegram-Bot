// app/api/character/[id]/route.ts
import { NextResponse } from 'next/server'
import {
  getCharacter,
  getAllMessages,
  countUserMessages,
  getLastPurchase,
  getSeenImageCount,
  getActivePass,
  getActiveSubscription,      // ✅ NUEVO
  countVipMessagesToday,      // ✅ NUEVO
} from '@/lib/db-queries'
import { queryOne } from '@/lib/turso'

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

    // ✅ Añadimos getActiveSubscription y countVipMessagesToday al Promise.all
    const [
      character,
      messages,
      count,
      purchase,
      seenCount,
      activePass,
      vipSub,
      vipMessagesToday,
    ] = await Promise.all([
      getCharacter(characterId, tid),
      getAllMessages(tid, characterId, 50),
      countUserMessages(tid, characterId),
      getLastPurchase(tid),
      getSeenImageCount(tid, characterId),
      getActivePass(tid),
      getActiveSubscription(tid),
      countVipMessagesToday(tid),
    ])

    if (!character) {
      return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })
    }

    // Verificamos si el usuario tiene un Pase de Fantasía
    const fantasyPass = await queryOne<{ item_key: string }>(
      `SELECT item_key FROM user_inventory WHERE user_id = ? AND item_type = 'fantasy_pass' LIMIT 1`,
      [tid]
    )

    const isVip = !!vipSub

    return NextResponse.json({
      character,
      messages: messages || [],
      user_message_count: count,
      is_premium: !!purchase || isVip, // ✅ Si es VIP, también es premium
      seen_image_count: seenCount,
      active_pass: activePass || null,
      has_fantasy_pass: !!fantasyPass,
      is_vip: isVip,                        // ✅ NUEVO: Para pintar el badge VIP
      vip_messages_today: vipMessagesToday, // ✅ NUEVO: Para la barra de progreso
    })
  } catch (e: any) {
    console.error('[character/[id]] error:', e)
    return NextResponse.json(
      { error: 'Error interno', detail: e?.message || String(e) },
      { status: 500 }
    )
  }
}
