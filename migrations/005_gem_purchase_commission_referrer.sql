-- Original commission referrer: additive schema only.
-- The commission of a purchase must credit the referrer who generated it, not
-- the current users.referred_by (which the application can update: see
-- api/bot/telegrabot.py rebinding referred_by / pending_referral_code).
--
-- Does NOT modify existing rows, prices, percentages, tiers or balances.
-- Rows created before this migration keep NULL: never auto-credited, they
-- require explicit review (historical commission).
--
-- ONE-SHOT: SQLite has no "ADD COLUMN IF NOT EXISTS". Run exactly once and
-- verify with the query at the bottom. Re-running fails with
-- "duplicate column name" and changes nothing.
--
-- Pre-check (read-only), must match README.md + migrations 002 and 004:
--   PRAGMA table_info(star_purchases)
--   Expected: ..., status, applied_at, commission_base_gems, commission_pct
--   (no commission_referrer_id yet)

ALTER TABLE star_purchases ADD COLUMN commission_referrer_id TEXT
    CHECK (
        commission_referrer_id IS NULL
        OR length(trim(commission_referrer_id)) > 0
    );

-- Reconciliation uses this column and never users.referred_by.
--   SELECT telegram_id, telegram_charge_id, commission_referrer_id,
--          commission_base_gems, commission_pct
--     FROM star_purchases
--    WHERE status = 'applied' AND commission_referrer_id IS NOT NULL

-- Verification (read-only, no trailing semicolons on purpose):
--   PRAGMA table_info(star_purchases)
--   SELECT COUNT(*) FROM star_purchases WHERE commission_referrer_id IS NOT NULL
