// Migración 004: persistencia de la decisión de comisión (base + porcentaje).
// Motor libSQL/SQLite real, exclusivamente en memoria.
// Sin .env, sin Turso y sin datos reales.
// NO demuestra el esquema productivo.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const { createClient } = require('@libsql/client/sqlite3')

const stripComments = (sql) =>
  sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')

const MIGRATION_002 = stripComments(
  readFileSync(path.resolve(__dirname, '../migrations/002_gem_purchase_records.sql'), 'utf8')
)
const MIGRATION_004 = stripComments(
  readFileSync(
    path.resolve(__dirname, '../migrations/004_gem_purchase_commission_decision.sql'),
    'utf8'
  )
)

const BASE_SCHEMA = `
CREATE TABLE users (
    telegram_id TEXT PRIMARY KEY,
    gems INTEGER DEFAULT 0,
    purchased_gems INTEGER DEFAULT 0,
    bonus_gems INTEGER DEFAULT 0,
    hook_messages_remaining INTEGER DEFAULT 0,
    updated_at TEXT
);

CREATE TABLE gem_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT,
    amount INTEGER,
    transaction_type TEXT,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE star_purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT,
    stars_amount INTEGER,
    gems_amount INTEGER,
    is_first_purchase INTEGER,
    telegram_charge_id TEXT UNIQUE,
    payment_method TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE referral_commissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id TEXT,
    referred_id TEXT,
    purchase_gems INTEGER,
    commission_gems INTEGER,
    commission_pct INTEGER,
    source TEXT,
    reference TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`

const PENDING_QUERY = `SELECT telegram_id, telegram_charge_id, commission_base_gems, commission_pct
   FROM star_purchases
  WHERE status = 'applied'
    AND commission_pct IS NOT NULL
    AND commission_base_gems IS NOT NULL
    AND NOT EXISTS (
          SELECT 1 FROM referral_commissions c
           WHERE c.referred_id = star_purchases.telegram_id
             AND c.reference = star_purchases.telegram_charge_id)
  ORDER BY telegram_charge_id`

async function withMigrated(callback) {
  const db = createClient({ url: 'file::memory:' })
  try {
    await db.executeMultiple(BASE_SCHEMA)
    await db.executeMultiple(MIGRATION_002)
    await db.executeMultiple(MIGRATION_004)
    await callback(db)
  } finally {
    db.close()
  }
}

const applied = (charge, pct, base, tid = 'buyer-1') => ({
  sql: `INSERT INTO star_purchases
          (telegram_id, stars_amount, gems_amount, is_first_purchase,
           telegram_charge_id, payment_method, status, applied_at,
           commission_base_gems, commission_pct)
        VALUES (?, 150, 315, 0, ?, 'gems', 'applied', 'now', ?, ?)`,
  args: [tid, charge, base, pct],
})

const columnsOf = async (db, table) =>
  (await db.execute(`PRAGMA table_info(${table})`)).rows.map((r) => r.name)

test('columns are added and legacy rows stay NULL (never auto-credited)', async () => {
  await withMigrated(async (db) => {
    await db.execute({
      sql: `INSERT INTO star_purchases
              (telegram_id, stars_amount, gems_amount, is_first_purchase,
               telegram_charge_id, payment_method, status, applied_at)
            VALUES ('legacy', 150, 315, 0, 'legacy-charge', 'gems', 'applied', 'now')`,
      args: [],
    })

    assert.deepEqual((await columnsOf(db, 'star_purchases')).slice(-2), [
      'commission_base_gems',
      'commission_pct',
    ])

    const legacy = (await db.execute(
      `SELECT commission_base_gems, commission_pct FROM star_purchases
        WHERE telegram_charge_id = 'legacy-charge'`
    )).rows[0]

    assert.equal(legacy.commission_base_gems, null)
    assert.equal(legacy.commission_pct, null)

    // Una compra histórica no aparece como pendiente de recuperación.
    assert.equal((await db.execute(PENDING_QUERY)).rows.length, 0)
  })
})

test('pending detection excludes history, settled and non-applied charges', async () => {
  await withMigrated(async (db) => {
    await db.execute(applied('charge-pending', 5, 155))
    await db.execute(applied('charge-history', null, null))
    await db.execute(applied('charge-settled', 7, 210, 'buyer-2'))
    await db.execute({
      sql: `INSERT INTO referral_commissions
              (referrer_id, referred_id, purchase_gems, commission_gems,
               commission_pct, source, reference)
            VALUES ('ref-1', 'buyer-2', 210, 14, 7, 'stars', 'charge-settled')`,
      args: [],
    })
    await db.execute({
      sql: `INSERT INTO star_purchases
              (telegram_id, stars_amount, gems_amount, is_first_purchase,
               telegram_charge_id, payment_method, status, applied_at,
               commission_base_gems, commission_pct)
            VALUES ('buyer-3', 150, 315, 0, 'charge-review', 'gems',
                    'review_required', 'now', 315, 5)`,
      args: [],
    })
    // pct sin base: decisión incompleta, no debe tratarse como recuperable.
    await db.execute(applied('charge-partial', 5, null, 'buyer-4'))

    const pending = (await db.execute(PENDING_QUERY)).rows

    assert.equal(pending.length, 1)
    assert.equal(pending[0].telegram_charge_id, 'charge-pending')
    assert.equal(pending[0].commission_base_gems, 155)
    assert.equal(pending[0].commission_pct, 5)
  })
})

test('invalid commission amounts are rejected by the CHECK constraints', async () => {
  await withMigrated(async (db) => {
    await assert.rejects(db.execute(applied('charge-bad-pct', 101, 100)), /CHECK|constraint/i)
    await assert.rejects(db.execute(applied('charge-neg-pct', -1, 100)), /CHECK|constraint/i)
    await assert.rejects(db.execute(applied('charge-neg-base', 5, -10)), /CHECK|constraint/i)

    await db.execute(applied('charge-ok', 10, 0))
    assert.equal(
      (await db.execute(
        `SELECT commission_pct FROM star_purchases WHERE telegram_charge_id = 'charge-ok'`
      )).rows[0].commission_pct,
      10
    )
  })
})

test('migration is one-shot: re-applying fails and leaves schema/data intact', async () => {
  await withMigrated(async (db) => {
    await db.execute(applied('charge-once', 5, 155))
    const before = await columnsOf(db, 'star_purchases')

    await assert.rejects(db.executeMultiple(MIGRATION_004), /duplicate column name/i)

    // Ambas columnas siguen existiendo y no se duplican.
    const after = await columnsOf(db, 'star_purchases')
    assert.deepEqual(after, before)
    assert.equal(after.filter((c) => c === 'commission_base_gems').length, 1)
    assert.equal(after.filter((c) => c === 'commission_pct').length, 1)

    // Los datos permanecen intactos.
    const rows = (await db.execute(
      `SELECT telegram_charge_id, commission_base_gems, commission_pct, status
         FROM star_purchases`
    )).rows
    assert.equal(rows.length, 1)
    assert.equal(rows[0].telegram_charge_id, 'charge-once')
    assert.equal(rows[0].commission_base_gems, 155)
    assert.equal(rows[0].commission_pct, 5)
    assert.equal(rows[0].status, 'applied')
  })
})

