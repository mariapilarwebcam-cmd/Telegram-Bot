// Esquema VIP real sobre SQLite/libSQL exclusivamente en memoria.
// Sin .env, handlers, clientes productivos, credenciales ni red.
// No demuestra transacciones, configuración o concurrencia de Turso remoto.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const { createClient } = require('@libsql/client/sqlite3')

const migrationPath = path.resolve(
  __dirname,
  '../migrations/001_vip_payment_records.sql'
)
const migration = readFileSync(migrationPath, 'utf8')

const USER = '123456789'
const BOT = '987654321'
const NOW = '2026-01-01 00:00:00'
const EXPIRY = '2026-01-08 00:00:00'
const REFERENCE = 'vip_sub_weekly_123456789_synthetic'
const CHARGE = 'synthetic-stars-charge'

const TABLES = [
  'vip_invoices',
  'vip_processed_payments',
  'vip_payment_inbox',
]

const EXPECTED_COLUMNS = {
  vip_invoices: [
    'reference', 'telegram_id', 'payment_method', 'plan', 'days',
    'expected_amount_units', 'currency', 'created_at',
  ],
  vip_processed_payments: [
    'reference', 'payment_method', 'payment_scope', 'provider_payment_id',
    'telegram_id', 'plan', 'days_credited', 'paid_amount_units', 'currency',
    'subscription_id', 'previous_expires_at', 'resulting_expires_at',
    'applied_at',
  ],
  vip_payment_inbox: [
    'id', 'bot_id', 'telegram_charge_id', 'invoice_reference', 'telegram_id',
    'payment_method', 'currency', 'paid_amount_units', 'status',
    'processed_reference', 'attempt_count', 'next_attempt_at',
    'last_error_code', 'received_at', 'updated_at', 'applied_at',
  ],
}

function invoice(overrides = {}) {
  return {
    reference: REFERENCE,
    telegram_id: USER,
    payment_method: 'stars',
    plan: 'weekly',
    days: 7,
    expected_amount_units: 250,
    currency: 'XTR',
    ...overrides,
  }
}

function payment(overrides = {}) {
  return {
    reference: REFERENCE,
    payment_method: 'stars',
    payment_scope: BOT,
    provider_payment_id: CHARGE,
    telegram_id: USER,
    plan: 'weekly',
    days_credited: 7,
    paid_amount_units: 250,
    currency: 'XTR',
    subscription_id: 1,
    previous_expires_at: null,
    resulting_expires_at: EXPIRY,
    ...overrides,
  }
}

function event(overrides = {}) {
  return {
    bot_id: BOT,
    telegram_charge_id: CHARGE,
    invoice_reference: REFERENCE,
    telegram_id: USER,
    currency: 'XTR',
    paid_amount_units: 250,
    ...overrides,
  }
}

function appliedEvent(overrides = {}) {
  return event({
    status: 'applied',
    processed_reference: REFERENCE,
    applied_at: NOW,
    ...overrides,
  })
}

async function insert(db, table, values) {
  assert.ok(TABLES.includes(table), 'Only new VIP tables may be inserted')
  const columns = Object.keys(values)
  assert.ok(columns.length > 0)
  for (const column of columns) {
    assert.ok(EXPECTED_COLUMNS[table].includes(column), column)
  }
  return db.execute({
    sql: `INSERT INTO ${table} (${columns.join(', ')})
          VALUES (${columns.map(() => '?').join(', ')})`,
    args: columns.map(column => values[column]),
  })
}

async function rejected(operation) {
  await assert.rejects(operation, error => {
    assert.equal(typeof error.code, 'string')
    assert.match(error.code, /^SQLITE_CONSTRAINT(?:_[A-Z0-9_]+)?$/)
    return true
  })
}

async function rows(db, sql) {
  const result = await db.execute(sql)
  return result.rows.map(row => ({ ...row }))
}

async function applyMigration(db) {
  // This specific migration contains no semicolons inside comments,
  // string literals or trigger bodies. This is not a general SQL parser.
  const statements = migration.split(';').map(sql => sql.trim()).filter(Boolean)

  // Explicit transaction: partial DDL must not be accepted as success.
  await db.execute('BEGIN IMMEDIATE')
  try {
    for (const sql of statements) {
      await db.execute(sql)
    }
    await db.execute('COMMIT')
  } catch (error) {
    try {
      await db.execute('ROLLBACK')
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Migration failed and rollback also failed',
        { cause: error }
      )
    }
    throw error
  }
}

