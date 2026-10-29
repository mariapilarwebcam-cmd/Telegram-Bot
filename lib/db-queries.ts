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

// ✅ FIX #3: Helper para checks UNIQUE case-insensitive
const isUniqueError = (e: any): boolean => {
  const msg = String(e?.message || '').toUpperCase()
  return msg.includes('UNIQUE') || msg.includes('CONSTRAINT')
}

// ═══════════════════════════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════════════════════════

const USER_COLS = `
  telegram_id, first_name, username, gems, purchased_gems, bonus_gems, language,
  hook_messages_remaining, hook_used, referral_code, total_referrals,
  paying_referrals_count, age_verified, streak_count, longest_streak,
  last_daily_claim, referred_by, pending_referral_code,
  gender, interested_in, onboarding_complete,
  last_proactive_at, proactive_count, bot_blocked,
  photo_tokens, photo_tokens_at
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

  const DEFAULT_STARTING_GEMS = 10
  let startingGems = data.gems ?? DEFAULT_STARTING_GEMS

  try {
    const alreadySeen = await queryOne<{ telegram_id: string }>(
      `SELECT telegram_id FROM telegram_ids_seen WHERE telegram_id = ? LIMIT 1`,
      [data.telegram_id]
    )

    if (alreadySeen) {
      startingGems = 0
      console.log(
        `[createUser] 🛡️ Recreated account for ${data.telegram_id} → 0 free gems`
      )
    } else {
      try {
        await execute(
          `INSERT OR IGNORE INTO telegram_ids_seen (telegram_id) VALUES (?)`,
          [data.telegram_id]
        )
      } catch (seenErr) {
        console.warn('[createUser] telegram_ids_seen insert failed:', seenErr)
      }
    }

    await execute(
      `INSERT INTO users
        (telegram_id, first_name, username, language, gems, purchased_gems,
         referral_code, referred_by, total_referrals, paying_referrals_count,
         hook_messages_remaining, hook_used, age_verified, pending_referral_code,
         gender, interested_in, onboarding_complete, photo_tokens, photo_tokens_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, NULL, 0, 0, 0, 0, 0, ?, NULL, NULL, 0, 1, unixepoch())`,
      [
        data.telegram_id,
        data.first_name || 'User',
        data.username || null,
        data.language || 'es',
        startingGems,
        referral_code,
        data.pending_referral_code || null,
      ]
    )
    return getUser(data.telegram_id)
  } catch (e: any) {
    // ✅ FIX #3: Check case-insensitive
    if (isUniqueError(e)) {
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
  // ✅ FIX #2: SELECT 1 con LIMIT 1 en lugar de COUNT(*) — short-circuit real
  const row = await queryOne<{ one: number }>(
    `SELECT 1 AS one FROM conversation_history
     WHERE telegram_id = ? AND character_id = ? LIMIT 1`,
    [telegram_id, character_id]
  )
  return row !== null
}

export async function insertMessage(data: {
  telegram_id: string
  character_id: number
  role: string
  content: string
}) {
  const res = await execute(
    `INSERT INTO conversation_history
      (telegram_id, character_id, role, content)
     VALUES (?, ?, ?, ?)`,
    [data.telegram_id, data.character_id, data.role, data.content]
  )
  return { id: Number(res.lastInsertRowid) }
}

export async function insertMessages(
  msgs: Array<{
    telegram_id: string
    character_id: number
    role: string
    content: string
  }>
) {
  const results = await transaction(
    msgs.map((m) => ({
      sql: `INSERT INTO conversation_history
            (telegram_id, character_id, role, content)
            VALUES (?, ?, ?, ?)`,
      args: [m.telegram_id, m.character_id, m.role, m.content],
    }))
  )
  return results.map((res) => ({ id: Number(res.lastInsertRowid) }))
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
    // ✅ FIX #3: Case-insensitive
    if (isUniqueError(e)) return false
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

// ✅ FIX #1 y #4 (CRÍTICO DE SEGURIDAD): getLastPurchase ahora considera
// tanto compras previas (star_purchases) COMO suscripciones VIP (subscriptions).
// Esto cierra el bypass de "first time" que permitía a un usuario VIP comprar
// el paquete de bienvenida. Afecta automáticamente a create-invoice,
// create-crypto-invoice y is-premium.
export async function getLastPurchase(telegram_id: string) {
  return queryOne<{ id: number }>(
    `SELECT id FROM star_purchases WHERE telegram_id = ?
     UNION
     SELECT id FROM subscriptions WHERE telegram_id = ?
     LIMIT 1`,
    [telegram_id, telegram_id]
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
    // ✅ FIX #3: Case-insensitive
    if (isUniqueError(e)) return false
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

  const historySummary = await query<{
    character_id: number
    lastMessage: string
    lastAt: string
    count: number
  }>(
    `SELECT
       c.character_id,
       (SELECT content FROM conversation_history
        WHERE character_id = c.character_id AND telegram_id = c.telegram_id
        ORDER BY created_at DESC, id DESC LIMIT 1) AS lastMessage,
       MAX(c.created_at) AS lastAt,
       SUM(CASE WHEN c.role = 'user' THEN 1 ELSE 0 END) AS count
     FROM conversation_history c
     WHERE c.telegram_id = ?
     GROUP BY c.character_id`,
    [telegram_id]
  )

  const byChar: Record<number, { lastMessage: string; lastAt: string; count: number }> = {}
  for (const h of historySummary) {
    byChar[h.character_id] = {
      lastMessage: h.lastMessage,
      lastAt: h.lastAt,
      count: h.count,
    }
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
    // ✅ FIX #3: Case-insensitive
    if (isUniqueError(e)) {
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
    // ✅ FIX #3: Case-insensitive
    if (isUniqueError(e)) return false
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
// POOL — Imágenes compartidas SIN repetir al mismo usuario
// ═══════════════════════════════════════════════════════════════

export interface PoolImageRow {
  id: number
  tag_key: string
  archetype: string
  gender: string
  mood: string
  level_bucket: string
  r2_key: string
  blur_r2_key: string | null
  r2_url: string
  prompt_used: string
  times_used: number
  first_user_id: string | null
  created_at: string
  last_used_at: string
}

export async function getAvailablePoolImage(
  tag_key: string,
  telegram_id: string
): Promise<PoolImageRow | null> {
  return queryOne<PoolImageRow>(
    `SELECT gi.* FROM generated_images gi
     WHERE gi.tag_key = ?
       AND gi.status = 'active'
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
    // ✅ FIX #3: Case-insensitive
    if (isUniqueError(e)) return
    console.warn('[pool] markPoolImageViewed failed:', e)
  }
}

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
// IMAGE GENERATIONS TRACKING
// ═══════════════════════════════════════════════════════════════

