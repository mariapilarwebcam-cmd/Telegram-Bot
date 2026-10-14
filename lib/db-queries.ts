// lib/db-queries.ts
// Todas las queries a Turso centralizadas por dominio

import { query, queryOne, execute, transaction } from './turso'

const nowISO = () => new Date().toISOString()

const generateReferralCode = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

// ═══════════════════════════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════════════════════════

const USER_COLS = `
  telegram_id, first_name, username, gems, purchased_gems, language,
  hook_messages_remaining, hook_used, referral_code, total_referrals,
  paying_referrals_count, age_verified, streak_count, longest_streak,
  last_daily_claim, referred_by, pending_referral_code,
  gender, interested_in, onboarding_complete,
  last_proactive_at, proactive_count, bot_blocked
`

export async function getUser(telegram_id: string) {
  return queryOne(
    `SELECT ${USER_COLS} FROM users WHERE telegram_id = ? LIMIT 1`,
    [telegram_id]
  )
}

export async function getUserByUsernameOrCode(usernameOrCode: string) {
  const clean = usernameOrCode.replace('@', '').trim()
  if (!clean) return null

  const byUser = await queryOne<{
    telegram_id: string
    username: string | null
    total_referrals: number
  }>(
    `SELECT telegram_id, username, total_referrals FROM users
     WHERE LOWER(username) = LOWER(?) LIMIT 1`,
    [clean]
  )
  if (byUser) return byUser

  return queryOne<{
    telegram_id: string
    username: string | null
    total_referrals: number
  }>(
    `SELECT telegram_id, username, total_referrals FROM users
     WHERE referral_code = ? LIMIT 1`,
    [clean]
  )
}

export async function createUser(data: {
  telegram_id: string
  first_name?: string
  username?: string | null
  language?: string
  gems?: number
  pending_referral_code?: string | null
}) {
  const referral_code = generateReferralCode()

  try {
    await execute(
      `INSERT INTO users
        (telegram_id, first_name, username, language, gems, purchased_gems,
         referral_code, referred_by, total_referrals, paying_referrals_count,
         hook_messages_remaining, hook_used, age_verified, pending_referral_code,
         gender, interested_in, onboarding_complete)
       VALUES (?, ?, ?, ?, ?, 0, ?, NULL, 0, 0, 0, 0, 0, ?, NULL, NULL, 0)`,
      [
        data.telegram_id,
        data.first_name || 'User',
        data.username || null,
        data.language || 'es',
        data.gems ?? 10,
        referral_code,
        data.pending_referral_code || null,
      ]
    )
    return getUser(data.telegram_id)
  } catch (e: any) {
    if (String(e?.message || '').includes('UNIQUE')) {
      return getUser(data.telegram_id)
    }
    throw e
  }
}

export async function ensureUser(
  telegram_id: string,
  opts: { first_name?: string; username?: string | null; language?: string } = {}
) {
  let user = await getUser(telegram_id)
  if (user) return user

  user = await createUser({
    telegram_id,
    first_name: opts.first_name,
    username: opts.username,
    language: opts.language,
  })
  return user
}

// ═══════════════════════════════════════════════════════════════
// ONBOARDING
// ═══════════════════════════════════════════════════════════════

export async function setUserGender(telegram_id: string, gender: string) {
  return execute(
    `UPDATE users SET gender = ?, updated_at = ?
     WHERE telegram_id = ?`,
    [gender, nowISO(), telegram_id]
  )
}

export async function setUserInterest(telegram_id: string, interested_in: string) {
  return execute(
    `UPDATE users SET interested_in = ?, updated_at = ?
     WHERE telegram_id = ?`,
    [interested_in, nowISO(), telegram_id]
  )
}

export async function completeOnboarding(telegram_id: string) {
  return execute(
    `UPDATE users SET onboarding_complete = 1, updated_at = ?
     WHERE telegram_id = ?`,
    [nowISO(), telegram_id]
  )
}

// ═══════════════════════════════════════════════════════════════
// GEM OPERATIONS
// ═══════════════════════════════════════════════════════════════

export async function incrementGems(
  telegram_id: string,
  amount: number
): Promise<number> {
  const row = await queryOne<{ gems: number }>(
    `UPDATE users
     SET gems = COALESCE(gems, 0) + ?,
         updated_at = ?
     WHERE telegram_id = ?
     RETURNING gems`,
    [amount, nowISO(), telegram_id]
  )
  return row?.gems ?? 0
}