async function withDatabase(callback, options = {}) {
  const db = createClient({ url: 'file::memory:', intMode: 'number' })
  try {
    assert.equal(db.protocol, 'file')
    const databases = await rows(db, 'PRAGMA database_list')
    const main = databases.find(database => database.name === 'main')
    assert.ok(main)
    assert.equal(main.file, '', 'Database must be exclusively in memory')

    await db.execute('PRAGMA foreign_keys = ON')
    const settings = await rows(db, 'PRAGMA foreign_keys')
    assert.equal(Number(settings[0].foreign_keys), 1)

    if (options.migrate !== false) await applyMigration(db)
    await callback(db)

    assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), [])
    const integrity = await rows(db, 'PRAGMA integrity_check')
    assert.deepEqual(integrity.map(row => row.integrity_check), ['ok'])
  } finally {
    db.close()
    assert.equal(db.closed, true)
  }
}

async function seedPayment(db) {
  await insert(db, 'vip_invoices', invoice())
  await insert(db, 'vip_processed_payments', payment())
}

async function uniqueKeys(db, table) {
  const indexes = await rows(db, `PRAGMA index_list('${table}')`)
  const keys = []
  for (const index of indexes.filter(index => Number(index.unique) === 1)) {
    assert.match(index.name, /^[A-Za-z0-9_]+$/)
    const columns = await rows(db, `PRAGMA index_info('${index.name}')`)
    keys.push(columns.sort((a, b) => a.seqno - b.seqno).map(row => row.name))
  }
  return keys
}

function hasKey(keys, expected) {
  assert.ok(
    keys.some(key => JSON.stringify(key) === JSON.stringify(expected)),
    `Missing unique key: ${expected.join(', ')}`
  )
}

async function foreignKey(db, table, parent, expectedPairs) {
  const result = await rows(db, `PRAGMA foreign_key_list('${table}')`)
  assert.equal(result.length, expectedPairs.length)
  assert.equal(new Set(result.map(row => row.id)).size, 1)
  result.sort((a, b) => a.seq - b.seq)
  assert.deepEqual(
    result.map(row => [row.table, row.from, row.to]),
    expectedPairs.map(([from, to]) => [parent, from, to])
  )
  for (const row of result) {
    assert.equal(row.on_update, 'RESTRICT')
    assert.equal(row.on_delete, 'RESTRICT')
  }
}

