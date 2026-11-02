// Handler real, dependencias simuladas: sin .env, Turso ni proveedores reales.
// Fixtures económicas sintéticas: no certifican precios productivos, atomicidad,
// restricciones UNIQUE, concurrencia real ni validez de eventos en blockchain.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const ID = '123456789'
const OTHER = '999999999'
const REFERRER = '777777777'
const AUTHORIZATION = 'tma synthetic-mocked-init-data'
const WALLET = 'synthetic-recipient-wallet'
const TOKEN = 'synthetic-tonapi-token'
const MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
const INITIAL = { telegram_id: ID, gems: 10, purchased_gems: 4, bonus_gems: 7 }
const referenceFor = (type = 'gems', index = '0', id = ID) =>
  `TABOO_${id}_${type}_${index}_1800000000000`
const copy = value => JSON.parse(JSON.stringify(value))
const normalize = sql => sql.replace(/\s+/g, ' ').trim()
const CREDIT_SQL = normalize(`
  UPDATE users
  SET bonus_gems = COALESCE(bonus_gems, 0) + ?,
      hook_messages_remaining = 0,
      updated_at = datetime('now')
  WHERE telegram_id = ? RETURNING bonus_gems
`)

const routePath = path.resolve(__dirname, '../app/api/check-crypto-payment/route.ts')
const compiled = ts.transpileModule(readFileSync(routePath, 'utf8'), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText

function authenticated() {
  return {
    ok: true,
    telegramId: ID,
    data: {
      authDate: new Date(1800000000000),
      user: { id: Number(ID), first_name: 'Verified synthetic user' },
    },
  }
}

function action(reference, amount = '2000000', master = MASTER) {
  return {
    type: 'JettonTransfer',
    JettonTransfer: { comment: reference, amount, jetton: { address: master } },
  }
}

function loadRoute(t, options = {}) {
  const calls = { auth: [], body: 0, order: [], business: [], logs: [], forbidden: [] }
  const buyer = { ...INITIAL, referred_by: options.referred ? REFERRER : null }
  const users = new Map([[ID, buyer]])
  if (options.referred && !options.missingReferrer) {
    users.set(REFERRER, { telegram_id: REFERRER, gems: 20 })
  }
  const unique = new Set(options.uniqueBuyers || [])

  function forbidden(operation) {
    calls.forbidden.push(operation)
    throw new Error(`Forbidden operation: ${operation}`)
  }

  function record(name, args) {
    calls.order.push(name)
    calls.business.push({ name, args: copy(args) })
    if (options.failAt === name) throw options.failure || new Error('synthetic failure')
  }

  const queries = {
    async getPurchaseByChargeId(reference) {
      record('getPurchaseByChargeId', [reference])
      return options.existing ? { id: 1 } : null
    },
    async getUser(id) {
      record('getUser', [id])
      if (id !== ID && id !== REFERRER) return forbidden('unexpected user identity')
      if (id === ID && options.missingUser) return null
      return users.has(id) ? { ...users.get(id) } : null
    },
    async getLastPurchase(id) {
      record('getLastPurchase', [id])
      assert.equal(id, ID)
      return options.prior ? { id: 2 } : null
    },
    async insertStarPurchase(purchase) {
      record('insertStarPurchase', [purchase])
      return options.inserted === false ? null : { id: 3 }
    },
    async incrementGemsAndPurchased(id, amount) {
      record('incrementGemsAndPurchased', [id, amount])
      assert.equal(id, ID)
      buyer.gems += amount
      buyer.purchased_gems += amount
      return { new_gems: buyer.gems, new_purchased: buyer.purchased_gems }
    },
    async insertGemTransaction(transaction) {
      record('insertGemTransaction', [transaction])
    },
    async getUniqueBuyers(id) {
      record('getUniqueBuyers', [id])
      assert.equal(id, REFERRER)
      return unique
    },
    async incrementGems(id, amount) {
      record('incrementGems', [id, amount])
      assert.equal(id, REFERRER)
      users.get(id).gems += amount
    },
    async incrementPayingReferrals(id, count) {
      record('incrementPayingReferrals', [id, count])
    },
    async insertReferralCommission(commission) {
      record('insertReferralCommission', [commission])
    },
  }

  const gems = Object.freeze({ usdt: 2, fixtureFinal: 101 })
  const messages = Object.freeze({ usdt: 2, fixtureFinal: 35 })
  const hybrid = Object.freeze({ usdt: 2, crypto_final_gems: 47, crypto_final_messages: 20 })
  const constants = {
    CRYPTO_PACKAGES: Object.freeze([gems, Object.freeze({ ...gems, first_time_only: true })]),
    MESSAGE_PACKAGES: Object.freeze([messages]),
    HYBRID_PACKAGES: Object.freeze([hybrid]),
    getFinalCryptoGems(pkg) {
      record('getFinalCryptoGems', [pkg])
      assert.ok(pkg === gems || pkg === constants.CRYPTO_PACKAGES[1])
      return pkg.fixtureFinal
    },
    getFinalCryptoMessages(pkg) {
      record('getFinalCryptoMessages', [pkg])
      assert.equal(pkg, messages)
      return pkg.fixtureFinal
    },
    REFERRAL_PURCHASE_COMMISSION_PCT: 10,
    REFERRAL_TOP_TIER_THRESHOLD: 3,
    REFERRAL_TOP_TIER_PCT: 15,
    REFERRAL_ELITE_TIER_THRESHOLD: 5,
    REFERRAL_ELITE_TIER_PCT: 20,
  }

  const dependencies = {
    'next/server': {
      NextResponse: {
        json(body, init) {
          return new Response(JSON.stringify(body), {
            ...init, headers: { 'content-type': 'application/json' },
          })
        },
      },
    },
    '@/lib/telegram-auth': {
      async authenticateTelegramRequest(request) {
        calls.auth.push(request)
        calls.order.push('authenticate')
        return options.authenticate ? options.authenticate(request) : authenticated()
      },
    },
    '@/lib/db-queries': queries,
    '@/lib/constants': constants,
    '@/lib/turso': {
      async queryOne(sql, args) {
        record('queryOne', [sql, Array.from(args)])
        assert.equal(normalize(sql), CREDIT_SQL)
        assert.equal(args[1], ID)
        buyer.bonus_gems += args[0]
        buyer.hook_messages_remaining = 0
        return { bonus_gems: buyer.bonus_gems }
      },
    },
  }

  const exports = {}
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      if (!Object.prototype.hasOwnProperty.call(dependencies, name)) {
        return forbidden(`require:${name}`)
      }
      return dependencies[name]
    },
    process: {
      env: new Proxy({}, {
        get(_target, key) {
          if (key === 'TONAPI_KEY') return options.noToken ? '' : TOKEN
          if (key === 'TON_RECIPIENT_WALLET') return WALLET
          return forbidden(`env:${String(key)}`)
        },
        set() { return forbidden('env-write') },
      }),
    },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [
      level, (...args) => calls.logs.push({ level, args }),
    ])),
    async fetch(url, init) {
      record('fetch', [url, init])
      assert.equal(calls.business.filter(call => call.name === 'fetch').length, 1)
      assert.equal(url, `https://tonapi.io/v2/accounts/${WALLET}/events?limit=1000`)
      assert.deepEqual(copy(init), {
        headers: options.noToken
          ? { Accept: 'application/json' }
          : { Accept: 'application/json', Authorization: `Bearer ${TOKEN}` },
        cache: 'no-store',
      })
      return {
        ok: options.httpOk !== false,
        status: options.httpOk === false ? 503 : 200,
        async json() {
          if (options.jsonError) throw options.jsonError
          return { events: [{ actions: options.actions || [action(options.reference || referenceFor())] }] }
        },
      }
    },
    XMLHttpRequest: function () { return forbidden('XMLHttpRequest') },
    WebSocket: function () { return forbidden('WebSocket') },
  }, { filename: routePath, timeout: 1000 })

  t.after(() => assert.deepEqual(calls.forbidden, []))
  assert.equal(typeof exports.POST, 'function')

  function requestFor(body = { reference: options.reference || referenceFor() }, settings = {}) {
    const headers = new Headers({ 'content-type': 'application/json' })
    if (settings.authorization !== false) headers.set('authorization', settings.authorization || AUTHORIZATION)
    for (const [key, value] of Object.entries(settings.headers || {})) headers.set(key, value)
    const request = new Request(
      `https://example.invalid/api/check-crypto-payment${settings.query || ''}`,
      {
        method: 'POST', headers,
        body: Object.prototype.hasOwnProperty.call(settings, 'rawBody')
          ? settings.rawBody : JSON.stringify(body),
      }
    )
    const json = request.json.bind(request)
    Object.defineProperty(request, 'json', {
      value() {
        calls.body += 1
        calls.order.push('body')
        return json()
      },
    })
    return request
  }

  return { POST: exports.POST, requestFor, calls, buyer, users, unique }
}