export async function incrementGemsAndPurchased(
  telegram_id: string,
  amount: number
): Promise<{ new_gems: number; new_purchased: number }> {
  const row = await queryOne<{ gems: number; purchased_gems: number }>(
    `UPDATE users
     SET gems = COALESCE(gems, 0) + ?,
         purchased_gems = COALESCE(purchased_gems, 0) + ?,
         hook_messages_remaining = 0,
         updated_at = ?
     WHERE telegram_id = ?
     RETURNING gems, purchased_gems`,
    [amount, amount, nowISO(), telegram_id]
  )
  return {
    new_gems: row?.gems ?? 0,
    new_purchased: row?.purchased_gems ?? 0,
  }
}

export async function decrementGemsAndPurchased(
  telegram_id: string,
  amount: number
): Promise<{ new_gems: number; new_purchased: number }> {
  const row = await queryOne<{ gems: number; purchased_gems: number }>(
    `UPDATE users
     SET gems = COALESCE(gems, 0) - ?,
         purchased_gems = MAX(COALESCE(purchased_gems, 0) - ?, 0),
         updated_at = ?
     WHERE telegram_id = ?
     RETURNING gems, purchased_gems`,
    [amount, amount, nowISO(), telegram_id]
  )
  return {
    new_gems: row?.gems ?? 0,
    new_purchased: row?.purchased_gems ?? 0,
  }
}

export async function setHookRemaining(telegram_id: string, remaining: number) {
  return execute(
    `UPDATE users SET hook_messages_remaining = ?, updated_at = ?
     WHERE telegram_id = ?`,
    [remaining, nowISO(), telegram_id]
  )
}

export async function setHookUsed(telegram_id: string, used: boolean) {
  return execute(
    `UPDATE users SET hook_used = ?, updated_at = ?
     WHERE telegram_id = ?`,
    [used ? 1 : 0, nowISO(), telegram_id]
  )
}

export async function setAgeVerified(telegram_id: string) {
  const now = nowISO()
  return execute(
    `UPDATE users SET age_verified = 1, age_verified_at = ?, updated_at = ?
     WHERE telegram_id = ?`,
    [now, now, telegram_id]
  )
}

export async function setLastDailyClaim(telegram_id: string) {
  const now = nowISO()
  return execute(
    `UPDATE users
     SET last_daily_claim = ?, hook_messages_remaining = 0, updated_at = ?
     WHERE telegram_id = ?`,
    [now, now, telegram_id]
  )
}

export async function setPendingReferral(telegram_id: string, code: string | null) {
  return execute(
    `UPDATE users SET pending_referral_code = ?, updated_at = ?
     WHERE telegram_id = ?`,
    [code, nowISO(), telegram_id]
  )
}

export async function setReferredBy(telegram_id: string, referrerId: string) {
  return execute(
    `UPDATE users
     SET referred_by = ?, pending_referral_code = NULL, updated_at = ?
     WHERE telegram_id = ?`,
    [referrerId, nowISO(), telegram_id]
  )
}

export async function incrementPayingReferrals(telegram_id: string, count: number) {
  return execute(
    `UPDATE users SET paying_referrals_count = ?, updated_at = ?
     WHERE telegram_id = ?`,
    [count, nowISO(), telegram_id]
  )
}

export async function incrementTotalReferrals(telegram_id: string) {
  return execute(
    `UPDATE users
     SET total_referrals = COALESCE(total_referrals, 0) + 1, updated_at = ?
     WHERE telegram_id = ?`,
    [nowISO(), telegram_id]
  )
}

// ═══════════════════════════════════════════════════════════════
// CHARACTERS
// ═══════════════════════════════════════════════════════════════

export async function getCharacter(id: number, telegram_id: string) {
  return queryOne(
    `SELECT * FROM user_characters WHERE id = ? AND telegram_id = ? LIMIT 1`,
    [id, telegram_id]
  )
}

export async function getActiveCharacter(telegram_id: string) {
  return queryOne(
    `SELECT * FROM user_characters
     WHERE telegram_id = ? AND is_active = 1
     ORDER BY created_at DESC LIMIT 1`,
    [telegram_id]
  )
}

export async function getAllUserCharacters(telegram_id: string) {
  return query(
    `SELECT id, character_name, archetype, gender FROM user_characters
     WHERE telegram_id = ? ORDER BY created_at DESC`,
    [telegram_id]
  )
}

export async function findCharacterByArchetype(
  telegram_id: string,
  archetype: string,
  gender: string
) {
  return queryOne<{ id: number }>(
    `SELECT id FROM user_characters
     WHERE telegram_id = ? AND archetype = ? AND gender = ? LIMIT 1`,
    [telegram_id, archetype, gender]
  )
}

export async function deactivateAllCharacters(telegram_id: string) {
  return execute(
    `UPDATE user_characters SET is_active = 0 WHERE telegram_id = ?`,
    [telegram_id]
  )
}

