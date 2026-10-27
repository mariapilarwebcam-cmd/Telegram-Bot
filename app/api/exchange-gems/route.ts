// app/api/exchange-gems/route.ts

import { NextResponse } from 'next/server'
import { queryOne } from '@/lib/turso'
import { insertGemTransaction } from '@/lib/db-queries'

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const gemsToExchange = body.gems

    // Validar que sea un número, mínimo 2 y múltiplo de 2
    if (typeof gemsToExchange !== 'number' || gemsToExchange < 2 || gemsToExchange % 2 !== 0) {
      return NextResponse.json(
        { error: 'Cantidad inválida. Debes cambiar un número par de gemas (mínimo 2).' },
        { status: 400 }
      )
    }

    // 2 gemas = 3 mensajes
    const messagesToAdd = (gemsToExchange / 2) * 3

    // 1. Intentar descontar las gemas
    const deductResult = await queryOne<{ gems: number }>(
      `UPDATE users SET gems = gems - ? WHERE telegram_id = ? AND gems >= ? RETURNING gems`,
      [gemsToExchange, tid, gemsToExchange]
    )

    if (!deductResult) {
      return NextResponse.json(
        { error: 'No tienes suficientes gemas para hacer este cambio.' },
        { status: 400 }
      )
    }

    // 2. Sumar los mensajes (bonus_gems)
    const finalUser = await queryOne<{ gems: number; bonus_gems: number }>(
      `UPDATE users SET bonus_gems = COALESCE(bonus_gems, 0) + ?, updated_at = datetime('now') 
       WHERE telegram_id = ? RETURNING gems, bonus_gems`,
      [messagesToAdd, tid]
    )

    // 3. Registrar en el historial de transacciones
    await insertGemTransaction({
      telegram_id: tid,
      amount: -gemsToExchange,
      transaction_type: 'exchange',
      description: `Cambio de ${gemsToExchange} gemas por ${messagesToAdd} mensajes`,
    })

    return NextResponse.json({
      success: true,
      remaining_gems: finalUser?.gems ?? deductResult.gems,
      remaining_bonus_gems: finalUser?.bonus_gems ?? 0,
      exchanged: {
        gems: gemsToExchange,
        messages: messagesToAdd,
      },
    })
  } catch (e: any) {
    console.error('[exchange-gems] Error:', e)
    return NextResponse.json(
      { error: 'Error interno al procesar el cambio' },
      { status: 500 }
    )
  }
}