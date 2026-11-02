// Capacidad del motor SQLite local: memoria compartida y exclusión de escritores.
// No importa el handler, lib/turso.ts, credenciales ni servicios remotos.
// No demuestra el comportamiento remoto de Turso ni reintentos del handler.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createClient } = require('@libsql/client/sqlite3')

const URL = 'file::memory:?cache=shared'
const USER_ID = 'synthetic-capability-vip'
const BUSY_TIMEOUT_MS = 0
const TEST_OPTIONS = { concurrency: false, timeout: 5000 }

const FREE_QUERY = `
  SELECT id FROM gacha_history
  WHERE user_id = ? AND cost_gems = 0
    AND created_at >= unixepoch('now', '-7 days')
  LIMIT 1
`

async function readFree(connection) {
  return connection.execute({
    sql: FREE_QUERY,
    args: [USER_ID],
  })
}

async function insertFree(connection, id, details) {
  await connection.execute({
    sql: `
      INSERT INTO gacha_history
        (id, user_id, cost_gems, reward_tier, reward_details)
      VALUES (?, ?, 0, 'common', ?)
    `,
    args: [id, USER_ID, details],
  })
}

function isLockError(error) {
  if (!error || typeof error.code !== 'string') return false

  return /^(SQLITE_BUSY|SQLITE_LOCKED)(?:_[A-Z0-9_]+)?$/.test(error.code)
}

async function withSharedConnections(callback) {
  const clients = []
  const active = new Set()
  const errors = []

  async function begin(connection) {
    await connection.execute('BEGIN IMMEDIATE')
    active.add(connection)
  }

  async function commit(connection) {
    await connection.execute('COMMIT')
    active.delete(connection)
  }

  async function rollback(connection) {
    await connection.execute('ROLLBACK')
    active.delete(connection)
  }

  try {
    const a = createClient({ url: URL })
    clients.push(a)
    const b = createClient({ url: URL })
    clients.push(b)

    for (const connection of clients) {
      assert.equal(connection.protocol, 'file')
      await connection.execute(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
      const timeout = await connection.execute('PRAGMA busy_timeout')
      assert.equal(Number(timeout.rows[0].timeout), BUSY_TIMEOUT_MS)

      const databases = await connection.execute('PRAGMA database_list')
      const main = databases.rows.find(row => row.name === 'main')
      assert.ok(main, 'Missing main database')
      assert.equal(main.file, '', 'Main database must be exclusively in memory')
    }

    await a.execute(`
      CREATE TABLE gacha_history (
        id INTEGER PRIMARY KEY,
        user_id TEXT NOT NULL,
        cost_gems INTEGER NOT NULL,
        reward_tier TEXT NOT NULL,
        reward_details TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `)

    await insertFree(a, 100, 'synthetic shared-memory probe')

    try {
      const probe = await b.execute(`
        SELECT reward_details FROM gacha_history WHERE id = 100
      `)
      assert.equal(probe.rows.length, 1)
      assert.equal(
        probe.rows[0].reward_details,
        'synthetic shared-memory probe'
      )
    } catch (cause) {
      throw new Error(
        'CAPABILITY LIMITATION: the two local SQLite connections did not ' +
        'demonstrate shared in-memory data; writer exclusion is not established.',
        { cause }
      )
    }

    await a.execute('DELETE FROM gacha_history WHERE id = 100')
    const empty = await b.execute('SELECT id FROM gacha_history')
    assert.equal(empty.rows.length, 0)

    await callback({ a, b, begin, commit, rollback })
  } catch (error) {
    errors.push(error)
  } finally {
    for (const connection of active) {
      try {
        await connection.execute('ROLLBACK')
      } catch (error) {
        errors.push(error)
      }
    }
    active.clear()

    if (clients.length > 0) {
      try {
        await clients[0].execute('DROP TABLE IF EXISTS gacha_history')
      } catch (error) {
        errors.push(error)
      }
    }

    for (const connection of clients.reverse()) {
      try {
        connection.close()
        assert.equal(connection.closed, true)
      } catch (error) {
        errors.push(error)
      }
    }
  }

  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Capability test or cleanup failed')
  }
}