export async function activateCharacter(id: number, telegram_id: string) {
  return execute(
    `UPDATE user_characters SET is_active = 1
     WHERE id = ? AND telegram_id = ?`,
    [id, telegram_id]
  )
}

export async function insertCharacter(data: {
  telegram_id: string
  character_name: string
  gender: string
  archetype: string
  personality: string
}) {
  const r = await execute(
    `INSERT INTO user_characters
      (telegram_id, character_name, gender, archetype, personality, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [
      data.telegram_id,
      data.character_name,
      data.gender,
      data.archetype,
      data.personality,
    ]
  )
  return { id: Number(r.lastInsertRowid) }
}

export async function renameCharacter(
  id: number,
  telegram_id: string,
  new_name: string
) {
  return execute(
    `UPDATE user_characters SET character_name = ?
     WHERE id = ? AND telegram_id = ?`,
    [new_name, id, telegram_id]
  )
}

// ═══════════════════════════════════════════════════════════════
// CONVERSATION HISTORY
// ═══════════════════════════════════════════════════════════════

export async function getRecentMessages(
  telegram_id: string,
  character_id: number,
  limit = 8
) {
  return query(
    `SELECT id, role, content, created_at FROM conversation_history
     WHERE telegram_id = ? AND character_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [telegram_id, character_id, limit]
  )
}

export async function getAllMessages(
  telegram_id: string,
  character_id: number,
  limit = 50
) {
  return query(
    `SELECT * FROM conversation_history
     WHERE telegram_id = ? AND character_id = ?
     ORDER BY created_at ASC, id ASC
     LIMIT ?`,
    [telegram_id, character_id, limit]
  )
}

export async function countUserMessages(
  telegram_id: string,
  character_id: number
) {
  const row = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM conversation_history
     WHERE telegram_id = ? AND character_id = ? AND role = 'user'`,
    [telegram_id, character_id]
  )
  return row?.c ?? 0
}

export async function countAllUserMessages(telegram_id: string) {
  const row = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM conversation_history
     WHERE telegram_id = ? AND role = 'user'`,
    [telegram_id]
  )
  return row?.c ?? 0
}

export async function hasAnyMessage(
  telegram_id: string,
  character_id: number
) {
  const row = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM conversation_history
     WHERE telegram_id = ? AND character_id = ? LIMIT 1`,
    [telegram_id, character_id]
  )
  return (row?.c ?? 0) > 0
}

export async function insertMessage(data: {
  telegram_id: string
  character_id: number
  role: string
  content: string
}) {
  return execute(
    `INSERT INTO conversation_history
      (telegram_id, character_id, role, content)
     VALUES (?, ?, ?, ?)`,
    [data.telegram_id, data.character_id, data.role, data.content]
  )
}

export async function insertMessages(
  msgs: Array<{
    telegram_id: string
    character_id: number
    role: string
    content: string
  }>
) {
  return transaction(
    msgs.map((m) => ({
      sql: `INSERT INTO conversation_history
            (telegram_id, character_id, role, content)
            VALUES (?, ?, ?, ?)`,
      args: [m.telegram_id, m.character_id, m.role, m.content],
    }))
  )
}

// ═══════════════════════════════════════════════════════════════
// GEM TRANSACTIONS
// ═══════════════════════════════════════════════════════════════

export async function insertGemTransaction(data: {
  telegram_id: string
  amount: number
  transaction_type: string
  description?: string
}) {
  return execute(
    `INSERT INTO gem_transactions
      (telegram_id, amount, transaction_type, description)
     VALUES (?, ?, ?, ?)`,
    [
      data.telegram_id,
      data.amount,
      data.transaction_type,
      data.description || '',
    ]
  )
}

// ═══════════════════════════════════════════════════════════════
// REFERRALS
// ═══════════════════════════════════════════════════════════════

export async function getReferralByReferred(referred_id: string) {
  return queryOne<{
    id: number
    referrer_id: string
    reward_paid: number
  }>(
    `SELECT id, referrer_id, reward_paid FROM referrals
     WHERE referred_id = ? LIMIT 1`,
    [referred_id]
  )
}

export async function insertReferral(data: {
  referrer_id: string
  referred_id: string
}) {
  try {
    await execute(
      `INSERT INTO referrals
        (referrer_id, referred_id, reward_paid, referred_message_count)
       VALUES (?, ?, 0, 0)`,
      [data.referrer_id, data.referred_id]
    )
    return true
  } catch (e: any) {
    if (String(e?.message || '').includes('UNIQUE')) return false
    throw e
  }
}

export async function updateReferralCount(
  referral_id: number,
  count: number
) {
  return execute(
    `UPDATE referrals SET referred_message_count = ? WHERE id = ?`,
    [count, referral_id]
  )
}

export async function markReferralPaid(referral_id: number) {
  return execute(
    `UPDATE referrals SET reward_paid = 1, reward_paid_at = ? WHERE id = ?`,
    [nowISO(), referral_id]
  )
}

// ═══════════════════════════════════════════════════════════════
// REFERRAL COMMISSIONS
// ═══════════════════════════════════════════════════════════════

export async function getUniqueBuyers(referrer_id: string): Promise<Set<string>> {
  const rows = await query<{ referred_id: string }>(
    `SELECT DISTINCT referred_id FROM referral_commissions
     WHERE referrer_id = ?`,
    [referrer_id]
  )
  return new Set(rows.map((r) => r.referred_id))
}

export async function insertReferralCommission(data: {
  referrer_id: string
  referred_id: string
  purchase_gems: number
  commission_gems: number
  commission_pct: number
  source: string
  reference: string
}) {
  return execute(
    `INSERT INTO referral_commissions
      (referrer_id, referred_id, purchase_gems, commission_gems,
       commission_pct, source, reference)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      data.referrer_id,
      data.referred_id,
      data.purchase_gems,
      data.commission_gems,
      data.commission_pct,
      data.source,
      data.reference,
    ]
  )
}

