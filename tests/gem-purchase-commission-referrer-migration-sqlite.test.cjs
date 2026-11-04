// Migración 005: columna commission_referrer_id (referidor original).
// Motor libSQL/SQLite real en memoria. Sin .env, Turso ni datos reales.
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

const read = (file) => stripComments(readFileSync(path.resolve(__dirname, '..', file), 'utf8'))

const MIGRATION_002 = read('migrations/002_gem_purchase_records.sql')
const MIGRATION_004 = read('migrations/004_gem_purchase_commission_decision.sql')
const MIGRATION_005 = read('migrations/005_gem_purchase_commission_referrer.sql')

const BASE_SCHEMA = `
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
`

async function withMigrated(callback) {
  const db = createClient({ url: 'file::memory:' })
  try {
    await db.executeMultiple(BASE_SCHEMA)
    await db.executeMultiple(MIGRATION_002)
    await db.executeMultiple(MIGRATION_004)
    await db.executeMultiple(MIGRATION_005)
    await callback(db)
  } finally {
    db.close()
  }
}

const columns = async (db) =>
  (await db.execute('PRAGMA table_info(star_purchases)')).rows.map((r) => r.name)

test('005 adds commission_referrer_id after 002 and 004', async () => {
  await withMigrated(async (db) => {
    const names = await columns(db)
    assert.deepEqual(names.slice(-3), [
      'commission_base_gems',
      'commission_pct',
      'commission_referrer_id',
    ])
    assert.equal(names.filter((c) => c === 'commission_referrer_id').length, 1)
  })
})

test('legacy rows keep NULL (never auto-credited)', async () => {
  await withMigrated(async (db) => {
    await db.execute({
      sql: `INSERT INTO star_purchases
              (telegram_id, stars_amount, gems_amount, is_first_purchase,
               telegram_charge_id, payment_method, status, applied_at)
            VALUES ('legacy', 150, 315, 0, 'legacy', 'gems', 'applied', 'now')`,
      args: [],
    })

    const row = (await db.execute(
      `SELECT commission_referrer_id FROM star_purchases
        WHERE telegram_charge_id = 'legacy'`
    )).rows[0]
    assert.equal(row.commission_referrer_id, null)

    const pending = (await db.execute(
      `SELECT COUNT(*) AS n FROM star_purchases
        WHERE commission_referrer_id IS NOT NULL`
    )).rows[0].n
    assert.equal(pending, 0)
  })
})

test('CHECK rejects empty / whitespace referrer and accepts a valid id', async () => {
  await withMigrated(async (db) => {
    const insert = (referrer) => ({
      sql: `INSERT INTO star_purchases
              (telegram_id, stars_amount, gems_amount, is_first_purchase,
               telegram_charge_id, payment_method, status, applied_at,
               commission_referrer_id)
            VALUES ('u1', 150, 315, 0, ?, 'gems', 'applied', 'now', ?)`,
      args: [`ch-${referrer}`, referrer],
    })

    await assert.rejects(db.execute(insert('')), /CHECK|constraint/i)
    await assert.rejects(db.execute(insert('   ')), /CHECK|constraint/i)
    await db.execute(insert('ref-1'))

    assert.equal(
      (await db.execute(
        `SELECT commission_referrer_id FROM star_purchases
          WHERE telegram_charge_id = 'ch-ref-1'`
      )).rows[0].commission_referrer_id,
      'ref-1'
    )
  })
})

test('005 is one-shot: re-applying fails without touching schema or data', async () => {
  await withMigrated(async (db) => {
    await db.execute({
      sql: `INSERT INTO star_purchases
              (telegram_id, stars_amount, gems_amount, is_first_purchase,
               telegram_charge_id, payment_method, status, applied_at,
               commission_referrer_id, commission_base_gems, commission_pct)
            VALUES ('u1', 150, 315, 0, 'ch-once', 'gems', 'applied', 'now',
                    'ref-1', 315, 5)`,
      args: [],
    })

    const before = await columns(db)
    await assert.rejects(db.executeMultiple(MIGRATION_005), /duplicate column name/i)
    assert.deepEqual(await columns(db), before)

    const row = (await db.execute(
      `SELECT commission_referrer_id, commission_base_gems, commission_pct
         FROM star_purchases WHERE telegram_charge_id = 'ch-once'`
    )).rows[0]
    assert.equal(row.commission_referrer_id, 'ref-1')
    assert.equal(row.commission_base_gems, 315)
    assert.equal(row.commission_pct, 5)
  })
})