async function responseIs(response, status, body) {
  assert.ok(response instanceof Response)
  assert.equal(response.status, status)
  assert.deepEqual(await response.json(), body)
}

const named = (calls, name) => calls.business.filter(call => call.name === name)
const argsFor = (calls, name) => named(calls, name).map(call => call.args)
function noWrites(calls) {
  for (const name of [
    'insertStarPurchase', 'incrementGemsAndPurchased', 'queryOne',
    'insertGemTransaction', 'incrementGems', 'incrementPayingReferrals',
    'insertReferralCommission',
  ]) assert.equal(named(calls, name).length, 0, name)
}

function paidBody(type) {
  const gems = type === 'gems' ? 101 : type === 'hybrid' ? 47 : 0
  const messages = type === 'messages' ? 35 : type === 'hybrid' ? 20 : 0
  return {
    status: 'paid', amount_added: type === 'messages' ? messages : gems,
    gems_added: gems, messages_added: messages,
    is_messages: type === 'messages', is_hybrid: type === 'hybrid',
    remaining_gems: 10 + gems, remaining_purchased_gems: 4 + gems,
    remaining_bonus_gems: 7 + messages,
  }
}

const alreadyBody = {
  status: 'paid', already: true,
  remaining_gems: 10, remaining_purchased_gems: 4, remaining_bonus_gems: 7,
}

