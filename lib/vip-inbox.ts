import type { Client } from '@libsql/client'
import { timingSafeEqual } from 'crypto'
import { applyVipPayment } from './vip-payments'

export function authorizedVipWorker(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const received = Buffer.from(header)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

const PERMANENT = new Set([
  'invalid_input', 'invalid_inbox_state', 'inconsistent_applied_event',
  'inconsistent_processed_payment', 'invalid_subscription_date',
])

/** Lease controls contention, never credit. Core ledger remains authoritative.
 * Written dates use SQLite UTC YYYY-MM-DD HH:MM:SS. */
export async function processVipInbox(db: Client, botId: string, inboxId?: number, budgetMs = 40000) {
  const deadline = Date.now() + budgetMs
  const counts = { applied: 0, already_applied: 0, review_required: 0, retry: 0 }
  let cursor = 0
  do {
    const pending = await db.execute({
      sql: `SELECT id FROM vip_payment_inbox WHERE status = 'pending' AND bot_id = ? AND id > ?
            AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))
            ${inboxId === undefined ? '' : 'AND id = ?'} ORDER BY id LIMIT 25`,
      args: inboxId === undefined ? [botId, cursor] : [botId, cursor, inboxId],
    })
    if (!pending.rows.length) break
    for (const row of pending.rows) {
      if (Date.now() >= deadline) return counts
      const id = Number(row.id)
      cursor = id
      const claimed = await db.execute({
        sql: `UPDATE vip_payment_inbox SET attempt_count = attempt_count + 1,
              next_attempt_at = datetime('now', '+5 minutes'), updated_at = datetime('now')
              WHERE id = ? AND status = 'pending' AND bot_id = ?
              AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))
              RETURNING attempt_count`, args: [id, botId],
      })
      if (!claimed.rows.length) continue
      try {
        const result = await applyVipPayment(db, { method: 'stars', inboxId: id })
        counts[result.status]++
      } catch (error) {
        const code = (error as { code?: string })?.code || ''
        const permanent = PERMANENT.has(code)
        const attempt = Number(claimed.rows[0].attempt_count)
        const delay = Math.min(3600, 30 * 2 ** Math.min(attempt, 7))
        // Unknown SQL / concurrency / uncertain-commit failures stay retryable.
        // Never overwrite an applied row after a lost commit response.
        await db.execute({
          sql: `UPDATE vip_payment_inbox SET status = ?, last_error_code = ?,
                next_attempt_at = CASE WHEN ? = 1 THEN NULL ELSE datetime('now', ?) END,
                updated_at = datetime('now') WHERE id = ? AND status = 'pending'
                AND attempt_count = ?`,
          args: [permanent ? 'review_required' : 'pending', permanent ? code : 'processing_failed',
            permanent ? 1 : 0, `+${delay} seconds`, id, attempt],
        })
        counts[permanent ? 'review_required' : 'retry']++
      }
    }
  } while (inboxId === undefined && Date.now() < deadline)
  return counts
}