async function assertWriterBlocked(t, connection, begin) {
  let beginError
  let decisiveQueryReached = false

  try {
    await begin(connection)
  } catch (error) {
    beginError = error
  }

  if (!beginError) {
    decisiveQueryReached = true
    await readFree(connection)
    assert.fail(
      'Writer B acquired BEGIN IMMEDIATE and reached the decisive query ' +
      'while writer A was still active'
    )
  }

  if (!isLockError(beginError)) {
    t.diagnostic('Unexpected acquisition error; this is not accepted as locking')
    throw beginError
  }

  assert.equal(decisiveQueryReached, false)
  t.diagnostic(
    `Expected local contention: code=${beginError.code}; ` +
    `rawCode=${beginError.rawCode ?? 'unavailable'}\n` +
    String(beginError.stack || beginError)
  )
}

test('two local in-memory connections share synthetic reads and writes',
  TEST_OPTIONS, async () => {
    await withSharedConnections(async ({ a, b }) => {
      await insertFree(a, 1, 'synthetic row from A')
      const fromA = await b.execute(`
        SELECT reward_details, typeof(created_at) AS storage_type
        FROM gacha_history WHERE id = 1
      `)
      assert.equal(fromA.rows.length, 1)
      assert.equal(fromA.rows[0].reward_details, 'synthetic row from A')
      assert.equal(fromA.rows[0].storage_type, 'integer')

      await insertFree(b, 2, 'synthetic row from B')
      const fromB = await a.execute(`
        SELECT reward_details FROM gacha_history WHERE id = 2
      `)
      assert.equal(fromB.rows.length, 1)
      assert.equal(fromB.rows[0].reward_details, 'synthetic row from B')
    })
  }
)

test('writer B cannot decide while A writes and sees the free row after commit',
  TEST_OPTIONS, async t => {
    await withSharedConnections(async ({ a, b, begin, commit }) => {
      await begin(a)
      assert.equal((await readFree(a)).rows.length, 0)
      await insertFree(a, 1, 'synthetic committed free row from A')

      await assertWriterBlocked(t, b, begin)
      await commit(a)

      // A new explicit attempt after contention, not an automatic handler retry.
      await begin(b)
      const recent = await readFree(b)
      assert.equal(recent.rows.length, 1)
      assert.equal(recent.rows[0].id, 1)
      await commit(b)

      const persisted = await a.execute(`
        SELECT id, reward_details FROM gacha_history ORDER BY id
      `)
      assert.equal(persisted.rows.length, 1)
      assert.equal(persisted.rows[0].id, 1)
      assert.equal(
        persisted.rows[0].reward_details,
        'synthetic committed free row from A'
      )
    })
  }
)

test('after A rolls back, B can register the only persisted free row',
  TEST_OPTIONS, async t => {
    await withSharedConnections(async ({ a, b, begin, commit, rollback }) => {
      await begin(a)
      assert.equal((await readFree(a)).rows.length, 0)
      await insertFree(a, 1, 'synthetic reverted free row from A')

      await assertWriterBlocked(t, b, begin)
      await rollback(a)

      // A new explicit attempt after contention, not an automatic handler retry.
      await begin(b)
      assert.equal((await readFree(b)).rows.length, 0)
      await insertFree(b, 2, 'synthetic committed free row from B')
      await commit(b)

      const persisted = await a.execute(`
        SELECT id, cost_gems, reward_details, typeof(created_at) AS storage_type
        FROM gacha_history ORDER BY id
      `)
      assert.equal(persisted.rows.length, 1)
      assert.equal(persisted.rows[0].id, 2)
      assert.equal(persisted.rows[0].cost_gems, 0)
      assert.equal(
        persisted.rows[0].reward_details,
        'synthetic committed free row from B'
      )
      assert.equal(persisted.rows[0].storage_type, 'integer')
    })
  }
)