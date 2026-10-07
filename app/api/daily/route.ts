// app/api/daily/route.ts

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ensureUser } from '@/lib/user-helpers'
import { BASE_DAILY_GEMS, HOURS_BETWEEN_CLAIMS } from '@/lib/constants'

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // ✅ FIX: crea el usuario si no existe
    const user = await ensureUser(tid)
    if (!user) {
      return NextResponse.json(
        { error: 'Error cargando tu cuenta' },
        { status: 500 }
      )
    }

    const now = Date.now()

    // ── Cooldown 24h ──
    if (user.last_daily_claim) {
      const hoursSince =
        (now - new Date(user.last_daily_claim).getTime()) / 3_600_000

      if (hoursSince < HOURS_BETWEEN_CLAIMS) {
        const hoursRemaining = Math.ceil(HOURS_BETWEEN_CLAIMS - hoursSince)
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
    }

    // ✅ Recompensa plana: 3 gemas siempre
    const dailyTotal = BASE_DAILY_GEMS

    // ✅ RPC ATÓMICA
    const { data: newGems, error: rpcErr } = await supabaseAdmin.rpc(
      'increment_gems',
      {
        p_telegram_id: tid,
        p_amount: dailyTotal,
      }
    )

    if (rpcErr) {
      console.error('[daily] RPC failed:', rpcErr)
      return NextResponse.json(
        { error: 'Error actualizando gemas' },
        { status: 500 }
      )
    }

    // Actualizar timestamp + reset hook (no crítico si hay race)
    await supabaseAdmin
      .from('users')
      .update({
        last_daily_claim: new Date().toISOString(),
        hook_messages_remaining: 0,
      })
      .eq('telegram_id', tid)

    await supabaseAdmin.from('gem_transactions').insert({
      telegram_id: tid,
      amount: dailyTotal,
      transaction_type: 'daily',
      description: `Recompensa diaria (${dailyTotal} gemas)`,
    })

    return NextResponse.json({
      gems: typeof newGems === 'number' ? newGems : (user.gems || 0) + dailyTotal,
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
