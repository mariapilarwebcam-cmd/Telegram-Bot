-- Gem / pass purchase records: additive schema only.
-- Does NOT touch existing rows, prices, packages or promotions.
-- Does NOT credit anything: it only adds the state needed to prove that a
-- charge was applied, so idempotency stops depending on text matching.
--
-- ONE-SHOT: SQLite has no "ADD COLUMN IF NOT EXISTS". Run exactly once and
-- verify afterwards with the queries at the bottom. Re-running fails with
-- "duplicate column name" and changes nothing.
--
-- DEPLOYMENT ORDER (never apply this after deploying the new writer):
--   1. Read-only pre-flight (must match README.md exactly, i.e. no
--      status / applied_at / charge_id columns yet):
--        PRAGMA table_info(star_purchases)
--        PRAGMA table_info(gem_transactions)
--   2. Pause the bot process that still writes purchases directly
--      (old api/bot/telegrabot.py::record_star_purchase).
--   3. Apply this migration. The old writer keeps working (status falls back
--      to 'review_required', charge_id falls back to NULL), so no payment is
--      lost, but any purchase it processes is labelled as unproven.
--   4. Deploy the new code in this order: TypeScript processor
--      (app/api/bot/gem-payments) -> bot (calls the processor, no direct SQL).
--      The new writer is the only one that can set status = 'applied'.
--   5. Gate: if any row is created AFTER the migration with
--      status = 'review_required', an old writer is still running.
--        SELECT COUNT(*) FROM star_purchases
--         WHERE status = 'review_required' AND created_at >= <migration time>
--      Expected value after the rollout: 0.

-- 1. star_purchases: explicit application state.
--    Existing rows receive 'review_required' (they cannot be proven applied)
--    and are never auto-credited nor reported as confirmed duplicates.
ALTER TABLE star_purchases ADD COLUMN status TEXT NOT NULL DEFAULT 'review_required'
    CHECK (status IN ('applied', 'review_required'));

ALTER TABLE star_purchases ADD COLUMN applied_at TEXT;

CREATE INDEX IF NOT EXISTS star_purchases_status
    ON star_purchases (status, created_at);

-- 2. gem_transactions: exact link between a charge and its ledger movement.
--    Legacy rows keep charge_id NULL (NULLs do not collide in SQLite).
ALTER TABLE gem_transactions ADD COLUMN charge_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS gem_transactions_charge
    ON gem_transactions (charge_id);

-- Verification (read-only, no trailing semicolons on purpose):
--   SELECT name FROM sqlite_master WHERE type = 'index'
--     AND name IN ('star_purchases_status', 'gem_transactions_charge')
--   SELECT status, COUNT(*) FROM star_purchases GROUP BY status
--   SELECT COUNT(*) FROM gem_transactions WHERE charge_id IS NOT NULL
