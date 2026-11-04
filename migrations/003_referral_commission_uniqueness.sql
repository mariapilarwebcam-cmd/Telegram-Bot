-- Referral commission uniqueness: additive schema only.
-- Does NOT modify existing rows, percentages, tiers, prices or balances.
--
-- WHAT THIS MIGRATION GUARANTEES
--   * NEW rows cannot duplicate (referred_id, reference).
--   * NEW updates that would create such a duplicate are rejected.
--   * It applies even when historical duplicates already exist, because a
--     trigger (unlike CREATE UNIQUE INDEX) does not validate existing rows.
--
-- WHAT IT DOES NOT DO (explicit contradiction-free scope)
--   * It does not detect, repair or delete historical duplicates. Those stay
--     as debt until reviewed (H-5). The pre-check below only measures them.
--   * It is not equivalent to a UNIQUE index on the whole table. The index is
--     the end state and can only be created after the pre-check returns 0.
--
-- CONCURRENCY
--   libSQL/SQLite serialises write transactions, so the trigger check and the
--   write happen under the same write lock: two concurrent inserts for the same
--   (referred_id, reference) cannot both succeed.
--
-- ASSUMPTION
--   referral_commissions is a rowid table (its DDL is not versioned in this
--   repository). The UPDATE trigger uses rowid to avoid depending on a column
--   name that is not documented.
--
-- Pre-check (read-only) before applying. Expected 0 rows; any row is debt:
--   SELECT referred_id, reference, COUNT(*) AS n
--     FROM referral_commissions
--    WHERE reference IS NOT NULL AND trim(reference) <> ''
--    GROUP BY referred_id, reference
--   HAVING COUNT(*) > 1

CREATE TRIGGER IF NOT EXISTS referral_commissions_unique_reference_insert
BEFORE INSERT ON referral_commissions
FOR EACH ROW
WHEN NEW.reference IS NOT NULL AND trim(NEW.reference) <> ''
BEGIN
    SELECT RAISE(ABORT, 'duplicate_referral_commission')
    WHERE EXISTS (
        SELECT 1 FROM referral_commissions
         WHERE referred_id = NEW.referred_id
           AND reference = NEW.reference
    );
END;

CREATE TRIGGER IF NOT EXISTS referral_commissions_unique_reference_update
BEFORE UPDATE OF referred_id, reference ON referral_commissions
FOR EACH ROW
WHEN NEW.reference IS NOT NULL AND trim(NEW.reference) <> ''
BEGIN
    SELECT RAISE(ABORT, 'duplicate_referral_commission')
    WHERE EXISTS (
        SELECT 1 FROM referral_commissions
         WHERE referred_id = NEW.referred_id
           AND reference = NEW.reference
           AND rowid <> OLD.rowid
    );
END;

-- End state after the pre-check returns 0 rows and the historical debt has been
-- reviewed. Strongest guarantee, cannot coexist with duplicates:
-- CREATE UNIQUE INDEX IF NOT EXISTS referral_commissions_charge
--     ON referral_commissions (referred_id, reference)
--     WHERE reference IS NOT NULL AND trim(reference) <> '';

-- Verification (read-only):
--   SELECT name, type FROM sqlite_master
--    WHERE name LIKE 'referral_commissions_unique_reference%'
