import { NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/turso'

export async function GET(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const url = new URL(request.url)
    const characterId = url.searchParams.get('character_id')

    // 1. Outfits en el inventario global
    const inventory = await query(`SELECT id, item_key FROM user_inventory WHERE user_id = ? AND item_type = 'outfit'`, [tid])

    // 2. Outfits en el armario del personaje
    let owned: string[] = []
    let equipped: string | null = null
    if (characterId) {
      const char = await queryOne<{ equipped_outfit: string, owned_outfits: string }>(
        `SELECT equipped_outfit, owned_outfits FROM user_characters WHERE id = ? AND telegram_id = ?`,
        [characterId, tid]
      )
      if (char) {
        equipped = char.equipped_outfit
        try { owned = JSON.parse(char.owned_outfits || '[]') } catch { owned = [] }
      }
    }

    return NextResponse.json({ 
      inventory_items: inventory,
      character_owned: owned,
      character_equipped: equipped
    })
  } catch (e) {
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}