test('rejects absent or invalid credentials and forged headers before reading body', async t => {
  for (const authorization of [false, 'tma synthetic-invalid']) {
    const fixture = loadRoute(t, {
      authenticate(request) {
        assert.equal(request.headers.get('authorization'), authorization || null)
        return { ok: false, status: 401, error: 'No autorizado' }
      },
    })
    const request = fixture.requestFor({}, {
      authorization, rawBody: '{invalid-json',
      headers: { 'x-telegram-id-validated': OTHER },
    })
    await responseIs(await fixture.POST(request), 401, { error: 'No autorizado' })
    assert.deepEqual(fixture.calls.order, ['authenticate'])
    assert.equal(request.bodyUsed, false)
    assert.equal(fixture.calls.body, 0)
    assert.deepEqual(fixture.calls.business, [])
    assert.deepEqual(fixture.calls.logs, [])
  }
})

test('preserves authentication 503 and hides unexpected authentication exceptions', async t => {
  for (const unexpected of [false, true]) {
    const fixture = loadRoute(t, {
      authenticate() {
        if (unexpected) throw new Error('private synthetic authentication detail')
        return { ok: false, status: 503, error: 'Servicio de autenticación no disponible' }
      },
    })
    const request = fixture.requestFor()
    await responseIs(await fixture.POST(request), unexpected ? 500 : 503, {
      error: unexpected ? 'Error interno del servidor' : 'Servicio de autenticación no disponible',
    })
    assert.deepEqual(fixture.calls.order, ['authenticate'])
    assert.equal(request.bodyUsed, false)
    assert.deepEqual(fixture.calls.business, [])
    assert.deepEqual(fixture.calls.logs, [])
  }
})

test('waits for authentication before consuming body or performing business operations', async t => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const fixture = loadRoute(t, { authenticate: () => gate, existing: true })
  const request = fixture.requestFor()
  const pending = fixture.POST(request)
  const settlement = Promise.allSettled([pending])
  try {
    assert.deepEqual(fixture.calls.order, ['authenticate'])
    assert.equal(fixture.calls.body, 0)
    assert.equal(request.bodyUsed, false)
    assert.deepEqual(fixture.calls.business, [])
  } finally {
    release(authenticated())
    await settlement
  }
  await responseIs(await pending, 200, alreadyBody)
  assert.deepEqual(fixture.calls.order, ['authenticate', 'body', 'getPurchaseByChargeId', 'getUser'])
})

test('uses verified identity despite contradictory header, body and URL identities', async t => {
  const fixture = loadRoute(t, { existing: true })
  const request = fixture.requestFor({
    reference: referenceFor(), telegram_id: OTHER, user_id: OTHER,
    user: { id: Number(OTHER) },
  }, {
    headers: { 'x-telegram-id-validated': OTHER }, query: `?telegram_id=${OTHER}`,
  })
  await responseIs(await fixture.POST(request), 200, alreadyBody)
  assert.equal(fixture.calls.auth[0], request)
  assert.deepEqual(argsFor(fixture.calls, 'getUser'), [[ID]])
  noWrites(fixture.calls)
})

