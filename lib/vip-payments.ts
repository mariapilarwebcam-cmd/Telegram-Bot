// Server-only economic core. No credentials, provider calls or HTTP handlers.
// Crypto evidence must come from a trusted server-side verifier, never a body.
import type { Client, Transaction } from '@libsql/client'

type Plan = 'weekly' | 'monthly' | 'quarterly' | 'annual'
type Method = 'stars' | 'crypto'
type Row = Record<string, unknown>

export type VipPaymentInput =
  | { method: 'stars'; inboxId: number }
  | {
      method: 'crypto'
      reference: string
      telegramId: string
      plan: Plan
      currency: 'USDT'
      paidAmountUnits: number
      paymentScope: string
      providerPaymentId: string
    }

export type VipPaymentResult =
  | {
      status: 'applied' | 'already_applied'
      reference: string
      subscriptionId: number
      plan: Plan
      expiresAt: string
      days: number
    }
  | { status: 'review_required'; reason: string }

export class VipPaymentError extends Error {
  readonly code: string
  readonly originalError: unknown
  readonly cleanupErrors: unknown[]

  constructor(code: string, originalError?: unknown, cleanupErrors: unknown[] = []) {
    super(code)
    this.name = 'VipPaymentError'
    this.code = code
    this.originalError = originalError
    this.cleanupErrors = cleanupErrors
  }
}

interface Evidence {
  method: Method
  reference: string
  telegramId: string
  plan?: Plan
  currency: string
  amount: number
  scope: string
  paymentId: string
}

const DAYS: Record<Plan, number> = { weekly: 7, monthly: 30, quarterly: 90, annual: 365 }
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0
const planIsValid = (v: unknown): v is Plan =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(DAYS, v)

function dateMillis(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    throw new VipPaymentError('invalid_subscription_date')
  }
  const ms = Date.parse(value.replace(' ', 'T') + 'Z')
  if (!Number.isFinite(ms) || sqliteDate(ms) !== value) {
    throw new VipPaymentError('invalid_subscription_date')
  }
  return ms
}

function sqliteDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

async function select(tx: Transaction, sql: string, args: Array<string | number> = []): Promise<Row[]> {
  return (await tx.execute({ sql, args })).rows as unknown as Row[]
}

function samePayment(row: Row, e: Evidence): boolean {
  return row.reference === e.reference && row.telegram_id === e.telegramId &&
    row.payment_method === e.method && row.payment_scope === e.scope &&
    row.provider_payment_id === e.paymentId && row.currency === e.currency &&
    row.paid_amount_units === e.amount
}

