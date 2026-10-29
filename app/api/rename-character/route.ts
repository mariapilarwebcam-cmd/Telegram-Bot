// app/api/rename-character/route.ts

import { NextResponse } from 'next/server'
import { db } from '@/lib/turso'
import { ensureUser } from '@/lib/db-queries'
import { GEM_COSTS } from '@/lib/constants'

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const cid = Number(body.character_id)
    const name = String(body.new_name || '').trim()

    if (!cid) {
      return NextResponse.json({ error: 'character_id requerido' }, { status: 400 })
    }
    if (!name) {
      return NextResponse.json({ error: 'Nombre vacío' }, { status: 400 })
    }
    if (name.length > 30) {
      return NextResponse.json(
        { error: 'Nombre demasiado largo (máx 30)' },
        { status: 400 }
      )
    }

    const user = await ensureUser(tid)
    if (!user) {
      return NextResponse.json(
        { error: 'Error cargando tu cuenta' },
        { status: 500 }
      )
    }

    const lang = (user.language || 'es') as 'es' | 'en'

    // ✅ FIX #2 y #3: Usar transacción atómica para evitar dobles cobros y desincronización
    const tx = await db.transaction('write')

    try {
      // 1. Obtener personaje DENTRO de la transacción
      const charRes = await tx.execute({
        sql: `SELECT character_name FROM user_characters WHERE id = ? AND telegram_id = ?`,
        args: [cid, tid]
      })

      if (charRes.rows.length === 0) {
        await tx.rollback()
        return NextResponse.json(
          { error: 'Personaje no encontrado' },
          { status: 404 }
        )
      }

      const currentName = String(charRes.rows[0].character_name)

      // Si el nombre es el mismo, no cobramos
      if (currentName === name) {
        await tx.rollback()
        return NextResponse.json({
          ok: true,
          character_name: name,
          remaining_gems: user.gems,
          unchanged: true,
        })
      }

      // ✅ FIX #1: Restar de gems Y purchased_gems de forma atómica
      const charged = await tx.execute({
        sql: `UPDATE users
              SET gems = gems - ?,
                  purchased_gems = MAX(COALESCE(purchased_gems, 0) - ?, 0)
              WHERE telegram_id = ? AND gems >= ?
              RETURNING gems`,
        args: [GEM_COSTS.rename_character, GEM_COSTS.rename_character, tid, GEM_COSTS.rename_character]
      })

      if (charged.rows.length === 0) {
        await tx.rollback()
        return NextResponse.json(
          {
            error: 'insufficient_gems',
            message:
              lang === 'es'
                ? `Necesitas ${GEM_COSTS.rename_character} gemas`
                : `You need ${GEM_COSTS.rename_character} gems`,
            required: GEM_COSTS.rename_character,
          },
          { status: 402 }
        )
      }

      // 2. Renombrar personaje
      await tx.execute({
        sql: `UPDATE user_characters SET character_name = ? WHERE id = ? AND telegram_id = ?`,
        args: [name, cid, tid]
      })

      // 3. Registrar el cobro en el historial
      await tx.execute({
        sql: `INSERT INTO gem_transactions (telegram_id, amount, transaction_type, description) VALUES (?, ?, ?, ?)`,
        args: [tid, -GEM_COSTS.rename_character, 'rename_character', `Renombrar personaje a "${name}"`]
      })

      await tx.commit()

      return NextResponse.json({
        ok: true,
        character_name: name,
        remaining_gems: Number(charged.rows[0].gems),
      })

    } catch (txError) {
      await tx.rollback().catch(() => {})
      throw txError
    }
  } catch (e: any) {
    console.error('Error en rename-character:', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
