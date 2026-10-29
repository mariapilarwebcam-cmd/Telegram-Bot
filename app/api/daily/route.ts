// app/api/daily/route.ts

import { NextResponse } from 'next/server'
import { ensureUser } from '@/lib/db-queries'
import { db, queryOne } from '@/lib/turso'
import { DAILY_MESSAGES, HOURS_BETWEEN_CLAIMS } from '@/lib/constants'

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

    const lang: 'es' | 'en' = user.language === 'en' ? 'en' : 'es'
    const dailyTotal = DAILY_MESSAGES
    const cooldownHours = HOURS_BETWEEN_CLAIMS

    // ✅ FIX #1: Transacción atómica. UPDATE + INSERT del log ocurren juntos o no ocurren.
    const tx = await db.transaction('write')

    try {
      // ✅ FIX #4: Uso dinámico de cooldownHours en lugar de hardcodear -24
      // ✅ FIX #5: Si last_daily_claim está en el futuro, se permite el claim (reset por bug de reloj)
      const claimedResult = await tx.execute({
        sql: `UPDATE users
              SET bonus_gems = COALESCE(bonus_gems, 0) + ?,
                  last_daily_claim = datetime('now'),
                  hook_messages_remaining = 0,
                  updated_at = datetime('now')
              WHERE telegram_id = ?
                AND (
                  last_daily_claim IS NULL
                  OR last_daily_claim < datetime('now', '-' || ? || ' hours')
                  OR last_daily_claim > datetime('now')
                )
              RETURNING bonus_gems, gems, last_daily_claim`,
        args: [dailyTotal, tid, cooldownHours],
      })

      if (claimedResult.rows.length === 0) {
        // Cooldown activo: no se reclamó. Hacer rollback y calcular tiempo real restante.
        await tx.rollback()

        // ✅ FIX #2: Calcular hours_remaining real en lugar de hardcodear el cooldown
        const lastClaimRow = await queryOne<{ last_daily_claim: string | null }>(
          `SELECT last_daily_claim FROM users WHERE telegram_id = ? LIMIT 1`,
          [tid]
        )

        let hoursRemaining = cooldownHours
        let minutesRemaining = 0

        if (lastClaimRow?.last_daily_claim) {
          // Normalizar el formato SQLite "YYYY-MM-DD HH:MM:SS" a ISO UTC
          const raw = String(lastClaimRow.last_daily_claim)
          const normalized = raw.includes('T')
            ? (raw.endsWith('Z') ? raw : raw + 'Z')
            : raw.replace(' ', 'T') + 'Z'

          const lastClaim = new Date(normalized)
          if (!isNaN(lastClaim.getTime())) {
            const nextClaim = new Date(lastClaim.getTime() + cooldownHours * 3600 * 1000)
            const msRemaining = nextClaim.getTime() - Date.now()

            if (msRemaining > 0) {
              hoursRemaining = Math.floor(msRemaining / 3600000)
              minutesRemaining = Math.ceil((msRemaining % 3600000) / 60000)
            } else {
              hoursRemaining = 0
              minutesRemaining = 0
            }
          }
        }

        return NextResponse.json(
          {
            error:
              lang === 'en'
                ? `Come back in ${hoursRemaining}h ${minutesRemaining}m`
                : `Vuelve en ${hoursRemaining}h ${minutesRemaining}m`,
            hours_remaining: hoursRemaining,
            minutes_remaining: minutesRemaining,
            last_daily_claim: lastClaimRow?.last_daily_claim ?? null,
          },
          { status: 429 }
        )
      }

      const row = claimedResult.rows[0]
      const newBonusGems = Number(row.bonus_gems)
      const newGems = Number(row.gems)
      const newLastClaim = String(row.last_daily_claim)

      // ✅ FIX #1: Insert del log DENTRO de la misma transacción
      await tx.execute({
        sql: `INSERT INTO gem_transactions
              (telegram_id, amount, transaction_type, description)
              VALUES (?, ?, 'daily', ?)`,
        args: [
          tid,
          dailyTotal,
          `Recompensa diaria (${dailyTotal} mensajes)`,
        ],
      })

      await tx.commit()

      // ✅ FIX #3: Devolvemos last_daily_claim para que el frontend no dependa de refresh()
      // ✅ FIX #6: Devolvemos los valores reales del user para racha
      return NextResponse.json({
        gems: newGems,
        bonus_gems: newBonusGems,
        last_daily_claim: newLastClaim,
        claimed: dailyTotal,
        base: dailyTotal,
        referral_bonus: 0,
        streak_bonus: 0,
        streak_count: user.streak_count ?? 0,
        longest_streak: user.longest_streak ?? 0,
        active_referrals: 0,
        streak_lost: false,
      })
    } catch (txError) {
      await tx.rollback().catch(() => {})
      throw txError
    }
  } catch (e: any) {
    console.error('[daily] error:', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
