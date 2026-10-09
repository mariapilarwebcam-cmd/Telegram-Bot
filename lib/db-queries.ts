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
  last_daily_claim, referred_by, pending_referral_code
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
         hook_messages_remaining, hook_used, age_verified, pending_referral_code)
       VALUES (?, ?, ?, ?, ?, 0, ?, NULL, 0, 0, 0, 0, 0, ?)`,
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
    // Race condition: otro request lo creó entre SELECT e INSERT
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
// GEM OPERATIONS (atómico, sin RPC)
// ═══════════════════════════════════════════════════════════════

/**
 * Suma o resta gemas. Equivalente a `increment_gems` de Supabase.
 * Devuelve el nuevo balance.
 */
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

/**
 * Suma gemas a `gems` Y `purchased_gems` (compras). Resetea el hook.
 */
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

/**
 * Resta gemas de `gems` Y `purchased_gems` (audio/imágenes premium).
 */
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
// CHAT LIST (para la página /chats)
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