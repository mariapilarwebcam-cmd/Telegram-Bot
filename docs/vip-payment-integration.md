# Local VIP integration

No remote migration or deployment is performed by this change.

Required deployment prerequisites (separate authorization):

- Apply/verify `migrations/001_vip_payment_records.sql` before enabling this code.
- Set `VIP_PROCESSOR_URL` to the explicit HTTPS URL ending in
  `/api/bot/vip-payments`, without credentials, query or fragment.
- Set `VIP_PROCESSOR_SECRET` identically for Python and TypeScript. It is sent
  only in Authorization; redirects are disabled. Set `CRON_SECRET` for recovery.
- Set the server-only `TON_RECIPIENT_WALLET`, `TELEGRAM_BOT_TOKEN` and the existing
  webhook secret. Keep the frontend wallet configuration consistent.
- The core checks foreign keys on the actual transaction stream and fails closed
  if disabled. A separate client PRAGMA is not proof of stream configuration.

Stars receipts are durable before ACK. Immediate processing is best effort;
missing config, non-200 HTTP or network failures leave recovery to the daily cron.
The cron drains 25-row batches within a 40-second admission budget, with a
five-minute claim lease and capped retry backoff. The budget cannot interrupt an
already running database operation. Excess backlog remains for a later run.
Core validation mismatches become `review_required`. Unknown SQL errors and
uncertain commits remain retryable under the same identity. Review rows require
operator investigation; no automatic refunds or fabricated invoices are added.

Crypto discovery is paginated across polling calls using `discovery_cursor`.
`confirm_crypto` also accepts optional `trace_id` (64 hex characters) to recover
historical transfers directly. These are untrusted discovery hints; only the
existing raw TON verifier can produce credit evidence. Persisted invoice pricing,
not client amounts or current catalog pricing, is used. TonAPI remains the trust
boundary documented in the verifier; this is not independent light-client proof.

Legacy payable references created before invoice persistence are not backfilled
from client data. Their receipts require review. Existing subscriptions remain
readable. Receipt registration and unrelated active VIP are never payment proof.