// ═══════════════════════════════════════════════════════════════
// STAR PURCHASES
// ═══════════════════════════════════════════════════════════════

export async function getLastPurchase(telegram_id: string) {
  return queryOne<{ id: number }>(
    `SELECT id FROM star_purchases WHERE telegram_id = ? LIMIT 1`,
    [telegram_id]
  )
}

export async function insertStarPurchase(data: {
  telegram_id: string
  stars_amount: number
  gems_amount: number
  is_first_purchase: boolean
  telegram_charge_id: string
  payment_method: string
}) {
  try {
    await execute(
      `INSERT INTO star_purchases
        (telegram_id, stars_amount, gems_amount, is_first_purchase,
         telegram_charge_id, payment_method)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        data.telegram_id,
        data.stars_amount,
        data.gems_amount,
        data.is_first_purchase ? 1 : 0,
        data.telegram_charge_id,
        data.payment_method,
      ]
    )
    return true
  } catch (e: any) {
    if (String(e?.message || '').includes('UNIQUE')) return false
    throw e
  }
}

export async function getPurchaseByChargeId(charge_id: string) {
  return queryOne<{ id: number }>(
    `SELECT id FROM star_purchases
     WHERE telegram_charge_id = ? LIMIT 1`,
    [charge_id]
  )
}

// ═══════════════════════════════════════════════════════════════
// CHAT LIST
// ═══════════════════════════════════════════════════════════════

export async function getChatListData(telegram_id: string) {
  const chars = await getAllUserCharacters(telegram_id)
  const history = await query<{
    character_id: number
    content: string
    created_at: string
    role: string
  }>(
    `SELECT character_id, content, created_at, role
     FROM conversation_history
     WHERE telegram_id = ?
     ORDER BY created_at DESC`,
    [telegram_id]
  )

  const byChar: Record<
    number,
    { lastMessage: string; lastAt: string; count: number }
  > = {}

  for (const h of history) {
    if (!byChar[h.character_id]) {
      byChar[h.character_id] = {
        lastMessage: h.content,
        lastAt: h.created_at,
        count: 0,
      }
    }
    if (h.role === 'user') byChar[h.character_id].count++
  }

  return chars.map((c: any) => ({
    id: c.id,
    character_name: c.character_name,
    archetype: c.archetype,
    gender: c.gender,
    lastMessage: byChar[c.id]?.lastMessage,
    lastAt: byChar[c.id]?.lastAt,
    messageCount: byChar[c.id]?.count || 0,
  }))
}

// ═══════════════════════════════════════════════════════════════
// PROACTIVE MESSAGES
// ═══════════════════════════════════════════════════════════════

export interface InactiveUserRow {
  telegram_id: string
  first_name: string
  language: string
  user_gender: string | null
  proactive_count: number
  last_proactive_at: string | null
  last_active: string | null
  character_id: number
  character_name: string
  character_gender: string
  character_archetype: string
}

export async function getInactiveUsers(
  limit = 200
): Promise<InactiveUserRow[]> {
  return query<InactiveUserRow>(
    `
    SELECT
      u.telegram_id,
      u.first_name,
      u.language,
      u.gender AS user_gender,
      COALESCE(u.proactive_count, 0) AS proactive_count,
      u.last_proactive_at,
      u.last_active,
      uc.id AS character_id,
      uc.character_name,
      uc.gender AS character_gender,
      uc.archetype AS character_archetype
    FROM users u
    INNER JOIN user_characters uc
      ON uc.telegram_id = u.telegram_id AND uc.is_active = 1
    WHERE
      COALESCE(u.age_verified, 0) = 1
      AND COALESCE(u.bot_blocked, 0) = 0
      AND COALESCE(u.proactive_count, 0) < 3
      AND u.last_active IS NOT NULL
      AND (
        u.last_proactive_at IS NULL
        OR u.last_proactive_at < datetime('now', '-2 days')
      )
      AND (
        (COALESCE(u.proactive_count, 0) = 0
          AND u.last_active < datetime('now', '-2 days'))
        OR
        (COALESCE(u.proactive_count, 0) = 1
          AND u.last_active < datetime('now', '-5 days'))
        OR
        (COALESCE(u.proactive_count, 0) = 2
          AND u.last_active < datetime('now', '-10 days'))
      )
    ORDER BY u.last_active ASC
    LIMIT ?
    `,
    [limit]
  )
}

export async function markProactiveSent(telegram_id: string) {
  return execute(
    `UPDATE users
     SET last_proactive_at = ?,
         proactive_count = COALESCE(proactive_count, 0) + 1,
         updated_at = ?
     WHERE telegram_id = ?`,
    [nowISO(), nowISO(), telegram_id]
  )
}

export async function markBotBlocked(telegram_id: string) {
  return execute(
    `UPDATE users
     SET bot_blocked = 1, updated_at = ?
     WHERE telegram_id = ?`,
    [nowISO(), telegram_id]
  )
}

export async function updateLastActive(telegram_id: string) {
  return execute(
    `UPDATE users SET last_active = ? WHERE telegram_id = ?`,
    [nowISO(), telegram_id]
  )
}

// ═══════════════════════════════════════════════════════════════
// IMAGE HISTORY
// ═══════════════════════════════════════════════════════════════

export async function getSeenImageCount(
  telegram_id: string,
  character_id: number
): Promise<number> {
  const row = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM user_image_history
     WHERE telegram_id = ? AND character_id = ? AND is_generated = 0`,
    [telegram_id, character_id]
  )
  return row?.c ?? 0
}

export async function markImageSeen(
  telegram_id: string,
  character_id: number,
  image_index: number,
  is_generated = false
) {
  try {
    return await execute(
      `INSERT INTO user_image_history
        (telegram_id, character_id, image_index, is_generated)
       VALUES (?, ?, ?, ?)`,
      [telegram_id, character_id, image_index, is_generated ? 1 : 0]
    )
  } catch (e: any) {
    if (String(e?.message || '').includes('UNIQUE')) {
      return { rowsAffected: 0, lastInsertRowid: 0 }
    }
    throw e
  }
}

// ═══════════════════════════════════════════════════════════════
// SUBSCRIPTIONS (VIP)
// ═══════════════════════════════════════════════════════════════

export interface SubscriptionRow {
  id: number
  telegram_id: string
  plan: 'weekly' | 'monthly' | 'quarterly' | 'annual'
  stars_paid: number
  telegram_charge_id: string
  started_at: string
  expires_at: string
  status: 'active' | 'expired' | 'cancelled'
  cancelled_at: string | null
  created_at: string
}

export async function getActiveSubscription(
  telegram_id: string
): Promise<SubscriptionRow | null> {
  return queryOne<SubscriptionRow>(
    `SELECT * FROM subscriptions
     WHERE telegram_id = ?
       AND status = 'active'
       AND expires_at > datetime('now')
     ORDER BY expires_at DESC
     LIMIT 1`,
    [telegram_id]
  )
}

export async function isUserVip(telegram_id: string): Promise<boolean> {
  const sub = await getActiveSubscription(telegram_id)
  return !!sub
}

export async function createSubscription(data: {
  telegram_id: string
  plan: 'weekly' | 'monthly' | 'quarterly' | 'annual'
  stars_paid: number
  telegram_charge_id: string
  expires_at: string
}): Promise<boolean> {
  try {
    await execute(
      `INSERT INTO subscriptions
        (telegram_id, plan, stars_paid, telegram_charge_id, expires_at, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
      [
        data.telegram_id,
        data.plan,
        data.stars_paid,
        data.telegram_charge_id,
        data.expires_at,
      ]
    )
    return true
  } catch (e: any) {
    if (String(e?.message || '').includes('UNIQUE')) return false
    throw e
  }
}

export async function cancelActiveSubscription(
  telegram_id: string
): Promise<boolean> {
  const result = await execute(
    `UPDATE subscriptions
     SET status = 'cancelled',
         cancelled_at = datetime('now')
     WHERE telegram_id = ?
       AND status = 'active'
       AND expires_at > datetime('now')`,
    [telegram_id]
  )
  return result.rowsAffected > 0
}

export async function expireOldSubscriptions(): Promise<number> {
  const result = await execute(
    `UPDATE subscriptions
     SET status = 'expired'
     WHERE status = 'active'
       AND expires_at <= datetime('now')`,
    []
  )
  return result.rowsAffected
}

export async function getSubscriptionByChargeId(charge_id: string) {
  return queryOne<SubscriptionRow>(
    `SELECT * FROM subscriptions
     WHERE telegram_charge_id = ? LIMIT 1`,
    [charge_id]
  )
}

// ═══════════════════════════════════════════════════════════════
// ✅ POOL v2 — Imágenes compartidas SIN repetir al mismo usuario
// ═══════════════════════════════════════════════════════════════
// Cambios v2:
//  - Múltiples imágenes por tag_key (sin UNIQUE)
//  - Tracking de vistas por usuario (pool_image_views)
//  - Solo sirve imágenes NO vistas por ese usuario
//  - Rotación justa: prioriza las menos usadas
// ═══════════════════════════════════════════════════════════════

export interface PoolImageRow {
  id: number
  tag_key: string
  archetype: string
  gender: string
  mood: string
  level_bucket: string
  r2_key: string
  r2_url: string
  prompt_used: string
  times_used: number
  first_user_id: string | null
  created_at: string
  last_used_at: string
}

/**
 * ✅ v2: Busca UNA imagen del pool que el usuario NO haya visto todavía.
 * Prioriza las menos usadas (rotación justa) y las más antiguas.
 * Devuelve null si no hay ninguna disponible para este usuario.
 */
export async function getAvailablePoolImage(
  tag_key: string,
  telegram_id: string
): Promise<PoolImageRow | null> {
  return queryOne<PoolImageRow>(
    `SELECT gi.* FROM generated_images gi
     WHERE gi.tag_key = ?
       AND NOT EXISTS (
         SELECT 1 FROM pool_image_views piv
         WHERE piv.pool_image_id = gi.id
           AND piv.telegram_id = ?
       )
     ORDER BY gi.times_used ASC, gi.created_at ASC
     LIMIT 1`,
    [tag_key, telegram_id]
  )
}

/**
 * ✅ v2: Registra que un usuario vio una imagen del pool.
 * UNIQUE(pool_image_id, telegram_id) previene duplicados.
 * Fail-safe: nunca rompe el flujo.
 */
export async function markPoolImageViewed(
  pool_image_id: number,
  telegram_id: string,
  character_id: number
): Promise<void> {
  try {
    await execute(
      `INSERT INTO pool_image_views
        (pool_image_id, telegram_id, character_id)
       VALUES (?, ?, ?)`,
      [pool_image_id, telegram_id, character_id]
    )
  } catch (e: any) {
    if (String(e?.message || '').includes('UNIQUE')) {
      return
    }
    console.warn('[pool] markPoolImageViewed failed:', e)
  }
}

/**
 * ✅ v2: Incrementa el contador de uso de una imagen (por ID).
 * Fire-and-forget.
 */
export async function incrementPoolImageUse(
  pool_image_id: number
): Promise<void> {
  try {
    await execute(
      `UPDATE generated_images
       SET times_used = times_used + 1,
           last_used_at = datetime('now')
       WHERE id = ?`,
      [pool_image_id]
    )
  } catch (e) {
    console.warn('[pool] incrementPoolImageUse failed:', e)
  }
}

/**
 * ✅ v2: Inserta una nueva imagen en el pool.
 * Ya NO tiene UNIQUE — permite múltiples por tag_key.
 * Retorna el ID de la nueva fila.
 */
export async function insertPoolImage(data: {
  tag_key: string
  archetype: string
  gender: string
  mood: string
  level_bucket: string
  r2_key: string
  r2_url: string
  prompt_used: string
  first_user_id: string | null
}): Promise<number> {
  const r = await execute(
    `INSERT INTO generated_images
      (tag_key, archetype, gender, mood, level_bucket,
       r2_key, r2_url, prompt_used, first_user_id, times_used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      data.tag_key,
      data.archetype,
      data.gender,
      data.mood,
      data.level_bucket,
      data.r2_key,
      data.r2_url,
      data.prompt_used,
      data.first_user_id,
    ]
  )
  return Number(r.lastInsertRowid)
}

/**
 * ✅ v2: Estadísticas del pool (para debug / admin).
 */
export async function getPoolStats(): Promise<{
  total_images: number
  total_views: number
  by_archetype: Array<{
    archetype: string
    count: number
    avg_uses: number
  }>
}> {
  const totalImages = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM generated_images`,
    []
  )

  const totalViews = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM pool_image_views`,
    []
  )

  const byArchetype = await query<{
    archetype: string
    count: number
    avg_uses: number
  }>(
    `SELECT
       archetype,
       COUNT(*) AS count,
       AVG(times_used) AS avg_uses
     FROM generated_images
     GROUP BY archetype
     ORDER BY count DESC`,
    []
  )

  return {
    total_images: totalImages?.c ?? 0,
    total_views: totalViews?.c ?? 0,
    by_archetype: byArchetype,
  }
}
// ═══════════════════════════════════════════════════════════════
// ✅ IMAGE GENERATIONS TRACKING (para límites Wiro + por contexto)
// ═══════════════════════════════════════════════════════════════
// Registra cada generación de IA (DeepInfra o Wiro) para:
//   1. Contar Wiro generadas por usuario en los últimos 30 días
//   2. Contar generaciones por tag_key por usuario (máx 10)
// ═══════════════════════════════════════════════════════════════

export async function insertImageGeneration(data: {
  telegram_id: string
  character_id: number
  tag_key: string
  model: 'deepinfra' | 'wiro' | 'r2' | 'pool'
  level: number
}): Promise<void> {
  try {
    await execute(
      `INSERT INTO image_generations
        (telegram_id, character_id, tag_key, model, level)
       VALUES (?, ?, ?, ?, ?)`,
      [data.telegram_id, data.character_id, data.tag_key, data.model, data.level]
    )
  } catch (e) {
    // Fail-safe: nunca rompe el flujo de generación de imágenes
    console.warn('[image_generations] insert failed:', e)
  }
}

/**
 * Cuenta cuántas imágenes Wiro generó el usuario en los últimos 30 días.
 * Usado para el límite VIP mensual (30/mes = 1/día promedio).
 */
export async function countUserWiroLast30Days(
  telegram_id: string
): Promise<number> {
  try {
    const row = await queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM image_generations
       WHERE telegram_id = ?
         AND model = 'wiro'
         AND created_at >= datetime('now', '-30 days')`,
      [telegram_id]
    )
    return row?.c ?? 0
  } catch (e) {
    console.warn('[image_generations] countUserWiroLast30Days failed:', e)
    return 0
  }
}

/**
 * Cuenta cuántas veces el usuario generó (IA o pool-save) con un tag_key.
 * Bloquea si supera MAX_GENERATIONS_PER_CONTEXT_PER_USER (10).
 * Ventana: últimos 30 días.
 */
export async function countUserGenerationsForTag(
  telegram_id: string,
  tag_key: string
): Promise<number> {
  try {
    const row = await queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM image_generations
       WHERE telegram_id = ?
         AND tag_key = ?
         AND created_at >= datetime('now', '-30 days')`,
      [telegram_id, tag_key]
    )
    return row?.c ?? 0
  } catch (e) {
    console.warn('[image_generations] countUserGenerationsForTag failed:', e)
    return 0
  }
}

