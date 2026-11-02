// Real core and installed local libSQL engine; no .env or remote imports.
const assert = require('node:assert/strict')
const { test: nodeTest } = require('node:test')
const { spawnSync } = require('node:child_process')
const { readFileSync, mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { createClient, Sqlite3Transaction } = require('@libsql/client/sqlite3')
const Database = require('libsql')

const source = readFileSync(path.resolve(__dirname, '../lib/vip-payments.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const exportsObject = {}
vm.runInNewContext(compiled, {
  exports: exportsObject, setTimeout,
  require(name) { throw new Error(`Forbidden import: ${name}`) },
}, { timeout: 1000 })
const { applyVipPayment } = exportsObject
const migration = readFileSync(path.resolve(__dirname, '../migrations/001_vip_payment_records.sql'), 'utf8')
const USER = '123456789'
const BOT = '987654321'

// libsql's native prepared statements have no JS finalize/dispose API. Closing
// a Database does not prove all native statement/rows references are released.
// Own the file lifetime OUTSIDE the process that loads/uses SQLite: Windows
// releases every DB/WAL/SHM handle on process exit, independently of native GC.
// Keep one parent test per real case, propagating child failures before cleanup.
function test(name, callback) {
  if (process.env.VIP_SQLITE_CASE_DIRECTORY) return nodeTest(name, callback)
  return nodeTest(name, () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'taboo-vip-'))
    const errors = []
    try {
      const pattern = `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
      const result = spawnSync(process.execPath, [
        '--test', `--test-name-pattern=${pattern}`, __filename,
      ], {
        env: { ...process.env, VIP_SQLITE_CASE_DIRECTORY: directory },
        encoding: 'utf8',
      })
      if (result.error) errors.push(result.error)
      if (result.status !== 0) errors.push(new Error(
        `SQLite case exited ${result.status} (signal ${result.signal})\n${result.stdout}\n${result.stderr}`
      ))
    } catch (error) { errors.push(error) }
    // spawnSync has waited for process exit; no SQLite handle from this case
    // can remain owned by the worker. No retry, GC timing or ignored EPERM.
    try { rmSync(directory, { recursive: true }) } catch (error) { errors.push(error) }
    if (errors.length) throw new AggregateError(errors, `SQLite case failed: ${name}`)
  })
}

async function fixture(t) {
  const directory = process.env.VIP_SQLITE_CASE_DIRECTORY
  assert.ok(directory, 'SQLite fixtures must run in an owned child process')
  const url = `file:${path.join(directory, 'vip.db').replace(/\\/g, '/')}`
  const clients = []
  const transactions = []
  function connection() {
    const db = createClient({ url })
    assert.equal(db.protocol, 'file')
    clients.push(db)
    return db
  }
  const db = connection()
  t.after(() => {
    const errors = []
    for (const transaction of transactions) {
      try { transaction.close() } catch (error) { errors.push(error) }
    }
    for (const client of clients) {
      try { client.close() } catch (error) { errors.push(error) }
    }
    if (errors.length) throw new AggregateError(errors, 'SQLite fixture cleanup failed')
  })
  await db.executeMultiple(`
    CREATE TABLE subscriptions (
      id INTEGER PRIMARY KEY, telegram_id TEXT, plan TEXT, stars_paid INTEGER,
      telegram_charge_id TEXT UNIQUE, started_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT, status TEXT DEFAULT 'active'
    );
    CREATE TABLE star_purchases (id INTEGER PRIMARY KEY, note TEXT);
    INSERT INTO star_purchases VALUES (1, 'synthetic-untouched-gems');
  `)
  for (const sql of migration.split(';').map(s => s.trim()).filter(Boolean)) await db.execute(sql)

  // SDK 0.14 detaches the native connection when client.transaction() begins,
  // but Transaction.close() only rolls back; neither closes that native handle.
  // Own the handle explicitly and use the installed SDK's transaction class.
  function client(hook = {}) {
    return {
      async transaction(mode) {
        assert.equal(mode, 'write')
        const local = new Database(path.join(directory, 'vip.db'))
        clients.push(local)
        let real
        try {
          local.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 0; BEGIN IMMEDIATE')
          real = new Sqlite3Transaction(local, 'number')
          transactions.push(real)
        } catch (error) {
          local.close()
          clients.splice(clients.indexOf(local), 1)
          throw error
        }
        return {
          get closed() { return real.closed },
          async execute(stmt) {
            if (hook.execute) return hook.execute(stmt, real)
            return real.execute(stmt)
          },
          async commit() {
            if (hook.commit) return hook.commit(real)
            return real.commit()
          },
          async rollback() {
            if (hook.rollback) return hook.rollback(real)
            return real.rollback()
          },
          close() {
            try { real.close() } finally {
              local.close()
              clients.splice(clients.indexOf(local), 1)
              transactions.splice(transactions.indexOf(real), 1)
            }
          },
        }
      },
    }
  }
  async function seed(method = 'crypto', suffix = 'one', overrides = {}) {
    const plan = overrides.plan || 'weekly'
    const reference = method === 'stars'
      ? `vip_sub_${plan}_${USER}_${suffix}` : `VIP_${plan}_${USER}_${suffix}`
    const amount = method === 'stars' ? 250 : 2000000
    await db.execute({
      sql: `INSERT INTO vip_invoices
        (reference, telegram_id, payment_method, plan, days, expected_amount_units, currency)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [reference, USER, method, plan, overrides.days || 7, amount,
        method === 'stars' ? 'XTR' : 'USDT'],
    })
    if (method === 'stars') {
      const inserted = await db.execute({
        sql: `INSERT INTO vip_payment_inbox
          (bot_id, telegram_charge_id, invoice_reference, telegram_id, currency, paid_amount_units)
          VALUES (?, ?, ?, ?, 'XTR', ?)`,
        args: [BOT, `charge-${suffix}`, reference, USER, overrides.amount || amount],
      })
      return { method, inboxId: Number(inserted.lastInsertRowid) }
    }
    return {
      method, reference, telegramId: USER, plan, currency: 'USDT',
      paidAmountUnits: amount, paymentScope: 'synthetic-ton-mainnet',
      providerPaymentId: `transfer-${suffix}`, ...overrides,
    }
  }
  async function snapshot() {
    const result = {}
    for (const table of ['subscriptions', 'vip_processed_payments', 'vip_payment_inbox', 'star_purchases']) {
      result[table] = (await db.execute(`SELECT * FROM ${table} ORDER BY 1`)).rows.map(r => ({ ...r }))
    }
    return result
  }
  return { db, client, seed, snapshot }
}

