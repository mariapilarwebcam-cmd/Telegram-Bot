const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { createClient, Sqlite3Transaction } = require('@libsql/client/sqlite3')
const Database = require('libsql')
const root = path.resolve(__dirname, '..')
function load(file, mocks = {}) {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  vm.runInNewContext(code, { exports, Buffer, setTimeout, Date, process, AbortSignal,
    fetch: (...args) => global.fetch(...args), require: name => {
      if (name in mocks) return mocks[name]
      if (name.startsWith('.')) return load(path.join(path.dirname(file), name + '.ts'), mocks)
      return require(name)
    } })
  return exports
}
async function fixture(t) {
  const native = new Database(':memory:')
  native.exec('PRAGMA foreign_keys=ON')
  const db = {
    execute: async input => {
      const { sql, args = [] } = typeof input === 'string' ? { sql: input } : input
      const stmt = native.prepare(sql)
      if (stmt.columns().length) return { rows: stmt.all(...args), rowsAffected: 0 }
      const result = stmt.run(...args)
      return { rows: [], rowsAffected: result.changes }
    },
    executeMultiple: async sql => native.exec(sql),
    transaction: async () => { native.exec('BEGIN IMMEDIATE'); return new Sqlite3Transaction(native, 'number') },
  }
  t.after(() => native.close())
  await db.executeMultiple(`PRAGMA foreign_keys=ON;
    CREATE TABLE subscriptions(id INTEGER PRIMARY KEY, telegram_id TEXT, plan TEXT, stars_paid INTEGER,
      telegram_charge_id TEXT UNIQUE, expires_at TEXT, status TEXT);
    ${fs.readFileSync(path.join(root, 'migrations/001_vip_payment_records.sql'), 'utf8')}`)
  async function seed(i, amount = 250) {
    const ref = `vip_sub_weekly_123_${i}`
    await db.execute({ sql: `INSERT INTO vip_invoices(reference,telegram_id,payment_method,plan,days,expected_amount_units,currency)
      VALUES (?,'123','stars','weekly',7,250,'XTR')`, args: [ref] })
    await db.execute({ sql: `INSERT INTO vip_payment_inbox(bot_id,telegram_charge_id,invoice_reference,telegram_id,currency,paid_amount_units)
      VALUES ('999',?,?,'123','XTR',?)`, args: [`charge-${i}`, ref, amount] })
  }
  return { db, seed }
}
const worker = load('lib/vip-inbox.ts')
test('worker rejects absent/wrong secrets and authenticates exact bearer', () => {
  assert.equal(worker.authorizedVipWorker(null, undefined), false)
  assert.equal(worker.authorizedVipWorker('Bearer wrong', 'secret'), false)
  assert.equal(worker.authorizedVipWorker('Bearer secret', 'secret'), true)
})
test('immediate + concurrent replay + recovery credit once; drains multiple batches', async t => {
  const { db, seed } = await fixture(t)
  for (let i = 1; i <= 28; i++) await seed(i)
  const first = await worker.processVipInbox(db, '999', 1)
  assert.equal(first.applied, 1)
  await Promise.all([worker.processVipInbox(db, '999', 1), worker.processVipInbox(db, '999', 1)])
  const recovered = await worker.processVipInbox(db, '999')
  assert.equal(recovered.applied, 27)
  assert.equal((await db.execute('SELECT count(*) AS n FROM vip_processed_payments')).rows[0].n, 28)
  assert.equal((await db.execute('SELECT sum(attempt_count) AS n FROM vip_payment_inbox')).rows[0].n, 28)
})
test('amount mismatch requires review, never credit', async t => {
  const { db, seed } = await fixture(t)
  await seed(1, 1)
  assert.equal((await worker.processVipInbox(db, '999')).review_required, 1)
  assert.equal((await db.execute('SELECT count(*) AS n FROM subscriptions')).rows[0].n, 0)
})
test('unknown constraint is recoverable; explicit permanent core error needs review', async t => {
  const { db, seed } = await fixture(t)
  await seed(1)
  for (const [code, status] of [['SQLITE_CONSTRAINT_UNIQUE', 'pending'], ['invalid_inbox_state', 'review_required']]) {
    const w = load('lib/vip-inbox.ts', { './vip-payments': { applyVipPayment: async () => { throw { code } } } })
    await db.execute('UPDATE vip_payment_inbox SET next_attempt_at=NULL')
    await w.processVipInbox(db, '999')
    assert.equal((await db.execute('SELECT status FROM vip_payment_inbox')).rows[0].status, status)
  }
})
test('uncertain committed attempt cannot reset applied receipt', async t => {
  const { db, seed } = await fixture(t)
  await seed(1)
  const core = load('lib/vip-payments.ts')
  const w = load('lib/vip-inbox.ts', { './vip-payments': { applyVipPayment: async (...args) => {
    await core.applyVipPayment(...args); throw { code: 'commit_uncertain' }
  } } })
  await w.processVipInbox(db, '999')
  assert.equal((await db.execute('SELECT status FROM vip_payment_inbox')).rows[0].status, 'applied')
  assert.equal((await worker.processVipInbox(db, '999')).applied, 0)
})
test('discovery paginates and does not cap matching candidates at two', async () => {
  const { discoverVipTrace } = load('lib/vip-ton-discovery.ts')
  const calls = []
  const fetcher = async url => { calls.push(url); return { ok: true, json: async () => ({
    events: Array.from({ length: 3 }, (_, i) => ({ event_id: String(i + 1).repeat(64), actions: [{ JettonTransfer: { comment: 'ref' } }] })),
    next_from: '12345',
  }) } }
  let cursor = null
  for (let i = 0; i < 3; i++) {
    const result = await discoverVipTrace(fetcher, 'recipient', 'ref', undefined, cursor)
    assert.equal(result.traceId, String(i + 1).repeat(64)); cursor = result.cursor
  }
  const next = await discoverVipTrace(fetcher, 'recipient', 'ref', undefined, cursor)
  await discoverVipTrace(fetcher, 'recipient', 'ref', undefined, next.cursor)
  assert.match(calls.at(-1), /before_lt=12345/)
})

