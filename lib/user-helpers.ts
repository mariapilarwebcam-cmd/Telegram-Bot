// lib/user-helpers.ts

import { supabaseAdmin } from './supabase-admin'

const USER_SELECT =
  'telegram_id, first_name, username, gems, purchased_gems, language, ' +
  'hook_messages_remaining, hook_used, referral_code, total_referrals, ' +
  'paying_referrals_count, age_verified, streak_count, longest_streak, ' +
  'last_daily_claim, referred_by, pending_referral_code'

function generateReferralCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

interface EnsureUserOptions {
  first_name?: string
  username?: string | null
  language?: 'es' | 'en'
}

/**
 * ✅ FIX CRÍTICO: Devuelve el usuario o lo CREA si no existe.
 * Nunca devuelve null salvo error irrecuperable.
 *
 * Uso: const user = await ensureUser(tid)
 *      if (!user) return error 500
 */
export async function ensureUser(
  telegramId: string,
  opts: EnsureUserOptions = {}
): Promise<any | null> {
  // 1. Intenta leer
  const { data: existing } = await supabaseAdmin
    .from('users')
    .select(USER_SELECT)
    .eq('telegram_id', telegramId)
    .maybeSingle()

  if (existing) return existing

  // 2. No existe → crear
  const insertData: Record<string, any> = {
    telegram_id: telegramId,
    first_name: opts.first_name || 'User',
    username: opts.username || null,
    language: opts.language || 'es',
    gems: 10,
    purchased_gems: 0,
    referral_code: generateReferralCode(),
    referred_by: null,
    total_referrals: 0,
    paying_referrals_count: 0,
    hook_messages_remaining: 0,
    hook_used: false,
    age_verified: false,
    pending_referral_code: null,
  }

  const { data: created, error } = await supabaseAdmin
    .from('users')
    .insert(insertData)
    .select(USER_SELECT)
    .single()

  if (error) {
    // ✅ Race condition: otro request lo creó entre el SELECT y el INSERT
    if (error.code === '23505') {
      const { data: retry } = await supabaseAdmin
        .from('users')
        .select(USER_SELECT)
        .eq('telegram_id', telegramId)
        .maybeSingle()
      return retry
    }
    console.error('[ensureUser] Error insertando:', error)
    return null
  }

  return created
}