test('rejects another user reference before any business operation', async t => {
  const fixture = loadRoute(t)
  await responseIs(await fixture.POST(fixture.requestFor({ reference: referenceFor('gems', '0', OTHER) }, {
    headers: { 'x-telegram-id-validated': OTHER },
  })), 403, { error: 'Reference no coincide con la sesión' })
  assert.deepEqual(fixture.calls.business, [])
  assert.deepEqual(fixture.calls.order, ['authenticate', 'body'])
})

test('preserves reference, package and invalid JSON validation responses', async t => {
  const cases = [
    [{}, 'Reference requerido'],
    [{ reference: 123 }, 'Reference requerido'],
    [{ reference: 'invalid' }, 'Reference inválido'],
    [{ reference: referenceFor('invalid') }, 'package_type inválido'],
    [{ reference: referenceFor('gems', '-1') }, 'Package index inválido'],
    [{ reference: referenceFor('gems', '2') }, 'Package index inválido'],
    [{ reference: referenceFor('gems', 'NaN') }, 'Package index inválido'],
  ]
  for (const [body, error] of cases) {
    const fixture = loadRoute(t)
    await responseIs(await fixture.POST(fixture.requestFor(body)), 400, { error })
    assert.deepEqual(fixture.calls.business, [])
  }
  const fixture = loadRoute(t)
  await responseIs(await fixture.POST(fixture.requestFor({}, { rawBody: '{invalid-json' })), 400, {
    error: 'Reference requerido',
  })
  assert.deepEqual(fixture.calls.business, [])
})

test('preserves the business TypeError response for JSON null', async t => {
  const fixture = loadRoute(t)
  const response = await fixture.POST(fixture.requestFor(null))
  const logged = fixture.calls.logs.find(entry => entry.level === 'error')
  assert.equal(logged.args[0], '[check-crypto-payment] Error:')
  assert.equal(logged.args[1].name, 'TypeError')
  await responseIs(response, 500, { error: logged.args[1].message })
  assert.deepEqual(fixture.calls.business, [])
})

test('preserves pending responses without writes or automatic provider retries', async t => {
  const reference = referenceFor()
  const cases = [
    [{ httpOk: false }, { status: 'pending', reason: 'tonapi_error' }],
    [{ actions: [] }, { status: 'pending' }],
    [{ actions: [{ type: 'Other' }, { type: 'JettonTransfer' }, action('different'), action(reference, '2000000', 'wrong-master')] }, { status: 'pending' }],
    [{ actions: [action(reference, 'invalid')] }, { status: 'pending', reason: 'invalid_amount' }],
    [{ actions: [action(reference, 0)] }, { status: 'pending', reason: 'invalid_amount' }],
    [{ actions: [action(reference, '1998999')] }, { status: 'pending', reason: 'amount_mismatch' }],
  ]
  for (const [options, expected] of cases) {
    const fixture = loadRoute(t, options)
    await responseIs(await fixture.POST(fixture.requestFor()), 200, expected)
    assert.deepEqual(fixture.calls.order, ['authenticate', 'body', 'getPurchaseByChargeId', 'fetch'])
    assert.deepEqual(argsFor(fixture.calls, 'getPurchaseByChargeId'), [[reference]])
    noWrites(fixture.calls)
  }
})

