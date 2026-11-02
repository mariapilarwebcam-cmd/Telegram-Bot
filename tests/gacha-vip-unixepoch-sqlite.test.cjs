// Regresión del umbral VIP con created_at entero en segundos Unix.
// Base exclusivamente en memoria; sin handler ejecutado ni servicios remotos.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const { createClient } = require('@libsql/client/sqlite3')

const USER_ID = 'synthetic-vip-user'
const routePath = path.resolve(
  __dirname,
  '../app/api/gacha/spin/route.ts'
)
const source = readFileSync(routePath, 'utf8')
const queryMatch = source.match(
  /`(SELECT id FROM gacha_history\s+WHERE user_id = \? AND cost_gems = 0 AND created_at >= [^`]+)`/
)
assert.ok(queryMatch, 'VIP eligibility query not found in handler source')
const actualQuery = queryMatch[1]
const fixedQuery = `
  SELECT id FROM gacha_history
  WHERE user_id = ? AND cost_gems = 0
    AND created_at >= unixepoch('now', '-7 days')
  LIMIT 1
`
const legacyQuery = `
  SELECT id FROM gacha_history
  WHERE user_id = ? AND cost_gems = 0
    AND created_at >= datetime('now', '-7 days')
  LIMIT 1
`
const normalize = sql => sql.replace(/\s+/g, ' ').trim()

async function withDatabase(callback) {
  const db = createClient({ url: 'file::memory:' })
  try {
    assert.equal(db.protocol, 'file')
    await db.execute(`
      CREATE TABLE gacha_history (
        id INTEGER PRIMARY KEY,
        user_id TEXT NOT NULL,
        cost_gems INTEGER NOT NULL,
        reward_tier TEXT NOT NULL,
        reward_details TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `)
    await callback(db)
  } finally {
    db.close()
    assert.equal(db.closed, true)
  }
}

test('handler uses the numeric seven-day threshold', () => {
  assert.equal(normalize(actualQuery), normalize(fixedQuery))
})

test('new free history is missed by legacy SQL but found by handler SQL', async () => {
  await withDatabase(async db => {
    const before = await db.execute('SELECT unixepoch() AS seconds')
    await db.execute({
      sql: `
        INSERT INTO gacha_history
          (id, user_id, cost_gems, reward_tier, reward_details)
        VALUES (1, ?, 0, 'common', 'synthetic reward')
      `,
      args: [USER_ID],
    })
    const after = await db.execute('SELECT unixepoch() AS seconds')
    const stored = await db.execute(`
      SELECT created_at, typeof(created_at) AS storage_type
      FROM gacha_history WHERE id = 1
    `)
    assert.equal(stored.rows.length, 1)
    const row = stored.rows[0]
    assert.equal(row.storage_type, 'integer')
    assert.ok(Number.isInteger(row.created_at))
    assert.ok(row.created_at >= before.rows[0].seconds)
    assert.ok(row.created_at <= after.rows[0].seconds)

    const legacy = await db.execute({
      sql: legacyQuery,
      args: [USER_ID],
    })
    assert.equal(legacy.rows.length, 0)

    // Repetir la lectura simula decisiones secuenciales de elegibilidad,
    // no tiradas ni operaciones económicas del handler.
    for (let index = 0; index < 15; index++) {
      const corrected = await db.execute({
        sql: actualQuery,
        args: [USER_ID],
      })
      assert.equal(corrected.rows.length, 1)
      assert.equal(corrected.rows[0].id, 1)
    }
  })
})

test('old free history, other users and paid history do not block', async () => {
  await withDatabase(async db => {
    await db.execute({
      sql: `
        INSERT INTO gacha_history
          (id, user_id, cost_gems, reward_tier, reward_details, created_at)
        VALUES
          (1, ?, 0, 'common', 'synthetic old free reward',
            unixepoch('now', '-8 days')),
          (2, ?, 0, 'common', 'synthetic other user reward',
            unixepoch()),
          (3, ?, 50, 'common', 'synthetic paid reward',
            unixepoch())
      `,
      args: [USER_ID, 'synthetic-other-user', USER_ID],
    })
    const result = await db.execute({
      sql: actualQuery,
      args: [USER_ID],
    })
    assert.equal(result.rows.length, 0)
  })
})

test('AUXILIARY fixed clock: numeric seven-day boundary is inclusive', async () => {
  await withDatabase(async db => {
    const result = await db.execute(`
      SELECT
        unixepoch('2030-01-08 11:59:59') >=
          unixepoch('2030-01-15 12:00:00', '-7 days') AS before_boundary,
        unixepoch('2030-01-08 12:00:00') >=
          unixepoch('2030-01-15 12:00:00', '-7 days') AS at_boundary,
        unixepoch('2030-01-08 12:00:01') >=
          unixepoch('2030-01-15 12:00:00', '-7 days') AS after_boundary
    `)
    assert.equal(result.rows[0].before_boundary, 0)
    assert.equal(result.rows[0].at_boundary, 1)
    assert.equal(result.rows[0].after_boundary, 1)
  })
})