async function work(tx: Transaction, input: VipPaymentInput): Promise<VipPaymentResult> {
  // Must be read on this transaction's stream; a separate client PRAGMA is insufficient.
  const fk = await select(tx, 'PRAGMA foreign_keys')
  if (fk.length !== 1 || fk[0].foreign_keys !== 1) {
    throw new VipPaymentError('foreign_keys_disabled')
  }

  let inbox: Row | undefined
  let e: Evidence
  if (input.method === 'stars') {
    if (!positive(input.inboxId)) throw new VipPaymentError('invalid_input')
    inbox = (await select(tx, 'SELECT * FROM vip_payment_inbox WHERE id = ?', [input.inboxId]))[0]
    if (!inbox) throw new VipPaymentError('inbox_not_found')
    if (inbox.status === 'review_required') {
      return { status: 'review_required', reason: 'inbox_requires_review' }
    }
    if (inbox.status !== 'pending' && inbox.status !== 'applied') {
      throw new VipPaymentError('invalid_inbox_state')
    }
    e = {
      method: 'stars', reference: inbox.invoice_reference as string,
      telegramId: inbox.telegram_id as string, currency: inbox.currency as string,
      amount: inbox.paid_amount_units as number, scope: inbox.bot_id as string,
      paymentId: inbox.telegram_charge_id as string,
    }
    if (inbox.payment_method !== 'stars') throw new VipPaymentError('invalid_inbox_state')
  } else {
    e = {
      method: 'crypto', reference: input.reference, telegramId: input.telegramId,
      plan: input.plan, currency: input.currency, amount: input.paidAmountUnits,
      scope: input.paymentScope, paymentId: input.providerPaymentId,
    }
  }
  if (![e.reference, e.telegramId, e.scope, e.paymentId, e.currency].every(text) || !positive(e.amount)) {
    throw new VipPaymentError('invalid_input')
  }

  async function review(reason: string): Promise<VipPaymentResult> {
    if (inbox?.status === 'applied') throw new VipPaymentError('inconsistent_applied_event')
    if (inbox) {
      const result = await tx.execute({
        sql: `UPDATE vip_payment_inbox
              SET status = 'review_required', last_error_code = ?, updated_at = datetime('now')
              WHERE id = ? AND status = 'pending'`,
        args: [reason, input.method === 'stars' ? input.inboxId : 0],
      })
      if (result.rowsAffected !== 1) throw new VipPaymentError('inbox_update_conflict')
    }
    return { status: 'review_required', reason }
  }

  const invoice = (await select(tx, 'SELECT * FROM vip_invoices WHERE reference = ?', [e.reference]))[0]
  if (!invoice) return review('invoice_not_found')
  if (!planIsValid(invoice.plan) || invoice.days !== DAYS[invoice.plan] ||
      !positive(invoice.expected_amount_units)) return review('invalid_invoice')
  const days = DAYS[invoice.plan]
  if (invoice.telegram_id !== e.telegramId) return review('identity_mismatch')
  if (invoice.payment_method !== e.method) return review('method_mismatch')
  if (invoice.currency !== e.currency || e.currency !== (e.method === 'stars' ? 'XTR' : 'USDT')) {
    return review('currency_mismatch')
  }
  if (e.method === 'crypto' && e.plan !== invoice.plan) return review('plan_mismatch')
  const parts = e.reference.split('_')
  const referenceMatches = e.method === 'stars'
    ? parts.length >= 5 && parts[0] === 'vip' && parts[1] === 'sub' &&
      parts[2] === invoice.plan && parts[3] === e.telegramId
    : parts.length >= 4 && parts[0] === 'VIP' && parts[1] === invoice.plan && parts[2] === e.telegramId
  if (!referenceMatches) return review('reference_mismatch')
  if (e.method === 'stars'
    ? e.amount !== invoice.expected_amount_units
    : e.amount < invoice.expected_amount_units - 1000) return review('amount_mismatch')

  const existing = await select(tx,
    `SELECT * FROM vip_processed_payments
     WHERE reference = ? OR
       (payment_method = ? AND payment_scope = ? AND provider_payment_id = ?)`,
    [e.reference, e.method, e.scope, e.paymentId])
  if (existing.length > 0 && (existing.length !== 1 || !samePayment(existing[0], e))) {
    return review('payment_identity_conflict')
  }

  async function markApplied(): Promise<void> {
    if (!inbox) return
    const result = await tx.execute({
      sql: `UPDATE vip_payment_inbox
            SET status = 'applied', processed_reference = ?, applied_at = datetime('now'),
                updated_at = datetime('now'), last_error_code = NULL, next_attempt_at = NULL
            WHERE id = ? AND status = 'pending'`,
      args: [e.reference, input.method === 'stars' ? input.inboxId : 0],
    })
    if (result.rowsAffected !== 1) throw new VipPaymentError('inbox_update_conflict')
  }

  if (existing.length === 1) {
    const previous = existing[0]
    if (previous.plan !== invoice.plan || previous.days_credited !== invoice.days ||
        !positive(previous.subscription_id)) throw new VipPaymentError('inconsistent_processed_payment')
    dateMillis(previous.resulting_expires_at)
    if (inbox?.status === 'applied') {
      if (inbox.processed_reference !== e.reference || !text(inbox.applied_at)) {
        throw new VipPaymentError('inconsistent_applied_event')
      }
    } else await markApplied()
    return {
      status: 'already_applied', reference: e.reference,
      subscriptionId: previous.subscription_id as number, plan: invoice.plan,
      expiresAt: previous.resulting_expires_at as string, days: invoice.days as number,
    }
  }
  if (inbox?.status === 'applied') throw new VipPaymentError('inconsistent_applied_event')

  const clock = await select(tx, "SELECT datetime('now') AS now")
  const now = dateMillis(clock[0]?.now)
  const current = (await select(tx,
    `SELECT * FROM subscriptions WHERE telegram_id = ? AND status = 'active'
     AND expires_at > ? ORDER BY expires_at DESC LIMIT 1`,
    [e.telegramId, sqliteDate(now)]))[0]
  const expiresAt = sqliteDate(Math.max(now, current ? dateMillis(current.expires_at) : now) +
    days * 86400000)
  // Preserve existing Stars renewal semantics: do not rewrite plan/stars_paid.
  const charge = e.method === 'stars' ? e.paymentId : e.reference
  let subscription: Row | undefined
  if (current) {
    const sql = e.method === 'stars'
      ? `UPDATE subscriptions SET expires_at = ?, telegram_charge_id = ?
         WHERE id = ? RETURNING id`
      : `UPDATE subscriptions SET expires_at = ?, telegram_charge_id = ?, plan = ?,
         stars_paid = 0, status = 'active' WHERE id = ? RETURNING id`
    subscription = (await select(tx, sql, e.method === 'stars'
      ? [expiresAt, charge, current.id as number]
      : [expiresAt, charge, invoice.plan, current.id as number]))[0]
  } else {
    subscription = (await select(tx,
      `INSERT INTO subscriptions
       (telegram_id, plan, stars_paid, telegram_charge_id, expires_at, status)
       VALUES (?, ?, ?, ?, ?, 'active') RETURNING id`,
      [e.telegramId, invoice.plan, e.method === 'stars' ? e.amount : 0, charge, expiresAt]))[0]
  }
  if (!positive(subscription?.id)) throw new VipPaymentError('subscription_write_failed')
  await tx.execute({
    sql: `INSERT INTO vip_processed_payments
      (reference, payment_method, payment_scope, provider_payment_id, telegram_id,
       plan, days_credited, paid_amount_units, currency, subscription_id,
       previous_expires_at, resulting_expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [e.reference, e.method, e.scope, e.paymentId, e.telegramId, invoice.plan,
      days, e.amount, e.currency, subscription.id,
      current ? current.expires_at as string : null, expiresAt],
  })
  await markApplied()
  return {
    status: 'applied', reference: e.reference, subscriptionId: subscription.id,
    plan: invoice.plan, expiresAt, days,
  }
}

function retryable(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code
  return typeof code === 'string' && /^(SQLITE_BUSY|SQLITE_LOCKED)(?:_[A-Z0-9_]+)?$/.test(code)
}

/** A commit rejection is ALWAYS uncertain. Retry the same payment, never a new ID.
 * The function does not retry uncertain commits or contact payment providers.
 */
export async function applyVipPayment(
  client: Pick<Client, 'transaction'>,
  input: VipPaymentInput
): Promise<VipPaymentResult> {
  if (!input || (input.method !== 'stars' && input.method !== 'crypto')) {
    throw new VipPaymentError('invalid_input')
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    let tx: Transaction | undefined
    let committing = false
    let result: VipPaymentResult | undefined
    let failure: unknown
    let failed = false
    const cleanupErrors: unknown[] = []
    try {
      tx = await client.transaction('write')
      result = await work(tx, input)
      committing = true
      await tx.commit()
    } catch (error) {
      failed = true
      failure = error
      if (tx) {
        try { if (!tx.closed) await tx.rollback() } catch (cleanup) { cleanupErrors.push(cleanup) }
      }
    } finally {
      if (tx) {
        try { tx.close() } catch (cleanup) { cleanupErrors.push(cleanup) }
      }
    }
    if (!failed) {
      if (cleanupErrors.length) throw new VipPaymentError('committed_cleanup_failed', undefined, cleanupErrors)
      return result!
    }
    if (committing) throw new VipPaymentError('commit_uncertain', failure, cleanupErrors)
    if (cleanupErrors.length) throw new VipPaymentError('rollback_failed', failure, cleanupErrors)
    if (!retryable(failure) || attempt === 2) throw failure
    await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)))
  }
  throw new VipPaymentError('retry_exhausted')
}