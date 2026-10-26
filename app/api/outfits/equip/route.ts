// app/api/outfits/equip/route.ts
import { NextResponse } from 'next/server'
import { db, queryOne } from '@/lib/turso'

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const { character_id, outfit_key } = body

    if (!character_id || !outfit_key) {
      return NextResponse.json({ error: 'Faltan parámetros' }, { status: 400 })
    }

    const tx = await db.transaction('write')

    try {
      // 1. Obtener el personaje y su armario actual
      const charRes = await tx.execute({
        sql: `SELECT equipped_outfit, owned_outfits FROM user_characters WHERE id = ? AND telegram_id = ?`,
        args: [character_id, tid]
      })

      if (charRes.rows.length === 0) {
        await tx.rollback()
        return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })
      }

      const currentOutfit = charRes.rows[0].equipped_outfit
      let ownedOutfits: string[] = []
      
      try {
        ownedOutfits = JSON.parse(String(charRes.rows[0].owned_outfits || '[]'))
      } catch (e) {
        ownedOutfits = []
      }

      // ✅ CASO A: El usuario ya tiene este outfit en el armario del personaje (solo quiere alternar)
      if (ownedOutfits.includes(outfit_key)) {
        await tx.execute({
          sql: `UPDATE user_characters SET equipped_outfit = ? WHERE id = ? AND telegram_id = ?`,
          args: [outfit_key, character_id, tid]
        })
        await tx.commit()
        return NextResponse.json({ success: true, message: 'Outfit alternado' })
      }

      // ✅ CASO B: Es un outfit nuevo del inventario global
      const invItem = await tx.execute({
        sql: `SELECT id FROM user_inventory WHERE user_id = ? AND item_type = 'outfit' AND item_key = ? LIMIT 1`,
        args: [tid, outfit_key]
      })

      if (invItem.rows.length === 0) {
        await tx.rollback()
        return NextResponse.json({ error: 'No tienes este outfit en tu inventario' }, { status: 403 })
      }

      const inventoryId = invItem.rows[0].id

      // Borrar del inventario global (se consume)
      await tx.execute({
        sql: `DELETE FROM user_inventory WHERE id = ?`,
        args: [inventoryId]
      })

      // Añadir al armario del personaje
      ownedOutfits.push(outfit_key)
      
      await tx.execute({
        sql: `UPDATE user_characters SET equipped_outfit = ?, owned_outfits = ? WHERE id = ? AND telegram_id = ?`,
        args: [outfit_key, JSON.stringify(ownedOutfits), character_id, tid]
      })

      await tx.commit()

      return NextResponse.json({
        success: true,
        message: 'Outfit regalado permanentemente',
        is_new: true // Flag para saber si el frontend debe generar la foto de regalo
      })
    } catch (txError) {
      await tx.rollback().catch(() => {})
      throw txError
    }
  } catch (error: any) {
    console.error('[outfits/equip] error:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