for (const type of ['gems', 'messages', 'hybrid']) {
  test(`credits ${type} with unchanged purchase, ledger and response calculations`, async t => {
    const reference = referenceFor(type)
    const fixture = loadRoute(t, { reference })
    await responseIs(await fixture.POST(fixture.requestFor()), 200, paidBody(type))
    assert.deepEqual(argsFor(fixture.calls, 'insertStarPurchase'), [[{
      telegram_id: ID, stars_amount: 0,
      gems_amount: type === 'messages' ? 0 : type === 'hybrid' ? 47 : 101,
      is_first_purchase: true, telegram_charge_id: reference,
      payment_method: type === 'hybrid' ? 'crypto_hybrid' : type === 'messages' ? 'crypto_messages' : 'crypto',
    }]])
    assert.deepEqual(argsFor(fixture.calls, 'incrementGemsAndPurchased'),
      type === 'messages' ? [] : [[ID, type === 'hybrid' ? 47 : 101]])
    const sql = argsFor(fixture.calls, 'queryOne')
    assert.equal(sql.length, type === 'gems' ? 0 : 1)
    if (sql.length) {
      assert.equal(normalize(sql[0][0]), CREDIT_SQL)
      assert.deepEqual(sql[0][1], [type === 'messages' ? 35 : 20, ID])
      assert.equal(fixture.buyer.hook_messages_remaining, 0)
    }
    const description = type === 'hybrid'
      ? `Compra crypto híbrida 2 USDT - 47 gemas + 20 mensajes (${reference})`
      : type === 'messages'
        ? `Compra crypto 2 USDT - 35 mensajes (${reference})`
        : `Compra crypto 2 USDT - 101 gemas (${reference})`
    assert.deepEqual(argsFor(fixture.calls, 'insertGemTransaction'), [[{
      telegram_id: ID, amount: type === 'messages' ? 0 : type === 'hybrid' ? 47 : 101,
      transaction_type: type === 'hybrid' ? 'crypto_purchase_hybrid' : type === 'messages' ? 'crypto_purchase_messages' : 'crypto_purchase',
      description,
    }]])
    const creditSteps = type === 'hybrid'
      ? ['incrementGemsAndPurchased', 'queryOne']
      : [type === 'messages' ? 'queryOne' : 'incrementGemsAndPurchased']
    const calculation = type === 'hybrid' ? []
      : [type === 'messages' ? 'getFinalCryptoMessages' : 'getFinalCryptoGems']
    assert.deepEqual(fixture.calls.order, [
      'authenticate', 'body', 'getPurchaseByChargeId', 'fetch',
      'getLastPurchase', 'getUser', ...calculation, 'insertStarPurchase',
      ...creditSteps, 'insertGemTransaction', 'getUser',
    ])
    assert.deepEqual(argsFor(fixture.calls, 'getUser'), [[ID], [ID]])
    assert.equal(named(fixture.calls, 'insertReferralCommission').length, 0)
  })
}

test('preserves exact amount tolerance and optional provider authorization', async t => {
  for (const amount of ['1999000', 2000000]) {
    const fixture = loadRoute(t, { actions: [action(referenceFor(), amount)], noToken: true })
    await responseIs(await fixture.POST(fixture.requestFor()), 200, paidBody('gems'))
    assert.equal(named(fixture.calls, 'fetch').length, 1)
  }
})

test('already recorded payment does not call provider or credit again', async t => {
  const fixture = loadRoute(t, { existing: true })
  await responseIs(await fixture.POST(fixture.requestFor()), 200, alreadyBody)
  assert.deepEqual(fixture.calls.order, ['authenticate', 'body', 'getPurchaseByChargeId', 'getUser'])
  noWrites(fixture.calls)
})

test('noninserted purchase preserves already response without credit or commission', async t => {
  const fixture = loadRoute(t, { inserted: false })
  await responseIs(await fixture.POST(fixture.requestFor()), 200, alreadyBody)
  assert.deepEqual(fixture.calls.order, [
    'authenticate', 'body', 'getPurchaseByChargeId', 'fetch', 'getLastPurchase',
    'getUser', 'getFinalCryptoGems', 'insertStarPurchase', 'getUser',
  ])
  for (const name of ['incrementGemsAndPurchased', 'queryOne', 'insertGemTransaction', 'incrementGems', 'insertReferralCommission']) {
    assert.equal(named(fixture.calls, name).length, 0)
  }
})

test('preserves first-time restrictions, returning buyers and missing-user responses', async t => {
  const restricted = loadRoute(t, { prior: true, reference: referenceFor('gems', '1') })
  await responseIs(await restricted.POST(restricted.requestFor()), 200, { status: 'error', reason: 'first_time_used' })
  noWrites(restricted.calls)
  assert.equal(named(restricted.calls, 'getUser').length, 0)

  const missing = loadRoute(t, { missingUser: true })
  await responseIs(await missing.POST(missing.requestFor()), 404, { error: 'Usuario no encontrado' })
  noWrites(missing.calls)

  const returning = loadRoute(t, { prior: true })
  await responseIs(await returning.POST(returning.requestFor()), 200, paidBody('gems'))
  assert.equal(argsFor(returning.calls, 'insertStarPurchase')[0][0].is_first_purchase, false)
})