// ═══════════════════════════════════════════════════════════════
// ✅ WIRO TOKENS — Sistema de acumulación (1/día, cap 5)
// ═══════════════════════════════════════════════════════════════
// Cada VIP recibe 1 token Wiro al día.
// Los tokens no usados se acumulan hasta un máximo de 5.
// Si supera 5, se pierde el excedente (como Candy.AI).
//
// Se hace refill lazy (on-demand): cada vez que el usuario intenta
// generar una imagen Wiro, primero se calculan los tokens acumulados
// desde el último refill.
// ═══════════════════════════════════════════════════════════════

/**
 * Refill lazy de tokens Wiro. Calcula días transcurridos desde el
 * último refill, añade 1 por día (cap 5) y actualiza el timestamp.
 * Devuelve los tokens disponibles DESPUÉS del refill.
 *
 * Fail-safe: si falla la query (columna no existe), devuelve 1.
 */
export async function ensureWiroTokensRefilled(
  telegram_id: string
): Promise<number> {
  try {
    // 1. Leer estado actual
    const user = await queryOne<{
      wiro_tokens: number | null
      wiro_last_refill_at: string | null
    }>(
      `SELECT
         wiro_tokens,
         wiro_last_refill_at
       FROM users
       WHERE telegram_id = ?
       LIMIT 1`,
      [telegram_id]
    )

    if (!user) return 0

    const currentTokens = user.wiro_tokens
    const lastRefill = user.wiro_last_refill_at

    // ─── Primera vez (columna recién añadida o user nuevo) ───
    if (lastRefill == null || currentTokens == null) {
      try {
        await execute(
          `UPDATE users
           SET wiro_tokens = 1,
               wiro_last_refill_at = datetime('now')
           WHERE telegram_id = ?`,
          [telegram_id]
        )
      } catch (e) {
        console.warn('[wiro_tokens] init failed:', e)
      }
      return 1
    }

    // ─── Calcular días completos desde el último refill ───
    const row = await queryOne<{ days: number }>(
      `SELECT CAST(julianday('now') - julianday(?) AS INTEGER) AS days`,
      [lastRefill]
    )
    const daysPassed = Math.max(0, row?.days ?? 0)

    // Sin días completos → no hay refill
    if (daysPassed === 0) {
      return currentTokens
    }

    // ─── Aplicar refill con cap ───
    const WiroCap = 5
    const newTokens = Math.min(currentTokens + daysPassed, WiroCap)

    if (newTokens >= WiroCap) {
      // Toca el cap → sincronizar last_refill_at al presente.
      // Así evitamos que "acumule tiempo" mientras está al máximo.
      await execute(
        `UPDATE users
         SET wiro_tokens = ?,
             wiro_last_refill_at = datetime('now')
         WHERE telegram_id = ?`,
        [WiroCap, telegram_id]
      )
    } else {
      // Avanzar last_refill_at por los días aplicados (conserva residuo)
      await execute(
        `UPDATE users
         SET wiro_tokens = ?,
             wiro_last_refill_at = datetime(wiro_last_refill_at, '+' || ? || ' days')
         WHERE telegram_id = ?`,
        [newTokens, daysPassed, telegram_id]
      )
    }

    return newTokens
  } catch (e) {
    // Fallback conservador: si la columna no existe, permitir 1 token
    console.warn('[wiro_tokens] ensureWiroTokensRefilled failed:', e)
    return 1
  }
}

