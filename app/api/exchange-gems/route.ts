// app/api/exchange-gems/route.ts

import { NextResponse } from 'next/server'
import { db } from '@/lib/turso'

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const gemsToExchange = body.gems

    // Validar que sea un entero, mínimo 2 y múltiplo de 2
    if (
      typeof gemsToExchange !== 'number' ||
      !Number.isInteger(gemsToExchange) ||
      gemsToExchange < 2 ||
      gemsToExchange % 2 !== 0
    ) {
      return NextResponse.json(
        { error: 'Cantidad inválida. Debes cambiar un número par de gemas (mínimo 2).' },
        { status: 400 }
      )
    }

    // 2 gemas = 3 mensajes
    const messagesToAdd = (gemsToExchange / 2) * 3

    // ✅ FIX #2 y #3: Usar transacción atómica
    const tx = await db.transaction('write')

    try {
      // 1. Intentar descontar las gemas
      // ✅ FIX #1: Restar también de purchased_gems para evitar el exploit
      const deductResult = await tx.execute({
        sql: `UPDATE users 
              SET gems = gems - ?, 
                  purchased_gems = MAX(COALESCE(purchased_gems, 0) - ?, 0),
                  updated_at = datetime('now')
              WHERE telegram_id = ? AND gems >= ? 
              RETURNING gems, bonus_gems`,
        args: [gemsToExchange, gemsToExchange, tid, gemsToExchange],
      })

      if (deductResult.rows.length === 0) {
        await tx.rollback()
        return NextResponse.json(
          { error: 'No tienes suficientes gemas para hacer este cambio.' },
          { status: 400 }
        )
      }

      // 2. Sumar los mensajes (bonus_gems)
      const finalUser = await tx.execute({
        sql: `UPDATE users 
              SET bonus_gems = COALESCE(bonus_gems, 0) + ?, 
                  updated_at = datetime('now') 
              WHERE telegram_id = ? 
              RETURNING gems, bonus_gems`,
        args: [messagesToAdd, tid],
      })

      // 3. Registrar en el historial de transacciones DENTRO de la transacción
      await tx.execute({
        sql: `INSERT INTO gem_transactions (telegram_id, amount, transaction_type, description) 
              VALUES (?, ?, ?, ?)`,
        args: [
          tid,
          -gemsToExchange,
          'exchange',
          `Cambio de ${gemsToExchange} gemas por ${messagesToAdd} mensajes`,
        ],
      })

      await tx.commit()

      const row = finalUser.rows[0]

      return NextResponse.json({
        success: true,
        remaining_gems: Number(row?.gems ?? 0),
        remaining_bonus_gems: Number(row?.bonus_gems ?? 0),
        exchanged: {
          gems: gemsToExchange,
          messages: messagesToAdd,
        },
      })
    } catch (txError) {
      await tx.rollback().catch(() => {})
      throw txError
    }
  } catch (e: any) {
    console.error('[exchange-gems] Error:', e)
    return NextResponse.json(
      { error: 'Error interno al procesar el cambio' },
      { status: 500 }
    )
  }
}
