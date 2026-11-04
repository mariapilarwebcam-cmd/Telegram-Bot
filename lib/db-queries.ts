// lib/db-queries.ts
// Todas las queries a Turso centralizadas por dominio

import { db, query, queryOne, execute, transaction } from './turso'
import type { Transaction } from '@libsql/client'
import type { GemPurchasePlan } from './gem-payments'
import {
  REFERRAL_PURCHASE_COMMISSION_PCT,
  REFERRAL_TOP_TIER_THRESHOLD,
  REFERRAL_TOP_TIER_PCT,
  REFERRAL_ELITE_TIER_THRESHOLD,
  REFERRAL_ELITE_TIER_PCT,
} from './constants'

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

// incrementGems / incrementGemsAndPurchased / decrementGemsAndPurchased se
// retiraron (R4): escribian saldos sin asiento contable y no tenian llamadores.
// Toda acreditacion debe pasar por una transaccion con movimientos contables.

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

/**
 * ✅ FIX CRÍTICO: Cuenta los SLOTS REALES consumidos del cupo VIP diario.
 * Cada mensaje consume 1 slot base + 1 extra si supera 600 caracteres
 * (penalty por longitud). Usa día calendario UTC (reset a las 00:00 UTC).
 */
export async function countVipMessagesToday(telegram_id: string): Promise<number> {
  try {
    const row = await queryOne<{ c: number }>(
      `SELECT
         COALESCE(SUM(
           CASE WHEN LENGTH(content) > 600 THEN 2 ELSE 1 END
         ), 0) AS c
       FROM conversation_history
       WHERE telegram_id = ?
         AND role = 'user'
         AND DATE(created_at) = DATE('now')`,
      [telegram_id]
    )
    return Number(row?.c ?? 0)
  } catch (e) {
    console.warn('[db-queries] countVipMessagesToday failed:', e)
    return 0
  }
}