/**
 * Consume 1 token Wiro. Devuelve los tokens restantes.
 * Fail-safe: nunca deja el contador en negativo.
 */
export async function consumeWiroToken(
  telegram_id: string
): Promise<number> {
  try {
    const row = await queryOne<{ wiro_tokens: number }>(
      `UPDATE users
       SET wiro_tokens = MAX(COALESCE(wiro_tokens, 0) - 1, 0)
       WHERE telegram_id = ?
       RETURNING wiro_tokens`,
      [telegram_id]
    )
    return row?.wiro_tokens ?? 0
  } catch (e) {
    console.warn('[wiro_tokens] consumeWiroToken failed:', e)
    return 0
  }
}

/**
 * Lee los tokens Wiro actuales SIN hacer refill.
 * Útil para mostrar en UI (settings / shop).
 */
export async function getWiroTokens(
  telegram_id: string
): Promise<number> {
  try {
    const row = await queryOne<{ wiro_tokens: number | null }>(
      `SELECT wiro_tokens FROM users WHERE telegram_id = ? LIMIT 1`,
      [telegram_id]
    )
    return row?.wiro_tokens ?? 1
  } catch {
    return 1
  }
}
// ═══════════════════════════════════════════════════════════════
// ✅ SEEN R2 INDICES — para lógica de progresión de fotos
// ═══════════════════════════════════════════════════════════════
// A diferencia de getSeenImageCount (que solo cuenta cuántas vio),
// esta función devuelve QUÉ índices específicos vio el usuario.
// Necesario para la lógica de progresión por nivel:
//   Niveles 1-3: _1 (free), _2 (cost), luego generar
//   Niveles 4-5: _1 (free), _3 (cost), _4 (cost), luego generar
// ═══════════════════════════════════════════════════════════════