for (const method of ['stars', 'crypto']) {
  test(`${method}: activation, permanent idempotency and untouched gems`, async t => {
    const f = await fixture(t)
    const input = await f.seed(method)
    const result = await applyVipPayment(f.client(), input)
    assert.equal(result.status, 'applied')
    const first = await f.snapshot()
    assert.equal(first.vip_processed_payments.length, 1)
    assert.equal(first.star_purchases[0].note, 'synthetic-untouched-gems')
    if (method === 'stars') assert.equal(first.vip_payment_inbox[0].status, 'applied')
    assert.equal((await applyVipPayment(f.client(), input)).status, 'already_applied')
    assert.deepEqual(await f.snapshot(), first)
  })
}

test('Stars requires exact amount; mismatches persist for review', async t => {
  const f = await fixture(t)
  for (const amount of [249, 251]) {
    const input = await f.seed('stars', String(amount), { amount })
    assert.equal((await applyVipPayment(f.client(), input)).reason, 'amount_mismatch')
    assert.equal((await applyVipPayment(f.client(), input)).reason, 'inbox_requires_review')
  }
  const state = await f.snapshot()
  assert.equal(state.subscriptions.length, 0)
  assert.ok(state.vip_payment_inbox.every(e => e.status === 'review_required'))
})

test('crypto tolerance and validation never write subscriptions on mismatch', async t => {
  const f = await fixture(t)
  const input = await f.seed()
  for (const [change, reason] of [
    [{ reference: 'unknown' }, 'invoice_not_found'],
    [{ telegramId: 'other' }, 'identity_mismatch'],
    [{ plan: 'monthly' }, 'plan_mismatch'],
    [{ currency: 'XTR' }, 'currency_mismatch'],
    [{ paidAmountUnits: 1998999 }, 'amount_mismatch'],
  ]) {
    assert.equal((await applyVipPayment(f.client(), { ...input, ...change })).reason, reason)
  }
  for (const amount of [0, -1, 1.5, NaN, Infinity]) {
    await assert.rejects(applyVipPayment(f.client(), { ...input, paidAmountUnits: amount }),
      e => e.code === 'invalid_input')
  }
  assert.equal((await f.snapshot()).subscriptions.length, 0)
  assert.equal((await applyVipPayment(f.client(), { ...input, paidAmountUnits: 1999000 })).status, 'applied')
  const overpaid = await f.seed('crypto', 'overpaid')
  assert.equal((await applyVipPayment(f.client(), { ...overpaid, paidAmountUnits: 3000000 })).status, 'applied')
})