export async function insertImageGeneration(data: {
  telegram_id: string
  character_id: number
  tag_key: string
  model: 'runware' | 'r2' | 'pool' | 'wiro'
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
    console.warn('[image_generations] insert failed:', e)
  }
}

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
// SEEN R2 INDICES
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
// SFW DAILY QUOTA
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

// ═══════════════════════════════════════════════════════════════
// AUDIO TOKENS — Sistema de acumulación (1/día, cap 5)
// ═══════════════════════════════════════════════════════════════

export async function ensureAudioTokensRefilled(
  telegram_id: string
): Promise<number> {
  try {
    const user = await queryOne<{
      audio_tokens: number | null
      audio_last_refill_at: string | null
    }>(
      `SELECT
         audio_tokens,
         audio_last_refill_at
       FROM users
       WHERE telegram_id = ?
       LIMIT 1`,
      [telegram_id]
    )

    if (!user) return 0

    const currentTokens = user.audio_tokens
    const lastRefill = user.audio_last_refill_at

    if (lastRefill == null || currentTokens == null) {
      try {
        await execute(
          `UPDATE users
           SET audio_tokens = 1,
               audio_last_refill_at = datetime('now')
           WHERE telegram_id = ?`,
          [telegram_id]
        )
      } catch (e) {
        console.warn('[audio_tokens] init failed:', e)
      }
      return 1
    }

    const row = await queryOne<{ days: number }>(
      `SELECT CAST(julianday('now') - julianday(?) AS INTEGER) AS days`,
      [lastRefill]
    )
    const daysPassed = Math.max(0, row?.days ?? 0)

    if (daysPassed === 0) {
      return currentTokens
    }

    const AudioCap = 5
    const newTokens = Math.min(currentTokens + daysPassed, AudioCap)

    if (newTokens >= AudioCap) {
      await execute(
        `UPDATE users
         SET audio_tokens = ?,
             audio_last_refill_at = datetime('now')
         WHERE telegram_id = ?`,
        [AudioCap, telegram_id]
      )
    } else {
      await execute(
        `UPDATE users
         SET audio_tokens = ?,
             audio_last_refill_at = datetime(audio_last_refill_at, '+' || ? || ' days')
         WHERE telegram_id = ?`,
        [newTokens, daysPassed, telegram_id]
      )
    }

    return newTokens
  } catch (e) {
    console.warn('[audio_tokens] ensureAudioTokensRefilled failed:', e)
    return 1
  }
}

export async function consumeAudioToken(
  telegram_id: string
): Promise<number> {
  try {
    const row = await queryOne<{ audio_tokens: number }>(
      `UPDATE users
       SET audio_tokens = MAX(COALESCE(audio_tokens, 0) - 1, 0)
       WHERE telegram_id = ?
       RETURNING audio_tokens`,
      [telegram_id]
    )
    return row?.audio_tokens ?? 0
  } catch (e) {
    console.warn('[audio_tokens] consumeAudioToken failed:', e)
    return 0
  }
}

export async function getAudioTokens(
  telegram_id: string
): Promise<number> {
  try {
    const row = await queryOne<{ audio_tokens: number | null }>(
      `SELECT audio_tokens FROM users WHERE telegram_id = ? LIMIT 1`,
      [telegram_id]
    )
    return row?.audio_tokens ?? 1
  } catch {
    return 1
  }
}

// ═══════════════════════════════════════════════════════════════
// FRENO DE MANO Y PASE DE MENSAJES
// ═══════════════════════════════════════════════════════════════