test('creates exactly three VIP tables with the expected columns', async () => {
  await withDatabase(async db => {
    const tables = await rows(
      db,
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`
    )
    assert.deepEqual(tables.map(row => row.name), [...TABLES].sort())

    for (const table of TABLES) {
      const columns = await rows(db, `PRAGMA table_info('${table}')`)
      assert.deepEqual(columns.map(row => row.name), EXPECTED_COLUMNS[table])
    }

    const indexes = await rows(
      db,
      `SELECT name FROM sqlite_schema
       WHERE type = 'index' AND sql IS NOT NULL ORDER BY name`
    )
    assert.deepEqual(indexes.map(row => row.name), [
      'vip_invoices_user_created',
      'vip_payment_inbox_pending',
      'vip_processed_payments_user_applied',
    ])
  })
})

test('defines exact unique parent keys and composite foreign keys', async () => {
  await withDatabase(async db => {
    const invoices = await uniqueKeys(db, 'vip_invoices')
    hasKey(invoices, ['reference'])
    hasKey(invoices, [
      'reference', 'telegram_id', 'payment_method', 'plan', 'days', 'currency',
    ])

    const payments = await uniqueKeys(db, 'vip_processed_payments')
    hasKey(payments, ['reference'])
    hasKey(payments, [
      'payment_method', 'payment_scope', 'provider_payment_id',
    ])
    hasKey(payments, [
      'reference', 'payment_method', 'payment_scope', 'provider_payment_id',
      'telegram_id', 'currency', 'paid_amount_units',
    ])

    hasKey(await uniqueKeys(db, 'vip_payment_inbox'), [
      'bot_id', 'telegram_charge_id',
    ])

    await foreignKey(db, 'vip_processed_payments', 'vip_invoices', [
      ['reference', 'reference'],
      ['telegram_id', 'telegram_id'],
      ['payment_method', 'payment_method'],
      ['plan', 'plan'],
      ['days_credited', 'days'],
      ['currency', 'currency'],
    ])
    await foreignKey(db, 'vip_payment_inbox', 'vip_processed_payments', [
      ['processed_reference', 'reference'],
      ['payment_method', 'payment_method'],
      ['bot_id', 'payment_scope'],
      ['telegram_charge_id', 'provider_payment_id'],
      ['telegram_id', 'telegram_id'],
      ['currency', 'currency'],
      ['paid_amount_units', 'paid_amount_units'],
    ])
  })
})

test('accepts both methods and all existing plan-period combinations', async () => {
  await withDatabase(async db => {
    for (const [plan, days] of [
      ['weekly', 7], ['monthly', 30], ['quarterly', 90], ['annual', 365],
    ]) {
      for (const method of ['stars', 'crypto']) {
        const reference = `synthetic-${method}-${plan}`
        const currency = method === 'stars' ? 'XTR' : 'USDT'
        await insert(db, 'vip_invoices', invoice({
          reference, payment_method: method, currency, plan, days,
        }))
        await insert(db, 'vip_processed_payments', payment({
          reference, payment_method: method, currency, plan,
          days_credited: days,
          payment_scope: method === 'stars' ? BOT : 'synthetic-ton-mainnet',
          provider_payment_id: `synthetic-payment-${method}-${plan}`,
        }))
      }
    }
    const result = await rows(db, 'SELECT count(*) AS total FROM vip_invoices')
    assert.equal(result[0].total, 8)
  })
})

test('rejects duplicate invoice and processed references', async () => {
  await withDatabase(async db => {
    await seedPayment(db)
    await rejected(() => insert(db, 'vip_invoices', invoice()))
    await rejected(() => insert(db, 'vip_processed_payments', payment({
      provider_payment_id: 'different-charge',
    })))
  })
})

test('rejects duplicate provider identities but permits separate scopes', async () => {
  await withDatabase(async db => {
    await seedPayment(db)
    await insert(db, 'vip_invoices', invoice({ reference: 'second' }))
    await rejected(() => insert(db, 'vip_processed_payments', payment({
      reference: 'second',
    })))
    await insert(db, 'vip_processed_payments', payment({
      reference: 'second', payment_scope: 'another-synthetic-bot',
    }))
  })
})

test('deduplicates Stars by bot and charge without making payload unique', async () => {
  await withDatabase(async db => {
    await insert(db, 'vip_payment_inbox', event())
    await rejected(() => insert(db, 'vip_payment_inbox', event()))
    await rejected(() => insert(db, 'vip_payment_inbox', event({
      paid_amount_units: 251,
    })))
    await insert(db, 'vip_payment_inbox', event({
      bot_id: 'another-synthetic-bot',
    }))
    await insert(db, 'vip_payment_inbox', event({
      telegram_charge_id: 'another-synthetic-charge',
    }))
    const result = await rows(
      db, 'SELECT count(*) AS total FROM vip_payment_inbox'
    )
    assert.equal(result[0].total, 3)
  })
})

test('preserves unknown or discordant events without creating payments', async () => {
  await withDatabase(async db => {
    await insert(db, 'vip_invoices', invoice())
    await insert(db, 'vip_payment_inbox', event({
      invoice_reference: 'unknown-legacy-reference',
    }))
    await insert(db, 'vip_payment_inbox', event({
      telegram_charge_id: 'discordant-charge',
      telegram_id: 'different-user',
      paid_amount_units: 999,
      status: 'review_required',
    }))
    assert.deepEqual(
      await rows(
        db,
        `SELECT status, processed_reference, applied_at
         FROM vip_payment_inbox ORDER BY id`
      ),
      [
        { status: 'pending', processed_reference: null, applied_at: null },
        {
          status: 'review_required',
          processed_reference: null,
          applied_at: null,
        },
      ]
    )
    const result = await rows(
      db, 'SELECT count(*) AS total FROM vip_processed_payments'
    )
    assert.equal(result[0].total, 0)
  })
})

test('rejects processed payments not matching their invoice', async () => {
  const cases = [
    { reference: 'missing-invoice' },
    { telegram_id: 'different-user' },
    { payment_method: 'crypto', currency: 'USDT' },
    { plan: 'monthly', days_credited: 30 },
  ]
  for (const overrides of cases) {
    await withDatabase(async db => {
      await insert(db, 'vip_invoices', invoice())
      await rejected(() => insert(
        db, 'vip_processed_payments', payment(overrides)
      ))
    })
  }
})

test('applied event requires a matching permanent payment', async () => {
  const cases = [
    { bot_id: 'different-bot' },
    { telegram_charge_id: 'different-charge' },
    { telegram_id: 'different-user' },
    { paid_amount_units: 251 },
    {
      invoice_reference: 'different-reference',
      processed_reference: 'different-reference',
    },
  ]
  for (const overrides of cases) {
    await withDatabase(async db => {
      await seedPayment(db)
      await rejected(() => insert(
        db, 'vip_payment_inbox', appliedEvent(overrides)
      ))
    })
  }
  await withDatabase(async db => {
    await rejected(() => insert(
      db, 'vip_payment_inbox', appliedEvent()
    ))
    await seedPayment(db)
    await insert(db, 'vip_payment_inbox', appliedEvent())
  })
})

test('validates state and application metadata on insert and update', async () => {
  for (const overrides of [
    { status: 'unknown' },
    { status: 'processing' },
    { status: 'applied' },
    { processed_reference: REFERENCE },
    { applied_at: NOW },
    {
      status: 'review_required',
      processed_reference: REFERENCE,
      applied_at: NOW,
    },
    { status: 'applied', processed_reference: REFERENCE },
    { status: 'applied', applied_at: NOW },
    {
      status: 'applied',
      processed_reference: 'different-reference',
      applied_at: NOW,
    },
  ]) {
    await withDatabase(async db => {
      await seedPayment(db)
      await rejected(() => insert(
        db, 'vip_payment_inbox', event(overrides)
      ))
    })
  }

  await withDatabase(async db => {
    await seedPayment(db)
    await insert(db, 'vip_payment_inbox', event())
    await rejected(() => db.execute(
      `UPDATE vip_payment_inbox SET status = 'applied'`
    ))
    await db.execute({
      sql: `UPDATE vip_payment_inbox
            SET status = 'applied', processed_reference = ?, applied_at = ?`,
      args: [REFERENCE, NOW],
    })
    const result = await rows(
      db, 'SELECT status FROM vip_payment_inbox'
    )
    assert.equal(result[0].status, 'applied')
  })
})

test('rejects invalid amounts, periods, methods, currencies and identities', async () => {
  const cases = [
    ['vip_invoices', invoice, 'expected_amount_units',
      [0, -1, 1.5, 'invalid', null, 9007199254740992n]],
    ['vip_processed_payments', payment, 'paid_amount_units',
      [0, -1, 1.5, 'invalid', null, 9007199254740992n]],
    ['vip_payment_inbox', event, 'paid_amount_units',
      [0, -1, 1.5, 'invalid', null, 9007199254740992n]],
    ['vip_invoices', invoice, 'days', [0, -1, 7.5, 30, 'invalid', null]],
    ['vip_processed_payments', payment, 'days_credited',
      [0, -7, 7.5, 30, 'invalid', null]],
    ['vip_invoices', invoice, 'plan', ['invalid', '', null]],
    ['vip_processed_payments', payment, 'plan', ['invalid', '', null]],
    ['vip_invoices', invoice, 'payment_method', ['invalid', '', null]],
    ['vip_processed_payments', payment, 'payment_method', ['invalid', '', null]],
    ['vip_payment_inbox', event, 'payment_method', ['crypto', '', null]],
    ['vip_invoices', invoice, 'currency', ['USDT', 'USD', '', null]],
    ['vip_processed_payments', payment, 'currency', ['USDT', 'USD', '', null]],
    ['vip_payment_inbox', event, 'currency', ['USDT', 'USD', '', null]],
    ['vip_processed_payments', payment, 'subscription_id',
      [0, -1, 1.5, 'invalid', null]],
    ['vip_payment_inbox', event, 'attempt_count',
      [-1, 1.5, 'invalid', null]],
    ['vip_invoices', invoice, 'reference', ['', '   ', null]],
    ['vip_invoices', invoice, 'telegram_id', ['', '   ', null]],
    ['vip_processed_payments', payment, 'payment_scope', ['', '   ', null]],
    ['vip_processed_payments', payment, 'provider_payment_id', ['', '   ', null]],
    ['vip_payment_inbox', event, 'bot_id', ['', '   ', null]],
    ['vip_payment_inbox', event, 'telegram_charge_id', ['', '   ', null]],
    ['vip_payment_inbox', event, 'invoice_reference', ['', '   ', null]],
    ['vip_payment_inbox', event, 'telegram_id', ['', '   ', null]],
  ]

  for (const [table, factory, column, values] of cases) {
    await withDatabase(async db => {
      if (table === 'vip_processed_payments') {
        await insert(db, 'vip_invoices', invoice())
      }
      for (const value of values) {
        await rejected(() => insert(db, table, factory({ [column]: value })))
      }
    })
  }

  await withDatabase(async db => {
    await rejected(() => insert(db, 'vip_invoices', invoice({
      payment_method: 'crypto', currency: 'XTR',
    })))
    await insert(db, 'vip_invoices', invoice({
      payment_method: 'crypto', currency: 'USDT',
    }))
    await rejected(() => insert(db, 'vip_processed_payments', payment({
      payment_method: 'crypto', currency: 'XTR',
    })))
  })
})

test('stores numeric affinity as integers and accepts safe upper amounts', async () => {
  await withDatabase(async db => {
    await insert(db, 'vip_invoices', invoice({
      expected_amount_units: '250',
    }))
    await insert(db, 'vip_processed_payments', payment({
      paid_amount_units: '250',
    }))
    await insert(db, 'vip_payment_inbox', event({
      paid_amount_units: '250',
    }))
    for (const [table, column] of [
      ['vip_invoices', 'expected_amount_units'],
      ['vip_processed_payments', 'paid_amount_units'],
      ['vip_payment_inbox', 'paid_amount_units'],
    ]) {
      const result = await rows(
        db, `SELECT typeof(${column}) AS storage_type FROM ${table}`
      )
      assert.equal(result[0].storage_type, 'integer')
    }
    await insert(db, 'vip_invoices', invoice({
      reference: 'safe-upper-bound',
      expected_amount_units: Number.MAX_SAFE_INTEGER,
    }))
  })
})

test('restricts changes to parent keys used by existing child records', async () => {
  await withDatabase(async db => {
    await seedPayment(db)
    await insert(db, 'vip_payment_inbox', appliedEvent())
    await rejected(() => db.execute(
      `UPDATE vip_invoices SET telegram_id = 'different-user'`
    ))
    await rejected(() => db.execute(
      `UPDATE vip_processed_payments SET provider_payment_id = 'changed'`
    ))
  })
})

test('preserves existing data and schema when migration is repeated', async () => {
  await withDatabase(async db => {
    // Synthetic prior schema; not a claim about the full production schema.
    await db.executeMultiple(`
      CREATE TABLE subscriptions (
        id INTEGER PRIMARY KEY,
        telegram_id TEXT,
        telegram_charge_id TEXT UNIQUE,
        expires_at TEXT
      );
      CREATE TABLE star_purchases (
        id INTEGER PRIMARY KEY,
        telegram_id TEXT,
        telegram_charge_id TEXT UNIQUE,
        stars_amount INTEGER
      );
      CREATE TABLE user_characters (
        id INTEGER PRIMARY KEY,
        character_name TEXT
      );
      INSERT INTO subscriptions
        VALUES (1, 'synthetic-user', 'legacy-vip', '2030-01-01 00:00:00');
      INSERT INTO star_purchases
        VALUES (1, 'synthetic-user', 'legacy-gems-charge', 100);
      INSERT INTO user_characters VALUES (1, 'Synthetic character');
    `)

    async function legacySnapshot() {
      return {
        schema: await rows(
          db,
          `SELECT type, name, tbl_name, sql FROM sqlite_schema
           WHERE tbl_name IN (
             'subscriptions', 'star_purchases', 'user_characters'
           ) ORDER BY type, name`
        ),
        subscriptions: await rows(db, 'SELECT * FROM subscriptions'),
        purchases: await rows(db, 'SELECT * FROM star_purchases'),
        characters: await rows(db, 'SELECT * FROM user_characters'),
      }
    }

    const before = await legacySnapshot()
    await applyMigration(db)
    assert.deepEqual(await legacySnapshot(), before)

    await seedPayment(db)
    await insert(db, 'vip_payment_inbox', appliedEvent())

    const schema = await rows(
      db,
      `SELECT type, name, tbl_name, sql FROM sqlite_schema
       ORDER BY type, name`
    )
    const vipBefore = {}
    for (const table of TABLES) {
      vipBefore[table] = await rows(db, `SELECT * FROM ${table}`)
    }

    await applyMigration(db)
    await applyMigration(db)

    assert.deepEqual(await legacySnapshot(), before)
    assert.deepEqual(
      await rows(
        db,
        `SELECT type, name, tbl_name, sql FROM sqlite_schema
         ORDER BY type, name`
      ),
      schema
    )
    for (const table of TABLES) {
      assert.deepEqual(
        await rows(db, `SELECT * FROM ${table}`),
        vipBefore[table]
      )
    }
  }, { migrate: false })
})