test('reference and provider identity cannot be reused; A-B-A preserves days', async t => {
  const f = await fixture(t)
  const a = await f.seed('crypto', 'a')
  const b = await f.seed('crypto', 'b')
  const first = await applyVipPayment(f.client(), a)
  const second = await applyVipPayment(f.client(), b)
  assert.equal(Date.parse(second.expiresAt.replace(' ', 'T') + 'Z') -
    Date.parse(first.expiresAt.replace(' ', 'T') + 'Z'), 7 * 86400000)
  const state = await f.snapshot()
  assert.equal((await applyVipPayment(f.client(), a)).status, 'already_applied')
  assert.equal((await applyVipPayment(f.client(), { ...a, providerPaymentId: 'new-payment' })).reason,
    'payment_identity_conflict')
  const c = await f.seed('crypto', 'c')
  assert.equal((await applyVipPayment(f.client(), { ...c, providerPaymentId: a.providerPaymentId })).reason,
    'payment_identity_conflict')
  assert.deepEqual(await f.snapshot(), state)
})

test('renewals preserve Stars fields and crypto rewrite behavior', async t => {
  const f = await fixture(t)
  await f.db.execute(`INSERT INTO subscriptions
    (id, telegram_id, plan, stars_paid, telegram_charge_id, expires_at)
    VALUES (1, '${USER}', 'monthly', 650, 'legacy', '2090-01-01 00:00:00')`)
  const stars = await f.seed('stars')
  assert.equal((await applyVipPayment(f.client(), stars)).expiresAt, '2090-01-08 00:00:00')
  let row = (await f.snapshot()).subscriptions[0]
  assert.equal(row.plan, 'monthly')
  assert.equal(row.stars_paid, 650)
  const crypto = await f.seed('crypto')
  assert.equal((await applyVipPayment(f.client(), crypto)).expiresAt, '2090-01-15 00:00:00')
  row = (await f.snapshot()).subscriptions[0]
  assert.equal(row.plan, 'weekly')
  assert.equal(row.stars_paid, 0)
})

test('cancelled and expired rows remain unchanged during new activation', async t => {
  const f = await fixture(t)
  await f.db.execute(`INSERT INTO subscriptions
    (id, telegram_id, plan, stars_paid, telegram_charge_id, expires_at, status)
    VALUES (1, '${USER}', 'weekly', 250, 'cancelled', '2090-01-01 00:00:00', 'cancelled'),
           (2, '${USER}', 'weekly', 250, 'expired', '2000-01-01 00:00:00', 'active')`)
  const before = (await f.snapshot()).subscriptions
  await applyVipPayment(f.client(), await f.seed())
  const after = (await f.snapshot()).subscriptions
  assert.equal(after.length, 3)
  assert.deepEqual(after.slice(0, 2), before)
})

test('all four persisted plan periods are credited', async t => {
  const f = await fixture(t)
  for (const [plan, days] of [['weekly', 7], ['monthly', 30], ['quarterly', 90], ['annual', 365]]) {
    const result = await applyVipPayment(f.client(), await f.seed('crypto', plan, { plan, days }))
    assert.equal(result.days, days)
  }
})

