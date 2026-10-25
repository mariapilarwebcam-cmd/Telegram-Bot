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
      // 1. Verificar que el usuario realmente tenga ese outfit en su inventario
      const invItem = await tx.execute({
        sql: `SELECT id FROM user_inventory WHERE user_id = ? AND item_type = 'outfit' AND item_key = ? LIMIT 1`,
        args: [tid, outfit_key]
      })

      if (invItem.rows.length === 0) {
        await tx.rollback()
        return NextResponse.json({ error: 'No tienes este outfit' }, { status: 403 })
      }

      const inventoryId = invItem.rows[0].id

      // 2. Borrar del inventario global (porque ahora es propiedad del personaje)
      await tx.execute({
        sql: `DELETE FROM user_inventory WHERE id = ?`,
        args: [inventoryId]
      })

      // 3. Asignar el outfit al personaje
      await tx.execute({
        sql: `UPDATE user_characters SET equipped_outfit = ? WHERE id = ? AND telegram_id = ?`,
        args: [outfit_key, character_id, tid]
      })

      await tx.commit()

      return NextResponse.json({
        success: true,
        message: 'Outfit equipado permanentemente'
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