export async function getActivePass(telegram_id: string) {
  const now = Math.floor(Date.now() / 1000)
  return queryOne<{ id: number, messages_limit: number, messages_used: number }>(
    `SELECT id, messages_limit, messages_used FROM message_passes 
     WHERE user_id = ? AND expires_at > ? AND messages_used < messages_limit 
     ORDER BY created_at DESC LIMIT 1`,
    [telegram_id, now]
  )
}

export async function consumePass(passId: number) {
  return execute(
    `UPDATE message_passes SET messages_used = messages_used + 1 WHERE id = ?`,
    [passId]
  )
}

export async function getSpendState(telegram_id: string) {
  const now = Math.floor(Date.now() / 1000)
  const state = await queryOne<{ gems_spent_24h: number, level: string, last_updated: number, rest_until: number }>(
    `SELECT gems_spent_24h, level, last_updated, rest_until FROM spend_state WHERE user_id = ? LIMIT 1`,
    [telegram_id]
  )
  
  if (!state) return null
  
  if (now - state.last_updated > 86400) {
    await execute(
      `UPDATE spend_state SET gems_spent_24h = 0, level = 'green', last_updated = ? WHERE user_id = ?`,
      [now, telegram_id]
    )
    return { gems_spent_24h: 0, level: 'green' }
  }
  
  if (state.level === 'rest' && state.rest_until < now) {
    await execute(
      `UPDATE spend_state SET gems_spent_24h = 0, level = 'green', last_updated = ? WHERE user_id = ?`,
      [now, telegram_id]
    )
    return { gems_spent_24h: 0, level: 'green' }
  }
  
  return { gems_spent_24h: state.gems_spent_24h, level: state.level }
}

export async function updateSpendState(telegram_id: string, amount: number) {
  const now = Math.floor(Date.now() / 1000)
  
  await execute(
    `INSERT INTO spend_state (user_id, gems_spent_24h, last_updated) 
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET 
       gems_spent_24h = gems_spent_24h + ?, 
       last_updated = ?`,
    [telegram_id, amount, now, amount, now]
  )
  
  const state = await queryOne<{ gems_spent_24h: number }>(
    `SELECT gems_spent_24h FROM spend_state WHERE user_id = ?`,
    [telegram_id]
  )
  
  if (state) {
    if (state.gems_spent_24h >= 500) {
      await execute(
        `UPDATE spend_state SET level = 'rest', rest_until = ? WHERE user_id = ?`,
        [now + 86400, telegram_id]
      )
    } else if (state.gems_spent_24h >= 300) {
      await execute(
        `UPDATE spend_state SET level = 'amber' WHERE user_id = ?`,
        [telegram_id]
      )
    }
  }
}

export async function grantPass(telegram_id: string, limit: number = 150) {
  const expiresAt = Math.floor(Date.now() / 1000) + 86400
  await execute(
    `INSERT INTO message_passes (user_id, expires_at, messages_limit) VALUES (?, ?, ?)`,
    [telegram_id, expiresAt, limit]
  )
  await execute(
    `UPDATE spend_state SET gems_spent_24h = 0, level = 'green' WHERE user_id = ?`,
    [telegram_id]
  )
}

// ═══════════════════════════════════════════════════════════════
// SISTEMA DE ETIQUETAS DE PREFERENCIAS
// ═══════════════════════════════════════════════════════════════

export async function saveContentTags(photo_id: number, tags: string[]) {
  if (!tags || tags.length === 0) return
  try {
    const statements = tags.map((tag) => ({
      sql: `INSERT OR IGNORE INTO content_tags (photo_id, tag) VALUES (?, ?)`,
      args: [photo_id, tag.trim().toLowerCase()]
    }))
    await transaction(statements)
  } catch (e) {
    console.warn('[content_tags] saveContentTags failed:', e)
  }
}

export async function rewardUserTags(telegram_id: string, photo_id: number, delta: number) {
  try {
    const tags = await query<{ tag: string }>(
      `SELECT tag FROM content_tags WHERE photo_id = ?`,
      [photo_id]
    )
    if (tags.length === 0) return

    const statements = tags.map((t) => ({
      sql: `INSERT INTO user_tag_scores (user_id, tag, score, updated_at) 
            VALUES (?, ?, ?, unixepoch()) 
            ON CONFLICT(user_id, tag) DO UPDATE SET 
              score = score + ?, 
              updated_at = unixepoch()`,
      args: [telegram_id, t.tag, delta, delta]
    }))
    await transaction(statements)
  } catch (e) {
    console.warn('[user_tag_scores] rewardUserTags failed:', e)
  }
}

export async function getUserTopTags(telegram_id: string, limit: number = 3): Promise<string[]> {
  try {
    const rows = await query<{ tag: string }>(
      `SELECT tag FROM user_tag_scores 
       WHERE user_id = ? AND score > 0 
       ORDER BY score DESC LIMIT ?`,
      [telegram_id, limit]
    )
    return rows.map(r => r.tag)
  } catch (e) {
    console.warn('[user_tag_scores] getUserTopTags failed:', e)
    return []
  }
}
