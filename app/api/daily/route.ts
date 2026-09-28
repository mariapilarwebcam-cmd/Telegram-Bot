// app/api/daily/route.ts

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  BASE_DAILY_GEMS,
  HOURS_BETWEEN_CLAIMS,
  GEMS_PER_ACTIVE_REFERRAL,
  MAX_ACTIVE_REFERRAL_BONUS,
  getStreakBonus,
} from '@/lib/constants'

const REFERRAL_MIN_AGE_H = 24        // el referido debe tener >24h
const REFERRAL_ACTIVE_WINDOW_H = 48  // y haber mandado mensaje en las últimas 48h

export async function POST(request: Request) {
  try {
    // ✅ AUTH: telegram_id validado por el middleware
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('gems, language, last_daily_claim, streak_count, longest_streak')
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    const now = Date.now()

    // ── Cooldown 24h ────────────────────────────────────────
    if (user.last_daily_claim) {
      const hoursSince =
        (now - new Date(user.last_daily_claim).getTime()) / 3_600_000

      if (hoursSince < HOURS_BETWEEN_CLAIMS) {
        return NextResponse.json(
          {
            error:
              user.language === 'en'
                ? `Come back in ${Math.ceil(HOURS_BETWEEN_CLAIMS - hoursSince)}h`
                : `Vuelve en ${Math.ceil(HOURS_BETWEEN_CLAIMS - hoursSince)}h`,
            hours_remaining: HOURS_BETWEEN_CLAIMS - hoursSince,
          },
          { status: 429 }
        )
      }
    }

    // ── Cálculo de racha ────────────────────────────────────
    // <24h  → ya reclamó (bloqueado arriba)
    // 24-48h → mantiene racha, +1
    // >48h  → pierde racha, reinicia en 1
    let newStreak = 1
    let streakLost = false

    if (user.last_daily_claim) {
      const hoursSince =
        (now - new Date(user.last_daily_claim).getTime()) / 3_600_000

      if (
        hoursSince >= HOURS_BETWEEN_CLAIMS &&
        hoursSince < HOURS_BETWEEN_CLAIMS * 2
      ) {
        newStreak = (user.streak_count || 0) + 1
      } else if (hoursSince >= HOURS_BETWEEN_CLAIMS * 2) {
        streakLost = (user.streak_count || 0) > 0
        newStreak = 1
      }
    }

    const longestStreak = Math.max(user.longest_streak || 0, newStreak)

    // ── Referidos ACTIVOS (>24h antigüedad + mensaje en 48h) ─
    let activeReferrals = 0
    try {
      const { data: referrals } = await supabaseAdmin
        .from('referrals')
        .select('referred_id, created_at')
        .eq('referrer_id', tid)

      const cutoff24h = now - REFERRAL_MIN_AGE_H * 3_600_000

      const eligibleIds = (referrals || [])
        .filter((r: any) => new Date(r.created_at).getTime() <= cutoff24h)
        .map((r: any) => r.referred_id)

      if (eligibleIds.length > 0) {
        const cutoff48h = new Date(
          now - REFERRAL_ACTIVE_WINDOW_H * 3_600_000
        ).toISOString()

        const { data: recentMsgs } = await supabaseAdmin
          .from('conversation_history')
          .select('telegram_id')
          .in('telegram_id', eligibleIds)
          .gte('created_at', cutoff48h)

        activeReferrals = new Set(
          (recentMsgs || []).map((m: any) => m.telegram_id)
        ).size
      }
    } catch (e) {
      console.error('[daily] referral count error:', e)
    }

    // ── Cálculo final ───────────────────────────────────────
    const referralBonus = Math.min(
      activeReferrals * GEMS_PER_ACTIVE_REFERRAL,
      MAX_ACTIVE_REFERRAL_BONUS
    )
    const streakBonus = getStreakBonus(newStreak)
    const dailyTotal = BASE_DAILY_GEMS + referralBonus + streakBonus
    const newGems = (user.gems || 0) + dailyTotal

    // ── Persistir ───────────────────────────────────────────
    await supabaseAdmin
      .from('users')
      .update({
        gems: newGems,
        last_daily_claim: new Date().toISOString(),
        streak_count: newStreak,
        longest_streak: longestStreak,
        bonus_gems_from_referrals: referralBonus,
        hook_messages_remaining: 0,
      })
      .eq('telegram_id', tid)

    await supabaseAdmin.from('gem_transactions').insert({
      telegram_id: tid,
      amount: dailyTotal,
      transaction_type: 'daily',
      description: `Diarias: base ${BASE_DAILY_GEMS} + refs ${referralBonus} + racha x${newStreak} (${streakBonus})`,
    })

    return NextResponse.json({
      gems: newGems,
      claimed: dailyTotal,
      base: BASE_DAILY_GEMS,
      referral_bonus: referralBonus,
      streak_bonus: streakBonus,
      streak_count: newStreak,
      longest_streak: longestStreak,
      active_referrals: activeReferrals,
      streak_lost: streakLost,
    })
  } catch (e: any) {
    console.error('[daily] error:', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
