-- Commission decision persistence: additive schema only.
-- Stores the commission decision (base and percentage) computed INSIDE the same
-- write transaction that confirms the purchase, so a pending commission can be
-- recovered later with the ORIGINAL tier instead of a recomputed one.
--
-- Does NOT modify existing rows, prices, percentages, tiers or balances.
-- Rows created before this migration stay NULL: they are never auto-credited
-- and require explicit review (historical commission, H-5).
--
-- ONE-SHOT: SQLite has no "ADD COLUMN IF NOT EXISTS". Run exactly once and
-- verify with the queries at the bottom. Re-running fails with
-- "duplicate column name" and changes nothing.
--
-- Pre-check (read-only), must match README.md plus migration 002:
--   PRAGMA table_info(star_purchases)
--   Expected columns: ..., status, applied_at  (no commission_* yet)

ALTER TABLE star_purchases ADD COLUMN commission_base_gems INTEGER
    CHECK (
        commission_base_gems IS NULL
        OR (typeof(commission_base_gems) = 'integer' AND commission_base_gems >= 0)
    );

ALTER TABLE star_purchases ADD COLUMN commission_pct INTEGER
    CHECK (
        commission_pct IS NULL
        OR (typeof(commission_pct) = 'integer' AND commission_pct >= 0 AND commission_pct <= 100)
    );

-- Pending commissions: decision persisted, purchase applied, row still absent.
-- Recovery reads both columns from here; it never recomputes the tier.
--   SELECT telegram_id, telegram_charge_id, commission_base_gems, commission_pct
--     FROM star_purchases
--    WHERE status = 'applied'
--      AND commission_pct IS NOT NULL
--      AND NOT EXISTS (
--            SELECT 1 FROM referral_commissions c
--             WHERE c.referred_id = star_purchases.telegram_id
--               AND c.reference = star_purchases.telegram_charge_id)

-- Verification (read-only, no trailing semicolons on purpose):
--   PRAGMA table_info(star_purchases)
--   SELECT COUNT(*) FROM star_purchases WHERE commission_pct IS NOT NULL
