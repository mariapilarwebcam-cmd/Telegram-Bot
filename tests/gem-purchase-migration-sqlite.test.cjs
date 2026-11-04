// Compatibilidad de la migración aditiva con el esquema documentado.
// Motor libSQL/SQLite real, exclusivamente en memoria.
// Sin .env, sin Turso, sin datos de producción y sin ejecutar la migración
// contra ninguna base remota. Los resultados NO prueban el esquema productivo.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const { createClient } = require('@libsql/client/sqlite3')

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../migrations/002_gem_purchase_records.sql'),
  'utf8'
)
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

// Esquema documentado ANTES de la migración (README.md 187-205).
const DOCUMENTED_SCHEMA = `
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
`

const LEGACY_PURCHASE = `INSERT INTO star_purchases
    (telegram_id, stars_amount, gems_amount, is_first_purchase,
     telegram_charge_id, payment_method)
  VALUES ('legacy-user', 150, 315, 1, 'legacy-charge', 'gems')`

const LEGACY_LEDGER = `INSERT INTO gem_transactions
    (telegram_id, amount, transaction_type, description)
  VALUES ('legacy-user', 315, 'purchase', 'Compra con 150 stars')`

async function withMigrated(callback) {
  const db = createClient({ url: 'file::memory:' })
  try {
    await db.executeMultiple(DOCUMENTED_SCHEMA)
    // El código antiguo siguió escribiendo antes de la migración.
    await db.executeMultiple(LEGACY_PURCHASE)
    await db.executeMultiple(LEGACY_LEDGER)
    await db.executeMultiple(MIGRATION)
    await callback(db)
  } finally {
    db.close()
  }
}

const columns = async (db, table) =>
  (await db.execute(`PRAGMA table_info(${table})`)).rows.map((r) => r.name)

test('migration applies to the documented schema and is additive', async () => {
  await withMigrated(async (db) => {
    assert.deepEqual(await columns(db, 'star_purchases'), [
      'id', 'telegram_id', 'stars_amount', 'gems_amount', 'is_first_purchase',
      'telegram_charge_id', 'payment_method', 'created_at', 'status', 'applied_at',
    ])
    assert.deepEqual(await columns(db, 'gem_transactions'), [
      'id', 'telegram_id', 'amount', 'transaction_type', 'description',
      'created_at', 'charge_id',
    ])

    const legacy = (await db.execute(
      `SELECT telegram_id, stars_amount, gems_amount, is_first_purchase,
              telegram_charge_id, payment_method, status, applied_at
         FROM star_purchases WHERE telegram_charge_id = 'legacy-charge'`
    )).rows[0]

    // Los datos antiguos no se modifican y quedan como NO probados.
    assert.equal(legacy.telegram_id, 'legacy-user')
    assert.equal(legacy.stars_amount, 150)
    assert.equal(legacy.gems_amount, 315)
    assert.equal(legacy.is_first_purchase, 1)
    assert.equal(legacy.payment_method, 'gems')
    assert.equal(legacy.status, 'review_required')
    assert.equal(legacy.applied_at, null)

    assert.equal(
      (await db.execute('SELECT COUNT(*) AS n FROM gem_transactions')).rows[0].n,
      1
    )
    assert.equal(
      (await db.execute(
        'SELECT COUNT(*) AS n FROM gem_transactions WHERE charge_id IS NOT NULL'
      )).rows[0].n,
      0
    )
  })
})

test('status accepts only applied / review_required', async () => {
  await withMigrated(async (db) => {
    await db.executeMultiple(`INSERT INTO star_purchases
        (telegram_id, stars_amount, gems_amount, is_first_purchase,
         telegram_charge_id, payment_method, status, applied_at)
      VALUES ('u1', 100, 400, 1, 'charge-applied', 'gems', 'applied', 'now')`)

    assert.equal(
      (await db.execute(
        `SELECT status FROM star_purchases WHERE telegram_charge_id = 'charge-applied'`
      )).rows[0].status,
      'applied'
    )

    await assert.rejects(
      db.executeMultiple(`INSERT INTO star_purchases
          (telegram_id, stars_amount, gems_amount, is_first_purchase,
           telegram_charge_id, payment_method, status)
        VALUES ('u2', 100, 400, 0, 'charge-bogus', 'gems', 'credited')`),
      /CHECK|constraint/i
    )
  })
})

test('charge_id is unique per ledger movement and legacy NULLs do not collide', async () => {
  await withMigrated(async (db) => {
    const insert = (charge) => `INSERT INTO gem_transactions
        (telegram_id, amount, transaction_type, description, charge_id)
      VALUES ('u1', 100, 'purchase', 'Compra', ${charge})`

    await db.executeMultiple(insert(`'charge-1'`))
    await assert.rejects(db.executeMultiple(insert(`'charge-1'`)), /UNIQUE/i)

    // Filas antiguas (charge_id NULL) y nuevas sin cargo pueden coexistir.
    await db.executeMultiple(insert('NULL'))
    await db.executeMultiple(insert('NULL'))
    assert.equal(
      (await db.execute(
        'SELECT COUNT(*) AS n FROM gem_transactions WHERE charge_id IS NULL'
      )).rows[0].n,
      3
    )
  })
})

test('star_purchases keeps its UNIQUE charge and both indexes exist', async () => {
  await withMigrated(async (db) => {
    await assert.rejects(
      db.executeMultiple(`INSERT INTO star_purchases
          (telegram_id, stars_amount, gems_amount, is_first_purchase,
           telegram_charge_id, payment_method)
        VALUES ('other', 150, 315, 0, 'legacy-charge', 'gems')`),
      /UNIQUE/i
    )

    const indexes = (await db.execute(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN
        ('star_purchases_status', 'gem_transactions_charge') ORDER BY name`
    )).rows.map((r) => r.name)

    assert.deepEqual(indexes, ['gem_transactions_charge', 'star_purchases_status'])
  })
})