test('FK disabled or malformed fails before any economic write', async t => {
  const f = await fixture(t)
  const input = await f.seed()
  for (const rows of [[{ foreign_keys: 0 }], [], [{ foreign_keys: '1' }]]) {
    let calls = 0
    const client = f.client({ execute: async stmt => {
      calls++
      assert.equal(stmt.sql, 'PRAGMA foreign_keys')
      return { rows }
    } })
    await assert.rejects(applyVipPayment(client, input), e => e.code === 'foreign_keys_disabled')
    assert.equal(calls, 1)
  }
  assert.equal((await f.snapshot()).subscriptions.length, 0)
})

test('failures after subscription, payment and inbox writes rollback completely', async t => {
  const f = await fixture(t)
  const input = await f.seed('stars')
  const before = await f.snapshot()
  for (const pattern of [/INSERT INTO subscriptions/, /INSERT INTO vip_processed_payments/,
    /SET status = 'applied'/]) {
    const failure = new Error('synthetic-write-failure')
    const client = f.client({ execute: async (stmt, real) => {
      const result = await real.execute(stmt)
      if (pattern.test(stmt.sql)) throw failure
      return result
    } })
    await assert.rejects(applyVipPayment(client, input), e => e === failure)
    assert.deepEqual(await f.snapshot(), before)
  }
})

test('commit response loss reconciles without another credit', async t => {
  const f = await fixture(t)
  const input = await f.seed('stars')
  const failure = new Error('synthetic-response-loss')
  await assert.rejects(applyVipPayment(f.client({ commit: async real => {
    await real.commit()
    throw failure
  } }), input), e => e.code === 'commit_uncertain' && e.originalError === failure)
  const state = await f.snapshot()
  assert.equal(state.vip_payment_inbox[0].status, 'applied')
  assert.equal((await applyVipPayment(f.client(), input)).status, 'already_applied')
  assert.deepEqual(await f.snapshot(), state)
})

test('failed commit before persistence leaves pending recoverable', async t => {
  const f = await fixture(t)
  const input = await f.seed('stars')
  await assert.rejects(applyVipPayment(f.client({ commit: async () => {
    throw new Error('synthetic-commit-failure')
  } }), input), e => e.code === 'commit_uncertain')
  assert.equal((await f.snapshot()).vip_payment_inbox[0].status, 'pending')
  assert.equal((await applyVipPayment(f.client(), input)).status, 'applied')
})

test('rollback failures preserve original error and close transaction', async t => {
  const f = await fixture(t)
  const input = await f.seed()
  const original = new Error('original')
  const cleanup = new Error('rollback')
  await assert.rejects(applyVipPayment(f.client({
    execute: async () => { throw original },
    rollback: async () => { throw cleanup },
  }), input), e => e.code === 'rollback_failed' && e.originalError === original &&
    e.cleanupErrors[0] === cleanup)
  assert.equal((await applyVipPayment(f.client(), input)).status, 'applied')
})

test('simultaneous identical payments credit exactly once', async t => {
  const f = await fixture(t)
  const input = await f.seed('stars')
  const results = await Promise.all([
    applyVipPayment(f.client(), input), applyVipPayment(f.client(), input),
  ])
  assert.deepEqual(results.map(r => r.status).sort(), ['already_applied', 'applied'])
  const state = await f.snapshot()
  assert.equal(state.subscriptions.length, 1)
  assert.equal(state.vip_processed_payments.length, 1)
})

test('simultaneous Stars and crypto renewals retain both periods', async t => {
  const f = await fixture(t)
  await f.db.execute(`INSERT INTO subscriptions
    (id, telegram_id, plan, stars_paid, telegram_charge_id, expires_at)
    VALUES (1, '${USER}', 'weekly', 250, 'legacy', '2090-01-01 00:00:00')`)
  const stars = await f.seed('stars')
  const crypto = await f.seed('crypto')
  await Promise.all([
    applyVipPayment(f.client(), stars), applyVipPayment(f.client(), crypto),
  ])
  const state = await f.snapshot()
  assert.equal(state.subscriptions.length, 1)
  assert.equal(state.subscriptions[0].expires_at, '2090-01-15 00:00:00')
  assert.equal(state.vip_processed_payments.length, 2)
})