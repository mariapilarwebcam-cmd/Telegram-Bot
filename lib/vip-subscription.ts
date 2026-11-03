import type { Client } from '@libsql/client'
import { applyVipPayment } from './vip-payments'
import { verifyTonVipPayment, type TonVipInvoice } from './ton-vip-verifier'
import { discoverVipTrace } from './vip-ton-discovery'

export async function findCreditedVip(db: Client, reference: string, tid: string) {
  return (await db.execute({
    sql: `SELECT plan, resulting_expires_at AS expires_at, 'active' AS status
          FROM vip_processed_payments WHERE reference = ? AND telegram_id = ?`,
    args: [reference, tid],
  })).rows[0]
}

export async function confirmVipCrypto(db: Client, tid: string, body: any, recipient: string) {
  const reference = String(body.reference || '')
  const invoice = (await db.execute({
    sql: "SELECT * FROM vip_invoices WHERE reference = ? AND telegram_id = ? AND payment_method = 'crypto'",
    args: [reference, tid],
  })).rows[0]
  if (!invoice || invoice.plan !== body.plan) return { status: 'review_required', reason: 'invoice_mismatch' }
  const existing = await findCreditedVip(db, reference, tid)
  if (existing) return { status: 'paid', already: true, subscription: existing }
  if (!recipient) throw new Error('recipient_not_configured')
  let traceId: string | undefined
  let cursor: unknown = body.discovery_cursor ?? null
  // Direct hints permit historical recovery but never authorize a payment.
  if (typeof body.trace_id === 'string' && /^[a-fA-F0-9]{64}$/.test(body.trace_id)) traceId = body.trace_id
  else {
    const found = await discoverVipTrace(fetch, recipient, reference, process.env.TONAPI_KEY, cursor)
    traceId = found.traceId
    cursor = found.cursor
  }
  if (traceId) {
    const result = await verifyTonVipPayment({
      fetch, recipient, apiKey: process.env.TONAPI_KEY,
      isPaymentProcessed: async (scope, id) => (await db.execute({
        sql: `SELECT 1 FROM vip_processed_payments WHERE payment_method = 'crypto'
              AND payment_scope = ? AND provider_payment_id = ? AND reference <> ?`,
        args: [scope, id, reference],
      })).rows.length > 0,
    }, {
      reference, telegramId: tid, plan: invoice.plan as TonVipInvoice['plan'],
      expectedAmountUnits: Number(invoice.expected_amount_units),
    }, traceId)
    if (result.status === 'verified') {
      const applied = await applyVipPayment(db, result.evidence)
      if (applied.status === 'review_required') return applied
      return { status: 'paid', subscription: {
        plan: applied.plan, expires_at: applied.expiresAt, days: applied.days,
      } }
    }
  }
  const concurrent = await findCreditedVip(db, reference, tid)
  return concurrent ? { status: 'paid', subscription: concurrent }
    : { status: 'pending', discovery_cursor: cursor }
}