test('internal routes authenticate before body or payment reads', async () => {
  for (const [file, method, secret] of [
    ['app/api/bot/vip-payments/route.ts', 'POST', 'VIP_PROCESSOR_SECRET'],
    ['app/api/cron/vip-payments/route.ts', 'GET', 'CRON_SECRET'],
  ]) {
    let accesses = 0
    const route = load(file, {
      'next/server': { NextResponse: { json: (data, init) => ({ data, status: init?.status || 200 }) } },
      '@/lib/turso': { db: { execute: () => { accesses++; throw Error('unexpected') } } },
      '@/lib/vip-inbox': worker,
    })
    const saved = process.env[secret]
    delete process.env[secret]
    const result = await route[method]({ headers: new Headers(), json: () => { accesses++; throw Error('unexpected') } })
    if (saved !== undefined) process.env[secret] = saved
    assert.equal(result.status, 401)
    assert.equal(accesses, 0)
  }
})

test('crypto integration loads immutable invoice and only applies verified evidence', async t => {
  const { db } = await fixture(t)
  const ref = 'VIP_weekly_123_one'
  await db.execute({ sql: `INSERT INTO vip_invoices(reference,telegram_id,payment_method,plan,days,expected_amount_units,currency)
    VALUES (?,'123','crypto','weekly',7,2000000,'USDT')`, args: [ref] })
  let verifiedInvoice
  let accepted = false
  const integration = load('lib/vip-subscription.ts', {
    './ton-vip-verifier': { verifyTonVipPayment: async (_deps, invoice) => {
      verifiedInvoice = invoice
      return accepted ? { status: 'verified', evidence: { method: 'crypto', reference: ref,
        telegramId: '123', plan: 'weekly', currency: 'USDT', paidAmountUnits: 2000000,
        paymentScope: 'ton:test-synthetic', providerPaymentId: 'unique-transfer' } }
        : { status: 'rejected', reason: 'unproven' }
    } },
  })
  const body = { reference: ref, plan: 'weekly', trace_id: 'a'.repeat(64), paidAmountUnits: 999999999 }
  assert.equal((await integration.confirmVipCrypto(db, '123', body, 'recipient')).status, 'pending')
  assert.equal(verifiedInvoice.expectedAmountUnits, 2000000)
  assert.equal((await db.execute('SELECT count(*) AS n FROM subscriptions')).rows[0].n, 0)
  accepted = true
  assert.equal((await integration.confirmVipCrypto(db, '123', body, 'recipient')).status, 'paid')
  assert.equal((await integration.confirmVipCrypto(db, '123', body, 'recipient')).already, true)
  assert.equal((await integration.confirmVipCrypto(db, '456', body, 'recipient')).status, 'review_required')
  assert.equal((await db.execute('SELECT count(*) AS n FROM vip_processed_payments')).rows[0].n, 1)
})

test('Stars confirmation never substitutes an unrelated active subscription', async () => {
  const route = load('app/api/subscription/route.ts', {
    'next/server': { NextResponse: { json: (data, init) => ({ data, status: init?.status || 200 }) } },
    '@/lib/db-queries': { ensureUser: async () => ({}), getActiveSubscription: async () => { throw Error('must not read active VIP') } },
    '@/lib/turso': { db: {} },
    '@/lib/constants': { VIP_PLANS: [], usdtToUnits: n => n },
    '@/lib/vip-subscription': { findCreditedVip: async () => undefined },
  })
  const result = await route.POST({ headers: new Headers({ 'x-telegram-id-validated': '123' }),
    json: async () => ({ action: 'confirm', reference: 'vip_sub_weekly_123_one' }) })
  assert.equal(result.data.status, 'pending')
  assert.equal(result.data.ok, false)
  assert.equal(result.data.subscription, undefined)
})

test('subscription middleware overwrites client identity after signed authentication', () => {
  const middleware = fs.readFileSync(path.join(root, 'middleware.ts'), 'utf8')
  assert.ok(middleware.indexOf('await authenticateTelegramRequest(req)') <
    middleware.indexOf("requestHeaders.set('x-telegram-id-validated', authentication.telegramId)"))
  assert.doesNotMatch(middleware.slice(middleware.indexOf('const PUBLIC_ENDPOINTS'), middleware.indexOf('function getClientIp')), /subscription/)
  const auth = fs.readFileSync(path.join(root, 'lib/telegram-auth.ts'), 'utf8')
  assert.match(auth, /await validateTelegramInitData\(initData\)/)
  assert.match(auth, /telegramId: String\(data.user.id\)/)
})