export async function hasAnyMessage(
  telegram_id: string,
  character_id: number
) {
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

// markReferralPaid se retiro (R4): actualizaba reward_paid sin condicion y sin
// acreditar la recompensa. El claim condicional vive en la transaccion del chat.

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

export type GemPurchaseOutcome =
  | {
      status: 'applied'
      gems: number
      purchased_gems: number
      bonus_gems: number
      commission_applied: boolean
      commission_note?: 'commission_transient_failure'
    }
  | { status: 'duplicate' }
  | { status: 'user_missing' }
  | { status: 'conflict'; reason: GemPurchaseConflict }

export type CommissionTarget = {
  referrer_id: string
  base_gems: number
}

type CommissionDecision = {
  referrer_id: string
  base_gems: number
  commission_pct: number
  commission_gems: number
  total_unique: number
}

export type CommissionEvidence =
  | { state: 'absent' }
  | { state: 'recorded' }
  | {
      state: 'conflict'
      reason:
        | 'commission_mismatch'
        | 'ledger_missing'
        | 'ledger_mismatch'
        | 'ledger_orphan'
    }

export type GemPurchaseInput = {
  telegram_id: string
  telegram_charge_id: string
  is_first_purchase: boolean
  plan: GemPurchasePlan
  commission?: CommissionTarget | null
}

export type GemPurchaseConflict =
  | 'purchase_absent'
  | 'purchase_not_applied'
  | 'purchase_mismatch'
  | 'ledger_missing'
  | 'ledger_mismatch'
  | 'commission_conflict'

export class GemPurchaseTransactionError extends Error {
  constructor(code: string, readonly detail?: unknown) {
    super(code)
    this.name = 'GemPurchaseTransactionError'
  }
}

type AppliedPurchaseRow = {
  status: string
  telegram_id: string
  stars_amount: number
  gems_amount: number
  payment_method: string
}

// Un fallo de Turso solo puede considerarse "posible duplicado" ante una
// violación UNIQUE real. isUniqueError() acepta además cualquier mensaje con
// CONSTRAINT (CHECK, NOT NULL, FOREIGN KEY), lo que clasificaría errores
// transitorios o de integridad como pagos duplicados.
const isUniqueViolation = (e: any): boolean =>
  /UNIQUE constraint failed/i.test(String(e?.message || ''))

// Reglas comerciales vigentes: 5 % base, 7 % desde 5 compradores únicos y
// 10 % desde 20. `buyerAlready` reproduce el add(buyerTid) previo al conteo
// que hacían ambos rails.
export function commissionFromCounts(
  existingUnique: number,
  buyerAlready: boolean,
  baseGems: number
): Omit<CommissionDecision, 'base_gems' | 'referrer_id'> {
  const total_unique = existingUnique + (buyerAlready ? 0 : 1)
  let commission_pct = REFERRAL_PURCHASE_COMMISSION_PCT
  if (total_unique >= REFERRAL_ELITE_TIER_THRESHOLD) {
    commission_pct = REFERRAL_ELITE_TIER_PCT
  } else if (total_unique >= REFERRAL_TOP_TIER_THRESHOLD) {
    commission_pct = REFERRAL_TOP_TIER_PCT
  }
  return {
    total_unique,
    commission_pct,
    commission_gems: Math.floor((baseGems * commission_pct) / 100),
  }
}

// Colisión del asiento contable de la comisión. Se lanza SOLO desde el insert
// de `"<charge>:commission"`, de modo que el asiento del comprador (mismo
// charge_id sin sufijo) nunca puede confundirse con una comisión duplicada.
class CommissionLedgerConflict extends Error {
  constructor(readonly original: unknown) {
    super('commission_ledger_conflict')
    this.name = 'CommissionLedgerConflict'
  }
}

// Solo señales de duplicidad de comisión: trigger de la migración 003, índice
// UNIQUE de referral_commissions o la colisión tipada del asiento de comisión.
const isCommissionGateError = (e: any): boolean => {
  if (e instanceof CommissionLedgerConflict) return true
  const message = String(e?.message || '')
  return (
    /duplicate_referral_commission/i.test(message) ||
    /UNIQUE constraint failed: referral_commissions\./i.test(message)
  )
}

// Marca un fallo de la sentencia de comisión para reintentar sin confundirlo
// con un pago duplicado.
class GemPurchaseStageError extends Error {
  constructor(readonly stage: 'commission', readonly original: unknown) {
    super(`gem_purchase_stage_${stage}`)
    this.name = 'GemPurchaseStageError'
  }
}

// Contadores de tramo leídos DENTRO de la transacción.
async function readCommissionCounts(
  executor: Pick<Transaction, 'execute'>,
  referrerId: string,
  buyerId: string
): Promise<{ existing: number; buyerAlready: boolean }> {
  const result = await executor.execute({
    sql: `SELECT COUNT(DISTINCT referred_id) AS unique_total,
                 SUM(CASE WHEN referred_id = ? THEN 1 ELSE 0 END) AS buyer_rows
            FROM referral_commissions
           WHERE referrer_id = ?`,
    args: [buyerId, referrerId],
  })

  const row: any = result.rows[0] ?? {}
  return {
    existing: Number(row.unique_total ?? 0),
    buyerAlready: Number(row.buyer_rows ?? 0) > 0,
  }
}

// Resultado explícito de resolver el referidor de una compra NUEVA.
// Solo lecturas: no escribe nada ni altera la decisión persistida.
export type CommissionTargetResult =
  | { status: 'resolved'; target: CommissionTarget }
  | { status: 'no_referrer' }
  | { status: 'referrer_missing' }
  | { status: 'not_applicable' }

// El referidor sale EXCLUSIVAMENTE de users.referred_by (nunca del cliente) y
// la base la aporta el plan validado del servidor. Los errores de lectura se
// propagan: no se convierten en "sin comisión".
export async function resolveCommissionTarget(
  buyerTid: string,
  baseGems: number
): Promise<CommissionTargetResult> {
  if (!Number.isFinite(baseGems) || baseGems <= 0) {
    return { status: 'not_applicable' }
  }

  const buyer = await getUser(buyerTid)
  if (!buyer) return { status: 'not_applicable' }
  if (!buyer.referred_by) return { status: 'no_referrer' }

  const referrerId = String(buyer.referred_by)
  const referrer = await getUser(referrerId)
  if (!referrer) return { status: 'referrer_missing' }

  return {
    status: 'resolved',
    target: { referrer_id: referrerId, base_gems: Math.floor(baseGems) },
  }
}

export type PurchaseEvidence =
  | { state: 'applied' }
  | { state: 'conflict'; reason: GemPurchaseConflict }

// ✅ H-3: prueba de que un cargo ya fue aplicado, sin coincidencias de texto.
//   1. La fila debe existir con status = 'applied'. Ese estado se escribe en
//      la MISMA transacción que el saldo, así que solo existe si se confirmó.
//      Las compras antiguas quedan en 'review_required' y nunca se dan por
//      duplicadas ni se vuelven a acreditar.
//   2. Los datos del pago deben coincidir (is_first_purchase no se compara:
//      un reintento lo recalcula y puede diferir legítimamente).
//   3. Si el pago genera movimiento contable, debe existir una fila de
//      gem_transactions con ese charge_id exacto (índice UNIQUE).
// Si una lectura falla, el error se propaga: nunca se inventa evidencia.
export async function proveAppliedPurchase(
  data: { telegram_id: string; telegram_charge_id: string },
  plan: GemPurchasePlan
): Promise<PurchaseEvidence> {
  const purchase = await queryOne<AppliedPurchaseRow>(
    `SELECT status, telegram_id, stars_amount, gems_amount, payment_method
       FROM star_purchases
      WHERE telegram_charge_id = ?
      LIMIT 1`,
    [data.telegram_charge_id]
  )

  if (!purchase) return { state: 'conflict', reason: 'purchase_absent' }
  if (String(purchase.status) !== 'applied') {
    return { state: 'conflict', reason: 'purchase_not_applied' }
  }

  // Se compara contra el plan derivado del catálogo, no contra valores del
  // llamador. is_first_purchase no se compara: un reintento lo recalcula.
  const samePayment =
    String(purchase.telegram_id) === String(data.telegram_id) &&
    Number(purchase.stars_amount) === Number(plan.stars_amount) &&
    Number(purchase.gems_amount) === Number(plan.gems_amount) &&
    String(purchase.payment_method) === String(plan.payment_method)

  if (!samePayment) return { state: 'conflict', reason: 'purchase_mismatch' }

  // La exigencia del movimiento contable depende del tipo de compra validado
  // (plan.requiresLedger), nunca de un booleano enviado por el llamador.
  if (plan.requiresLedger) {
    if (!plan.ledger) return { state: 'conflict', reason: 'ledger_missing' }

    const ledger = await queryOne<{
      id: number
      telegram_id: string
      amount: number
      transaction_type: string
    }>(
      `SELECT id, telegram_id, amount, transaction_type
         FROM gem_transactions
        WHERE charge_id = ?
        LIMIT 1`,
      [data.telegram_charge_id]
    )

    if (!ledger) return { state: 'conflict', reason: 'ledger_missing' }

    const sameLedger =
      String(ledger.telegram_id) === String(data.telegram_id) &&
      Number(ledger.amount) === Number(plan.ledger.amount) &&
      String(ledger.transaction_type) === String(plan.ledger.type)

    if (!sameLedger) return { state: 'conflict', reason: 'ledger_mismatch' }
  }

  return { state: 'applied' }
}

// ✅ H-3: cargo + entrega de recursos + movimiento contable + status='applied'
// confirmados en UNA sola transacción de escritura (BEGIN IMMEDIATE, misma
// conexión). Si algo falla se revierte todo: nunca queda una compra aplicada
// sin recursos, ni recursos sin compra.
//
// Todos los importes provienen de `plan`, derivado del catálogo del servidor.
// Semántica de saldos idéntica a la anterior:
//   gems     → gems += g, purchased_gems += g, hook_messages_remaining = 0
//   messages → bonus_gems += m, hook_messages_remaining = 0
//   hybrid   → gems += g, purchased_gems += g, bonus_gems += m, hook = 0
// El movimiento contable solo se escribe si el plan lo define
// (Stars no lo crea para paquetes de solo mensajes, igual que antes).
// Único punto que mueve dinero de comisiones. Se ejecuta SIEMPRE dentro de una
// transacción abierta por el llamador (nunca en escrituras sueltas).
async function applyCommissionInTransaction(
  tx: Transaction,
  params: {
    referrer_id: string
    buyer_id: string
    charge_id: string
    rail: 'stars' | 'crypto'
    decision: CommissionDecision
  }
): Promise<{ applied: boolean }> {
  if (params.decision.commission_gems <= 0) return { applied: false }

  const referrer = await tx.execute({
    sql: `UPDATE users
           SET gems = COALESCE(gems, 0) + ?, updated_at = ?
           WHERE telegram_id = ?
           RETURNING gems`,
    args: [params.decision.commission_gems, nowISO(), params.referrer_id],
  })
  if (referrer.rows.length === 0) return { applied: false }

  await tx.execute({
    sql: `INSERT INTO referral_commissions
            (referrer_id, referred_id, purchase_gems, commission_gems,
             commission_pct, source, reference)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      params.referrer_id,
      params.buyer_id,
      params.decision.base_gems,
      params.decision.commission_gems,
      params.decision.commission_pct,
      params.rail,
      params.charge_id,
    ],
  })

  await tx.execute({
    sql: `UPDATE users
           SET paying_referrals_count = MAX(COALESCE(paying_referrals_count, 0), ?),
               updated_at = ?
           WHERE telegram_id = ?`,
    args: [params.decision.total_unique, nowISO(), params.referrer_id],
  })

  try {
    await tx.execute({
      sql: `INSERT INTO gem_transactions
              (telegram_id, amount, transaction_type, description, charge_id)
            VALUES (?, ?, 'referral_commission', ?, ?)`,
      args: [
        params.referrer_id,
        params.decision.commission_gems,
        `Comisión ${params.decision.commission_pct}% por compra de referido`,
        `${params.charge_id}:commission`,
      ],
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw new CommissionLedgerConflict(error)
    throw error
  }

  return { applied: true }
}

// Tres estados. `recorded` exige fila + asiento correctos: una fila suelta no
// demuestra que el saldo del referidor se acreditó.
export async function commissionEvidence(
  executor: Pick<Transaction, 'execute'>,
  expected: {
    buyer_id: string
    charge_id: string
    referrer_id: string
    rail: 'stars' | 'crypto'
    purchase_gems: number
    commission_gems: number
    commission_pct: number
  }
): Promise<CommissionEvidence> {
  const found = await executor.execute({
    sql: `SELECT referrer_id, referred_id, source, reference,
                 purchase_gems, commission_gems, commission_pct
            FROM referral_commissions
           WHERE referred_id = ? AND reference = ?
           LIMIT 1`,
    args: [expected.buyer_id, expected.charge_id],
  })

  const row: any = found.rows[0]

  if (!row) {
    const orphan = await executor.execute({
      sql: `SELECT 1 AS present FROM gem_transactions WHERE charge_id = ? LIMIT 1`,
      args: [`${expected.charge_id}:commission`],
    })
    return orphan.rows.length > 0
      ? { state: 'conflict', reason: 'ledger_orphan' }
      : { state: 'absent' }
  }

  const sameCommission =
    String(row.referrer_id) === expected.referrer_id &&
    String(row.referred_id) === expected.buyer_id &&
    String(row.reference) === expected.charge_id &&
    String(row.source) === expected.rail &&
    Number(row.purchase_gems) === expected.purchase_gems &&
    Number(row.commission_gems) === expected.commission_gems &&
    Number(row.commission_pct) === expected.commission_pct

  if (!sameCommission) return { state: 'conflict', reason: 'commission_mismatch' }

  const entry = await executor.execute({
    sql: `SELECT telegram_id, amount, transaction_type
            FROM gem_transactions
           WHERE charge_id = ?
           LIMIT 1`,
    args: [`${expected.charge_id}:commission`],
  })

  const ledger: any = entry.rows[0]
  if (!ledger) return { state: 'conflict', reason: 'ledger_missing' }

  const sameLedger =
    String(ledger.telegram_id) === expected.referrer_id &&
    Number(ledger.amount) === expected.commission_gems &&
    String(ledger.transaction_type) === 'referral_commission'

  return sameLedger
    ? { state: 'recorded' }
    : { state: 'conflict', reason: 'ledger_mismatch' }
}

type CommissionEvidenceState =
  | { kind: 'recorded' }
  | { kind: 'absent' }
  | {
      kind: 'conflict'
      reason: 'commission_mismatch' | 'ledger_missing' | 'ledger_mismatch' | 'ledger_orphan'
    }
  | { kind: 'unavailable'; error: unknown }

// Evidencia con la decisión PERSISTIDA (nunca recalcula el porcentaje ni usa
// users.referred_by). Un fallo de lectura NUNCA se interpreta como ausencia.
async function readCommissionEvidenceState(
  data: GemPurchaseInput
): Promise<CommissionEvidenceState> {
  try {
    const purchase = await queryOne<{
      status: string
      payment_method: string
      commission_referrer_id: string | null
      commission_base_gems: number | null
      commission_pct: number | null
    }>(
      `SELECT status, payment_method, commission_referrer_id,
              commission_base_gems, commission_pct
         FROM star_purchases
        WHERE telegram_charge_id = ? AND telegram_id = ?
        LIMIT 1`,
      [data.telegram_charge_id, data.telegram_id]
    )

    if (!purchase || String(purchase.status) !== 'applied') return { kind: 'absent' }
    if (
      purchase.commission_referrer_id == null ||
      purchase.commission_base_gems == null ||
      purchase.commission_pct == null
    ) {
      return { kind: 'absent' }
    }

    const base = Number(purchase.commission_base_gems)
    const pct = Number(purchase.commission_pct)

    const tx = await db.transaction('read')
    try {
      const evidence = await commissionEvidence(tx, {
        buyer_id: data.telegram_id,
        charge_id: data.telegram_charge_id,
        referrer_id: String(purchase.commission_referrer_id),
        rail: String(purchase.payment_method).startsWith('crypto') ? 'crypto' : 'stars',
        purchase_gems: base,
        commission_gems: Math.floor((base * pct) / 100),
        commission_pct: pct,
      })

      if (evidence.state === 'recorded') return { kind: 'recorded' }
      if (evidence.state === 'absent') return { kind: 'absent' }
      return { kind: 'conflict', reason: evidence.reason }
    } finally {
      tx.close()
    }
  } catch (error) {
    return { kind: 'unavailable', error }
  }
}

// Conflicto: ni reintento ni compra pendiente automática. El estado del pago
// decide la respuesta; nunca se vuelve a acreditar.
async function settleCommissionConflict(
  data: GemPurchaseInput,
  reason: string
): Promise<GemPurchaseOutcome> {
  const payment = await proveAppliedPurchase(data, data.plan)

  if (payment.state === 'applied') {
    console.error(
      '[db-queries] comisión en conflicto con pago aplicado:',
      data.telegram_charge_id,
      reason
    )
    return { status: 'conflict', reason: 'commission_conflict' }
  }

  throw new GemPurchaseTransactionError('commission_review_required', reason)
}

// Resultado incierto: se conserva el error original (commit_uncertain,
// rollback_failed, close_failed...) y nunca se autoriza una nueva acreditación.
async function settleUncertainPurchase(
  data: GemPurchaseInput,
  original: GemPurchaseTransactionError
): Promise<GemPurchaseOutcome> {
  const payment = await proveAppliedPurchase(data, data.plan)

  if (payment.state !== 'applied') throw original

  const commission = await readCommissionEvidenceState(data)
  if (commission.kind === 'unavailable') {
    throw new GemPurchaseTransactionError(
      'commission_evidence_unavailable',
      commission.error
    )
  }
  if (commission.kind === 'conflict') {
    return { status: 'conflict', reason: 'commission_conflict' }
  }
  if (commission.kind !== 'recorded') {
    console.error(
      '[db-queries] pago aplicado con comisión pendiente (resultado incierto):',
      data.telegram_charge_id
    )
  }
  return { status: 'duplicate' }
}

export async function applyGemPurchaseAtomic(
  data: GemPurchaseInput
): Promise<GemPurchaseOutcome> {
  const target = data.commission ?? null
  if (!target) return runGemPurchaseTransaction(data, null)

  let firstError: unknown
  try {
    return await runGemPurchaseTransaction(data, target)
  } catch (error) {
    firstError = error
  }

  // Incierto (commit / rollback / cierre): verificar, jamás reejecutar.
  if (firstError instanceof GemPurchaseTransactionError) {
    return settleUncertainPurchase(data, firstError)
  }
  if (!(firstError instanceof GemPurchaseStageError)) throw firstError

  // Comisión con rollback CONFIRMADO: un único reintento controlado.
  try {
    return await runGemPurchaseTransaction(data, target)
  } catch (retryError) {
    if (retryError instanceof GemPurchaseTransactionError) {
      return settleUncertainPurchase(data, retryError)
    }
    if (!(retryError instanceof GemPurchaseStageError)) throw retryError

    const commission = await readCommissionEvidenceState(data)

    if (commission.kind === 'unavailable') {
      throw new GemPurchaseTransactionError(
        'commission_evidence_unavailable',
        commission.error
      )
    }
    if (commission.kind === 'conflict') {
      return settleCommissionConflict(data, commission.reason)
    }
    if (commission.kind === 'recorded') {
      return settleUncertainPurchase(
        data,
        new GemPurchaseTransactionError('commission_already_recorded')
      )
    }

    console.error(
      '[db-queries] comisión no aplicada; compra con comisión pendiente:',
      data.telegram_charge_id,
      target.referrer_id,
      retryError.original
    )

    try {
      return await runGemPurchaseTransaction(
        data,
        target,
        'commission_transient_failure'
      )
    } catch (finalError) {
      if (finalError instanceof GemPurchaseTransactionError) {
        return settleUncertainPurchase(data, finalError)
      }
      throw finalError
    }
  }
}

async function runGemPurchaseTransaction(
  data: GemPurchaseInput,
  target: CommissionTarget | null,
  commissionNote?: 'commission_transient_failure'
): Promise<GemPurchaseOutcome> {
  const { plan } = data
  const tx = await db.transaction('write')
  let committed = false
  let rolledBack = false
  // Sentencia en curso: una violación UNIQUE solo es posible al insertar el
  // cargo o su movimiento contable, nunca al acreditar saldo.
  let stage: 'purchase' | 'credit' | 'ledger' | 'commission' | 'commit' = 'purchase'

  const rollback = async () => {
    await tx.rollback()
    rolledBack = true
  }

  try {
    // Decisión de comisión calculada DENTRO de esta transacción, con la base
    // validada del pago (nunca importes externos).
    let decision: CommissionDecision | null = null
    if (target) {
      const counts = await readCommissionCounts(tx, target.referrer_id, data.telegram_id)
      decision = {
        referrer_id: target.referrer_id,
        base_gems: target.base_gems,
        ...commissionFromCounts(counts.existing, counts.buyerAlready, target.base_gems),
      }
    }

    // La decisión (referidor, base y porcentaje) se persiste en la MISMA
    // transacción que confirma la compra.
    await tx.execute({
      sql: `INSERT INTO star_purchases
              (telegram_id, stars_amount, gems_amount, is_first_purchase,
               telegram_charge_id, payment_method, status, applied_at,
               commission_referrer_id, commission_base_gems, commission_pct)
            VALUES (?, ?, ?, ?, ?, ?, 'applied', ?, ?, ?, ?)`,
      args: [
        data.telegram_id,
        plan.stars_amount,
        plan.gems_amount,
        data.is_first_purchase ? 1 : 0,
        data.telegram_charge_id,
        plan.payment_method,
        nowISO(),
        decision ? decision.referrer_id : null,
        decision ? decision.base_gems : null,
        decision ? decision.commission_pct : null,
      ],
    })

    stage = 'credit'
    // Una sola sentencia: gemas de pago, gemas compradas y mensajes.
    const credited = await tx.execute({
      sql: `UPDATE users
            SET gems = COALESCE(gems, 0) + ?,
                purchased_gems = COALESCE(purchased_gems, 0) + ?,
                bonus_gems = COALESCE(bonus_gems, 0) + ?,
                hook_messages_remaining = 0,
                updated_at = ?
            WHERE telegram_id = ?
            RETURNING gems, purchased_gems, bonus_gems`,
      args: [
        plan.credit_gems,
        plan.credit_gems,
        plan.credit_messages,
        nowISO(),
        data.telegram_id,
      ],
    })

    if (credited.rows.length === 0) {
      await rollback()
      return { status: 'user_missing' }
    }

    stage = 'ledger'
    if (plan.ledger) {
      await tx.execute({
        sql: `INSERT INTO gem_transactions
                (telegram_id, amount, transaction_type, description, charge_id)
              VALUES (?, ?, ?, ?, ?)`,
        args: [
          data.telegram_id,
          plan.ledger.amount,
          plan.ledger.type,
          plan.ledger.description,
          data.telegram_charge_id,
        ],
      })
    }

    let commissionApplied = false
    if (decision && !commissionNote) {
      stage = 'commission'
      commissionApplied = (
        await applyCommissionInTransaction(tx, {
          referrer_id: decision.referrer_id,
          buyer_id: data.telegram_id,
          charge_id: data.telegram_charge_id,
          rail: plan.rail,
          decision,
        })
      ).applied
    }

    stage = 'commit'
    await tx.commit()
    committed = true

    const row = credited.rows[0] as any
    return {
      status: 'applied',
      gems: Number(row.gems ?? 0),
      purchased_gems: Number(row.purchased_gems ?? 0),
      bonus_gems: Number(row.bonus_gems ?? 0),
      commission_applied: commissionApplied,
      ...(commissionNote ? { commission_note: commissionNote } : {}),
    }
  } catch (error: any) {
    // Commit incierto: se clasifica de inmediato con el error ORIGINAL. El
    // resultado del rollback posterior no cambia la clasificación ni autoriza
    // reintentos.
    if (stage === 'commit') {
      try {
        await tx.rollback()
      } catch (rollbackError) {
        console.error(
          '[db-queries] rollback tras commit incierto falló (estado sigue incierto):',
          rollbackError
        )
      }
      throw new GemPurchaseTransactionError('gem_purchase_commit_uncertain', error)
    }

    // Errores previos al commit: primero se revierte de verdad. Sin rollback
    // confirmado no se emite GemPurchaseStageError ni se autoriza reintento.
    if (!committed && !rolledBack) {
      try {
        await rollback()
      } catch (rollbackError) {
        console.error(
          '[db-queries] rollback falló tras fallo previo al commit:',
          rollbackError
        )
        throw new GemPurchaseTransactionError(
          'gem_purchase_rollback_failed',
          rollbackError
        )
      }
    }

    // Solo con rollback confirmado la etapa de comisión es reintentable.
    if (stage === 'commission') {
      throw new GemPurchaseStageError('commission', error)
    }

    // Solo una violación UNIQUE real, y solo en las sentencias que pueden
    // provocarla, habilita la investigación de duplicado.
    if ((stage === 'purchase' || stage === 'ledger') && isUniqueViolation(error)) {
      const evidence = await proveAppliedPurchase(data, plan)
      if (evidence.state === 'applied') return { status: 'duplicate' }
      return { status: 'conflict', reason: evidence.reason }
    }

    throw error
  } finally {
    // finally NUNCA lanza: no puede ocultar el error principal.
    try {
      // API real de libSQL: close() es síncrono, idempotente y revierte si la
      // transacción no llegó a confirmarse.
      tx.close()
    } catch (closeError) {
      if (!committed && !rolledBack) {
        console.error(
          '[db-queries] CRÍTICO: close() falló con transacción en estado incierto:',
          closeError
        )
      } else {
        console.error(
          '[db-queries] Error cerrando transacción ya confirmada:',
          closeError
        )
      }
    }
  }
}

// Conciliación de una comisión pendiente. Usa EXCLUSIVAMENTE la decisión
// persistida (referidor original, base y porcentaje) y nunca recalcula tramos.
export async function reconcileCommissionByCharge(
  buyerTid: string,
  chargeId: string
): Promise<
  | { status: 'applied'; commission_gems: number }
  | { status: 'already_applied' }
  | { status: 'referrer_missing' }
  | { status: 'not_applied_purchase' }
  | {
      status: 'review_required'
      reason:
        | 'decision_missing'
        | 'commission_mismatch'
        | 'ledger_missing'
        | 'ledger_mismatch'
        | 'ledger_orphan'
        | 'commission_absent'
    }
> {
  const purchase = await queryOne<{
    status: string
    payment_method: string
    commission_referrer_id: string | null
    commission_base_gems: number | null
    commission_pct: number | null
  }>(
    `SELECT status, payment_method, commission_referrer_id,
            commission_base_gems, commission_pct
       FROM star_purchases
      WHERE telegram_charge_id = ? AND telegram_id = ?
      LIMIT 1`,
    [chargeId, buyerTid]
  )

  if (!purchase || String(purchase.status) !== 'applied') {
    return { status: 'not_applied_purchase' }
  }

  if (
    purchase.commission_referrer_id == null ||
    purchase.commission_base_gems == null ||
    purchase.commission_pct == null
  ) {
    return { status: 'review_required', reason: 'decision_missing' }
  }

  const referrerId = String(purchase.commission_referrer_id)
  const base = Number(purchase.commission_base_gems)
  const pct = Number(purchase.commission_pct)
  const commissionGems = Math.floor((base * pct) / 100)
  const rail: 'stars' | 'crypto' = String(purchase.payment_method).startsWith('crypto')
    ? 'crypto'
    : 'stars'

  const expected = {
    buyer_id: buyerTid,
    charge_id: chargeId,
    referrer_id: referrerId,
    rail,
    purchase_gems: base,
    commission_gems: commissionGems,
    commission_pct: pct,
  }

  const tx = await db.transaction('write')
  let committed = false
  // idle = no iniciado, confirmed = aplicado, failed = falló.
  const rollbackState = { value: 'idle' as 'idle' | 'confirmed' | 'failed' }
  let stage: 'evidence' | 'credit' | 'commit' = 'evidence'

  const rollback = async () => {
    if (rollbackState.value !== 'idle') return
    try {
      await tx.rollback()
      rollbackState.value = 'confirmed'
    } catch (error) {
      rollbackState.value = 'failed'
      throw error
    }
  }

  try {
    const counts = await readCommissionCounts(tx, referrerId, buyerTid)
    const evidence = await commissionEvidence(tx, expected)

    if (evidence.state === 'recorded') {
      await rollback()
      return { status: 'already_applied' }
    }
    if (evidence.state === 'conflict') {
      await rollback()
      return { status: 'review_required', reason: evidence.reason }
    }

    stage = 'credit'
    const result = await applyCommissionInTransaction(tx, {
      referrer_id: referrerId,
      buyer_id: buyerTid,
      charge_id: chargeId,
      rail,
      decision: {
        referrer_id: referrerId,
        base_gems: base,
        commission_pct: pct,
        commission_gems: commissionGems,
        total_unique: counts.existing + (counts.buyerAlready ? 0 : 1),
      },
    })

    // Referidor inexistente: no se confirma una transacción sin efecto.
    if (!result.applied) {
      await rollback()
      return { status: 'referrer_missing' }
    }

    stage = 'commit'
    await tx.commit()
    committed = true

    return { status: 'applied', commission_gems: commissionGems }
  } catch (error) {
    // Commit incierto: clasificación inmediata con el error ORIGINAL.
    // El rollback posterior es best-effort y no la modifica.
    if (stage === 'commit') {
      if (rollbackState.value === 'idle') {
        try {
          await rollback()
        } catch (rollbackError) {
          console.error(
            '[db-queries] reconcile: rollback best-effort tras commit incierto falló:',
            rollbackError
          )
        }
      }
      throw new GemPurchaseTransactionError('gem_purchase_commit_uncertain', error)
    }

    // Fallo previo al commit: un único intento. Si falla, se propaga sin
    // segundo intento y sin investigar duplicados.
    if (!committed && rollbackState.value === 'idle') {
      try {
        await rollback()
      } catch (rollbackError) {
        console.error('[db-queries] reconcile: rollback falló:', rollbackError)
        throw new GemPurchaseTransactionError(
          'gem_purchase_rollback_failed',
          rollbackError
        )
      }
    }

    if (rollbackState.value !== 'confirmed') {
      throw new GemPurchaseTransactionError('gem_purchase_rollback_failed', error)
    }

    // Solo con rollback confirmado y sin commit incierto se investiga duplicidad.
    if (!isCommissionGateError(error)) throw error

    const verify = await db.transaction('read')
    try {
      const evidence = await commissionEvidence(verify, expected)
      if (evidence.state === 'recorded') return { status: 'already_applied' }
      return {
        status: 'review_required',
        reason: evidence.state === 'absent' ? 'commission_absent' : evidence.reason,
      }
    } finally {
      // close() de la verificación tampoco puede ocultar el resultado.
      try {
        verify.close()
      } catch (closeError) {
        console.error(
          '[db-queries] reconcile: error cerrando verificación:',
          closeError
        )
      }
    }
  } finally {
    // finally nunca lanza: no oculta el error principal.
    try {
      tx.close()
    } catch (closeError) {
      if (!committed && rollbackState.value !== 'confirmed') {
        console.error(
          '[db-queries] CRÍTICO: reconcile close() con transacción en estado incierto:',
          closeError
        )
      } else {
        console.error(
          '[db-queries] reconcile: error cerrando transacción confirmada:',
          closeError
        )
      }
    }
  }
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
  model: 'r2' | 'pool' | 'wiro' // ✅ RUNWARE ELIMINADO
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
