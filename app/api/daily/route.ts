// app/api/daily/route.ts

import { NextResponse } from 'next/server'
import {
  ensureUser,
  insertGemTransaction,
} from '@/lib/db-queries'
import { queryOne } from '@/lib/turso' // ✅ Importamos queryOne para el UPDATE atómico
import { BASE_DAILY_GEMS, HOURS_BETWEEN_CLAIMS } from '@/lib/constants'

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const user = await ensureUser(tid)
    if (!user) {
      return NextResponse.json({ error: 'Error cargando tu cuenta' }, { status: 500 })
    }

    const dailyTotal = BASE_DAILY_GEMS

    // 🛡️ FIX CRÍTICO: COBRO ATÓMICO Y VERIFICACIÓN DE 24H EN UN SOLO PASO
    // Solo suma gemas SI el cooldown de 24h ha expirado.
    const claimed = await queryOne<{ gems: number }>(
      `UPDATE users
       SET gems = gems + ?,
           last_daily_claim = datetime('now'),
           hook_messages_remaining = 0
       WHERE telegram_id = ?
         AND (last_daily_claim IS NULL OR last_daily_claim < datetime('now', '-24 hours'))
       RETURNING gems`,
      [dailyTotal, tid]
    )

    if (!claimed) {
      // Si no se pudo reclamar, es porque el cooldown sigue activo
      const hoursRemaining = HOURS_BETWEEN_CLAIMS
      return NextResponse.json(
        {
          error:
            user.language === 'en'
              ? `Come back in ${hoursRemaining}h`
              : `Vuelve en ${hoursRemaining}h`,
          hours_remaining: hoursRemaining,
        },
        { status: 429 }
      )
    }

    // El reclamo fue exitoso y seguro
    await insertGemTransaction({
      telegram_id: tid,
      amount: dailyTotal,
      transaction_type: 'daily',
      description: `Recompensa diaria (${dailyTotal} gemas)`,
    })

    return NextResponse.json({
      gems: claimed.gems,
      claimed: dailyTotal,
      base: BASE_DAILY_GEMS,
      referral_bonus: 0,
      streak_bonus: 0,
      streak_count: 0,
      longest_streak: 0,
      active_referrals: 0,
      streak_lost: false,
    })
  } catch (e: any) {
    console.error('[daily] error:', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