test('preserves referral bases, floor rounding, thresholds and unique buyer counting', async t => {
  for (const [type, base] of [['gems', 101], ['messages', 11], ['hybrid', 53]]) {
    for (const [uniqueBuyers, pct, count] of [
      [[], 10, 1], [['a', 'b'], 15, 3], [['a', 'b', 'c', 'd'], 20, 5],
      [[ID, 'a', 'b'], 15, 3],
    ]) {
      const reference = referenceFor(type)
      const fixture = loadRoute(t, { reference, referred: true, uniqueBuyers })
      await responseIs(await fixture.POST(fixture.requestFor()), 200, paidBody(type))
      const commission = Math.floor(base * pct / 100)
      assert.deepEqual(argsFor(fixture.calls, 'getUniqueBuyers'), [[REFERRER]])
      assert.deepEqual(argsFor(fixture.calls, 'incrementGems'), [[REFERRER, commission]])
      assert.deepEqual(argsFor(fixture.calls, 'incrementPayingReferrals'), [[REFERRER, count]])
      assert.deepEqual(argsFor(fixture.calls, 'insertReferralCommission'), [[{
        referrer_id: REFERRER, referred_id: ID, purchase_gems: base,
        commission_gems: commission, commission_pct: pct, source: 'crypto', reference,
      }]])
      assert.deepEqual(argsFor(fixture.calls, 'insertGemTransaction')[1], [{
        telegram_id: REFERRER, amount: commission,
        transaction_type: 'referral_commission',
        description: `Comisión ${pct}% por compra de referido`,
      }])
      assert.deepEqual(fixture.calls.order.slice(-7), [
        'getUser', 'getUser', 'getUniqueBuyers', 'incrementGems',
        'incrementPayingReferrals', 'insertGemTransaction', 'insertReferralCommission',
      ])
      assert.equal(fixture.users.get(REFERRER).gems, 20 + commission)
    }
  }
})

test('missing referrer and commission failure retain successful buyer response', async t => {
  for (const options of [
    { missingReferrer: true },
    { failAt: 'incrementGems', failure: new Error('synthetic commission failure') },
  ]) {
    const fixture = loadRoute(t, { referred: true, ...options })
    await responseIs(await fixture.POST(fixture.requestFor()), 200, paidBody('gems'))
    assert.equal(named(fixture.calls, 'insertReferralCommission').length, 0)
    if (options.failAt) {
      assert.equal(fixture.calls.logs.at(-1).args[0], '[commission] Error:')
      assert.equal(fixture.calls.logs.at(-1).args[1], options.failure)
    }
  }
})

test('credit failures preserve existing error and do not run ledger or commissions', async t => {
  for (const [type, failAt] of [
    ['gems', 'incrementGemsAndPurchased'], ['messages', 'queryOne'], ['hybrid', 'queryOne'],
  ]) {
    const reference = referenceFor(type)
    const fixture = loadRoute(t, { reference, failAt })
    await responseIs(await fixture.POST(fixture.requestFor()), 200, {
      status: 'error', reason: 'credit_failed', reference,
      message: `Pago recibido (${reference}) pero hubo un error acreditando tu balance. Contacta a soporte con esta referencia.`,
    })
    assert.equal(named(fixture.calls, 'insertStarPurchase').length, 1)
    assert.equal(named(fixture.calls, 'insertGemTransaction').length, 0)
    assert.equal(named(fixture.calls, 'insertReferralCommission').length, 0)
    // Caracterización, no reparación: el híbrido puede haber acreditado gemas.
    assert.equal(fixture.buyer.gems, type === 'hybrid' ? 57 : 10)
    assert.equal(fixture.calls.logs.at(-1).args[0], '[check-crypto-payment] ❌ Error acreditando balance:')
  }
})

test('preserves business exception responses without retries', async t => {
  for (const failAt of ['getPurchaseByChargeId', 'fetch', 'insertStarPurchase', 'insertGemTransaction']) {
    const failure = new Error(`synthetic ${failAt} failure`)
    const fixture = loadRoute(t, { failAt, failure })
    await responseIs(await fixture.POST(fixture.requestFor()), 500, { error: failure.message })
    assert.equal(fixture.calls.logs.at(-1).args[0], '[check-crypto-payment] Error:')
    assert.equal(fixture.calls.logs.at(-1).args[1], failure)
    assert.ok(named(fixture.calls, 'fetch').length <= 1)
    assert.equal(named(fixture.calls, 'insertReferralCommission').length, 0)
  }
  const fixture = loadRoute(t, { jsonError: new Error('synthetic JSON failure') })
  await responseIs(await fixture.POST(fixture.requestFor()), 500, { error: 'synthetic JSON failure' })
  noWrites(fixture.calls)
})