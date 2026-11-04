// Migración 003: unicidad de comisiones con duplicados históricos presentes.
// Motor libSQL/SQLite real sobre archivos temporales (se eliminan al final).
// Sin .env, sin Turso y sin datos reales.
// NO demuestra el esquema productivo: referral_commissions no está versionada
// en este repositorio.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { createClient } = require('@libsql/client/sqlite3')

const MIGRATION = fs
  .readFileSync(
    path.resolve(__dirname, '../migrations/003_referral_commission_uniqueness.sql'),
    'utf8'
  )
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

const WITH_ID = `CREATE TABLE referral_commissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id TEXT, referred_id TEXT, purchase_gems INTEGER,
    commission_gems INTEGER, commission_pct INTEGER, source TEXT,
    reference TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`

const WITHOUT_ID = WITH_ID.replace('id INTEGER PRIMARY KEY AUTOINCREMENT,', '')

const insert = (referred, reference) => ({
  sql: `INSERT INTO referral_commissions
          (referrer_id, referred_id, purchase_gems, commission_gems,
           commission_pct, source, reference)
        VALUES ('ref-1', ?, 100, 5, 5, 'stars', ?)`,
  args: [referred, reference],
})

function open(tag) {
  const file = path.join(
    os.tmpdir(),
    `taboo-003-${tag}-${process.pid}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}.db`
  )
  return { file, db: createClient({ url: `file:${file}` }) }
}

async function close(handle) {
  try {
    handle.db.close()
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 80))
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${handle.file}${suffix}`, { force: true })
    } catch {}
  }
}

async function withMigrated(schema, seed, callback) {
  const handle = open('m')
  try {
    await handle.db.executeMultiple(schema)
    for (const statement of seed) await handle.db.execute(statement)
    await handle.db.executeMultiple(MIGRATION)
    await callback(handle.db)
  } finally {
    await close(handle)
  }
}

test('historical duplicates: migration applies without failing and keeps data', async () => {
  const seed = [
    insert('buyer-1', 'charge-A'),
    insert('buyer-1', 'charge-A'),
    insert('buyer-2', 'charge-A'),
  ]

  await withMigrated(WITH_ID, seed, async (db) => {
    const total = (await db.execute('SELECT COUNT(*) AS n FROM referral_commissions'))
      .rows[0].n
    assert.equal(total, 3)

    const rows = (await db.execute(
      `SELECT referred_id, reference FROM referral_commissions
        WHERE reference IS NOT NULL`
    )).rows

    const counts = {}
    for (const row of rows) {
      const key = `${row.referred_id}|${row.reference}`
      counts[key] = (counts[key] || 0) + 1
    }

    assert.equal(counts['buyer-1|charge-A'], 2)
    assert.equal(counts['buyer-2|charge-A'], 1)
  })
})

test('duplicate INSERT is rejected; legitimate rows are accepted', async () => {
  await withMigrated(WITH_ID, [insert('buyer-1', 'charge-A')], async (db) => {
    await assert.rejects(
      db.execute(insert('buyer-1', 'charge-A')),
      /duplicate_referral_commission/
    )

    await db.execute(insert('buyer-1', 'charge-B'))
    await db.execute(insert('buyer-2', 'charge-A'))
    await db.execute(insert('buyer-3', null))
    await db.execute(insert('buyer-3', null))

    assert.equal(
      (await db.execute('SELECT COUNT(*) AS n FROM referral_commissions')).rows[0].n,
      5
    )
  })
})

test('UPDATE creating a duplicate is rejected; benign UPDATE is allowed', async () => {
  await withMigrated(
    WITH_ID,
    [insert('buyer-1', 'charge-A'), insert('buyer-1', 'charge-B')],
    async (db) => {
      await assert.rejects(
        db.execute({
          sql: `UPDATE referral_commissions SET reference = 'charge-A'
                 WHERE referred_id = 'buyer-1' AND reference = 'charge-B'`,
          args: [],
        }),
        /duplicate_referral_commission/
      )

      await db.execute({
        sql: `UPDATE referral_commissions SET commission_pct = 7
               WHERE referred_id = 'buyer-1' AND reference = 'charge-B'`,
        args: [],
      })

      assert.equal(
        (await db.execute(
          `SELECT commission_pct FROM referral_commissions
            WHERE reference = 'charge-B'`
        )).rows[0].commission_pct,
        7
      )
    }
  )
})

test('table without an id column (rowid based): same behaviour', async () => {
  await withMigrated(WITHOUT_ID, [insert('buyer-1', 'charge-A')], async (db) => {
    await assert.rejects(
      db.execute(insert('buyer-1', 'charge-A')),
      /duplicate_referral_commission/
    )
    await db.execute(insert('buyer-9', 'charge-A'))

    assert.equal(
      (await db.execute('SELECT COUNT(*) AS n FROM referral_commissions')).rows[0].n,
      2
    )
  })
})

test('concurrency: two connections, same charge, exactly one row', async () => {
  const first = open('ca')
  const second = { file: first.file, db: createClient({ url: `file:${first.file}` }) }

  try {
    await first.db.executeMultiple(WITH_ID)
    await first.db.executeMultiple(MIGRATION)

    const results = await Promise.allSettled([
      first.db.execute(insert('buyer-1', 'charge-Z')),
      second.db.execute(insert('buyer-1', 'charge-Z')),
    ])

    const total = (await first.db.execute(
      'SELECT COUNT(*) AS n FROM referral_commissions'
    )).rows[0].n

    assert.equal(total, 1)
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    assert.equal(results.filter((r) => r.status === 'rejected').length, 1)
  } finally {
    try {
      second.db.close()
    } catch {}
    await close(first)
  }
})
