-- VIP payment records: additive schema only.
-- No existing tables or records are modified.
--
-- The caller must enable and verify PRAGMA foreign_keys = ON
-- before starting a transaction.
--
-- Reapplication creates missing objects but does not repair an
-- incompatible pre-existing schema. Verify the resulting schema.
--
-- Application code must write processed payments and subscription
-- changes in the same transaction. This migration does not credit VIP.

CREATE TABLE IF NOT EXISTS vip_invoices (
    reference TEXT PRIMARY KEY NOT NULL
        CHECK (length(trim(reference)) > 0),

    telegram_id TEXT NOT NULL
        CHECK (length(trim(telegram_id)) > 0),

    payment_method TEXT NOT NULL
        CHECK (payment_method IN ('crypto', 'stars')),

    plan TEXT NOT NULL
        CHECK (plan IN ('weekly', 'monthly', 'quarterly', 'annual')),

    days INTEGER NOT NULL
        CHECK (typeof(days) = 'integer')
        CHECK (
            (plan = 'weekly' AND days = 7)
            OR (plan = 'monthly' AND days = 30)
            OR (plan = 'quarterly' AND days = 90)
            OR (plan = 'annual' AND days = 365)
        ),

    expected_amount_units INTEGER NOT NULL
        CHECK (
            typeof(expected_amount_units) = 'integer'
            AND expected_amount_units > 0
            AND expected_amount_units <= 9007199254740991
        ),

    currency TEXT NOT NULL
        CHECK (
            (payment_method = 'crypto' AND currency = 'USDT')
            OR (payment_method = 'stars' AND currency = 'XTR')
        ),

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (
        reference,
        telegram_id,
        payment_method,
        plan,
        days,
        currency
    )
);

CREATE TABLE IF NOT EXISTS vip_processed_payments (
    reference TEXT PRIMARY KEY NOT NULL
        CHECK (length(trim(reference)) > 0),

    payment_method TEXT NOT NULL
        CHECK (payment_method IN ('crypto', 'stars')),

    payment_scope TEXT NOT NULL
        CHECK (length(trim(payment_scope)) > 0),

    provider_payment_id TEXT NOT NULL
        CHECK (length(trim(provider_payment_id)) > 0),

    telegram_id TEXT NOT NULL
        CHECK (length(trim(telegram_id)) > 0),

    plan TEXT NOT NULL
        CHECK (plan IN ('weekly', 'monthly', 'quarterly', 'annual')),

    days_credited INTEGER NOT NULL
        CHECK (typeof(days_credited) = 'integer')
        CHECK (
            (plan = 'weekly' AND days_credited = 7)
            OR (plan = 'monthly' AND days_credited = 30)
            OR (plan = 'quarterly' AND days_credited = 90)
            OR (plan = 'annual' AND days_credited = 365)
        ),

    paid_amount_units INTEGER NOT NULL
        CHECK (
            typeof(paid_amount_units) = 'integer'
            AND paid_amount_units > 0
            AND paid_amount_units <= 9007199254740991
        ),

    currency TEXT NOT NULL
        CHECK (
            (payment_method = 'crypto' AND currency = 'USDT')
            OR (payment_method = 'stars' AND currency = 'XTR')
        ),

    subscription_id INTEGER NOT NULL
        CHECK (
            typeof(subscription_id) = 'integer'
            AND subscription_id > 0
        ),

    previous_expires_at TEXT,
    resulting_expires_at TEXT NOT NULL
        CHECK (length(trim(resulting_expires_at)) > 0),

    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (
        payment_method,
        payment_scope,
        provider_payment_id
    ),

    UNIQUE (
        reference,
        payment_method,
        payment_scope,
        provider_payment_id,
        telegram_id,
        currency,
        paid_amount_units
    ),

    FOREIGN KEY (
        reference,
        telegram_id,
        payment_method,
        plan,
        days_credited,
        currency
    )
    REFERENCES vip_invoices (
        reference,
        telegram_id,
        payment_method,
        plan,
        days,
        currency
    )
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS vip_payment_inbox (
    id INTEGER PRIMARY KEY,

    bot_id TEXT NOT NULL
        CHECK (length(trim(bot_id)) > 0),

    telegram_charge_id TEXT NOT NULL
        CHECK (length(trim(telegram_charge_id)) > 0),

    invoice_reference TEXT NOT NULL
        CHECK (length(trim(invoice_reference)) > 0),

    telegram_id TEXT NOT NULL
        CHECK (length(trim(telegram_id)) > 0),

    payment_method TEXT NOT NULL DEFAULT 'stars'
        CHECK (payment_method = 'stars'),

    currency TEXT NOT NULL
        CHECK (currency = 'XTR'),

    paid_amount_units INTEGER NOT NULL
        CHECK (
            typeof(paid_amount_units) = 'integer'
            AND paid_amount_units > 0
            AND paid_amount_units <= 9007199254740991
        ),

    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'applied', 'review_required')),

    processed_reference TEXT,

    attempt_count INTEGER NOT NULL DEFAULT 0
        CHECK (
            typeof(attempt_count) = 'integer'
            AND attempt_count >= 0
        ),

    next_attempt_at TEXT,
    last_error_code TEXT,

    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    applied_at TEXT,

    UNIQUE (bot_id, telegram_charge_id),

    CHECK (
        (
            status = 'applied'
            AND processed_reference IS NOT NULL
            AND processed_reference = invoice_reference
            AND applied_at IS NOT NULL
        )
        OR
        (
            status IN ('pending', 'review_required')
            AND processed_reference IS NULL
            AND applied_at IS NULL
        )
    ),

    FOREIGN KEY (
        processed_reference,
        payment_method,
        bot_id,
        telegram_charge_id,
        telegram_id,
        currency,
        paid_amount_units
    )
    REFERENCES vip_processed_payments (
        reference,
        payment_method,
        payment_scope,
        provider_payment_id,
        telegram_id,
        currency,
        paid_amount_units
    )
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS vip_invoices_user_created
    ON vip_invoices (telegram_id, created_at);

CREATE INDEX IF NOT EXISTS vip_processed_payments_user_applied
    ON vip_processed_payments (telegram_id, applied_at);

CREATE INDEX IF NOT EXISTS vip_payment_inbox_pending
    ON vip_payment_inbox (status, next_attempt_at, id);