export async function getSeenR2Indices(
  telegram_id: string,
  character_id: number
): Promise<Set<number>> {
  try {
    const rows = await query<{ image_index: number }>(
      `SELECT image_index FROM user_image_history
       WHERE telegram_id = ?
         AND character_id = ?
         AND is_generated = 0`,
      [telegram_id, character_id]
    )
    return new Set(rows.map((r) => Number(r.image_index)))
  } catch (e) {
    console.warn('[user_image_history] getSeenR2Indices failed:', e)
    return new Set()
  }
}

// ═══════════════════════════════════════════════════════════════
// ✅ SFW DAILY QUOTA — cupo diario VIP (nivel 1-3)
// ═══════════════════════════════════════════════════════════════
// Cuenta TODAS las imágenes entregadas al usuario en las últimas
// 24h con nivel 1-3 (SFW). Incluye:
//   - R2 static (_1, _2) → model='r2'
//   - Pool hits → model='pool'
//   - Generadas con IA → model='deepinfra'
// Usado para el cupo VIP: 10 imágenes SFW/día gratis.
// ═══════════════════════════════════════════════════════════════

export async function countSfwImageGenerationsLast24h(
  telegram_id: string
): Promise<number> {
  try {
    const row = await queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM image_generations
       WHERE telegram_id = ?
         AND level <= 3
         AND created_at >= datetime('now', '-1 day')`,
      [telegram_id]
    )
    return row?.c ?? 0
  } catch (e) {
    console.warn('[image_generations] countSfwImageGenerationsLast24h failed:', e)
    return 0
  }
}
