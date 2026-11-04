// Endpoint crypto: handler real con dependencias simuladas (sin red ni Turso).
// Autenticacion, identidad, referencia, token, importe e idempotencia se
// ejercitan con el CODIGO REAL de la ruta; solo se simulan los limites.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..')
const ID = '123456789'
const OTHER = '999999999'
const MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'

const COMPILED = ts.transpileModule(
  readFileSync(path.join(ROOT, 'app/api/check-crypto-payment/route.ts'), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }
).outputText

const PLANS = {
  gems: { rail: 'crypto', type: 'gems', stars_amount: 0, gems_amount: 315, credit_gems: 315,
    credit_messages: 0, payment_method: 'crypto',
    ledger: { amount: 315, type: 'crypto_purchase', description: 'x' }, requiresLedger: true },
  messages: { rail: 'crypto', type: 'messages', stars_amount: 0, gems_amount: 0, credit_gems: 0,
    credit_messages: 360, payment_method: 'crypto_messages',
    ledger: { amount: 0, type: 'crypto_purchase_messages', description: 'x' }, requiresLedger: true },
  hybrid: { rail: 'crypto', type: 'hybrid', stars_amount: 0, gems_amount: 180, credit_gems: 180,
    credit_messages: 360, payment_method: 'crypto_hybrid',
    ledger: { amount: 180, type: 'crypto_purchase_hybrid', description: 'x' }, requiresLedger: true },
}

// Refleja lib/constants.ts: CRYPTO_PACKAGES[0] es first_time_only.
const CATALOG = {
  gems: [{ usdt: 1.79, first_time_only: true }, { usdt: 2.69, first_time_only: false }],
  messages: [{ usdt: 1.19 }, { usdt: 2.99 }],
  hybrid: [{ usdt: 2.39 }],
}

const reference = (type = 'gems', tid = ID, index = 0) =>
  `TABOO_${tid}_${type}_${index}_1700000000000`

function load(options = {}) {
  const type = options.type || 'gems'
  const calls = []
  const record = (name) => (args) => calls.push({ name, args })
  const state = options.state || null

  const deps = {
    'next/server': {
      NextResponse: { json: (body, init) => ({ status: init?.status ?? 200, body }) },
    },
    '@/lib/telegram-auth': {
      authenticateTelegramRequest: async () =>
        options.unauthorized
          ? { ok: false, status: 401, error: 'No autorizado' }
          : { ok: true, telegramId: ID, data: { user: { id: Number(ID), first_name: 'x' } } },
    },
    '@/lib/gem-payments': {
      resolveCryptoPurchase: () => ({ ok: true, plan: options.plan || PLANS[type] }),
    },
    '@/lib/constants': {
      CRYPTO_PACKAGES: CATALOG.gems,
      MESSAGE_PACKAGES: CATALOG.messages,
      HYBRID_PACKAGES: CATALOG.hybrid,
    },
    '@/lib/db-queries': {
      getUser: async (tid) => {
        record('getUser')([tid])
        return options.missingUser
          ? null
          : { telegram_id: tid, gems: 10, purchased_gems: 4, bonus_gems: 7 }
      },
      getLastPurchase: async () => {
        record('getLastPurchase')([])
        return options.prior ? { id: 1 } : null
      },
      proveAppliedPurchase: async () => {
        record('proveAppliedPurchase')([])
        if (state && state.applied) return { state: 'applied' }
        return options.evidence || { state: 'conflict', reason: 'purchase_absent' }
      },
      resolveCommissionTarget: async (tid, base) => {
        record('resolveCommissionTarget')([tid, base])
        if (options.lookupThrows) throw new Error('synthetic db down')
        return options.commission || { status: 'no_referrer' }
      },
      applyGemPurchaseAtomic: async (data) => {
        record('applyGemPurchaseAtomic')([data])
        const outcome = options.outcome || {
          status: 'applied', gems: 325, purchased_gems: 319, bonus_gems: 7,
          commission_applied: false,
        }
        // Solo una compra realmente aplicada deja evidencia persistida:
        // un conflict/user_missing/duplicate NO marca el cargo como pagado.
        if (state && outcome.status === 'applied') state.applied = true
        return outcome
      },
    },
  }

  const events = [{ actions: [{ type: 'JettonTransfer', JettonTransfer: {
    comment: options.comment ?? reference(type, options.tid || ID),
    amount: String(options.amount ?? 1790000),
    jetton: { address: options.master ?? MASTER },
  } }] }]

  const sandbox = {
    process: { env: {} },
    console: { log: () => {}, warn: () => {},
      error: (...args) => calls.push({ name: 'console.error', args }) },
    fetch: async (url) => {
      record('fetch')([url])
      return options.tonapiDown
        ? { ok: false, status: 500, json: async () => ({}) }
        : { ok: true, json: async () => ({ events }) }
    },
    JSON, Math, Number, String, Array, Object, Boolean, Date, Promise, isNaN, parseInt,
  }

  const module = { exports: {} }
  sandbox.module = module
  sandbox.exports = module.exports
  sandbox.require = (id) => {
    const dep = deps[id]
    if (!dep) throw new Error(`require inesperado: ${id}`)
    return dep
  }

  vm.runInNewContext(`(function(require, module, exports){${COMPILED}\n})`, sandbox)(
    sandbox.require, module, module.exports
  )

  return { POST: module.exports.POST, calls, named: (name) => calls.filter((c) => c.name === name) }
}

const requestFor = (ref) => ({ headers: { get: () => null }, json: async () => ({ reference: ref }) })
const noAtomic = (app) => assert.equal(app.named('applyGemPurchaseAtomic').length, 0)
const noResolve = (app) => assert.equal(app.named('resolveCommissionTarget').length, 0)
const indexOf = (app, name) => app.calls.findIndex((c) => c.name === name)

// ═══════════════ Validaciones y seguridad ═══════════════

test('1. auth rechazada ⇒ 401 sin tocar BD', async () => {
  const app = load({ unauthorized: true })
  const res = await app.POST(requestFor(reference()))
  assert.equal(res.status, 401)
  assert.equal(res.body.error, 'No autorizado')
  assert.equal(app.named('getUser').length, 0)
  noAtomic(app); noResolve(app)
})

test('2. reference ausente o con formato inválido ⇒ 400', async () => {
  for (const ref of ['', 'NO-TABOO', 'TABOO_1_2']) {
    const app = load()
    const res = await app.POST(requestFor(ref))
    assert.equal(res.status, 400)
    noAtomic(app); noResolve(app)
  }
})

test('3. reference de otra identidad ⇒ 403', async () => {
  const app = load()
  const res = await app.POST(requestFor(reference('gems', OTHER)))
  assert.equal(res.status, 403)
  assert.equal(res.body.error, 'Reference no coincide con la sesión')
  noAtomic(app); noResolve(app)
})

test('4. package_type e índice inválidos ⇒ 400', async () => {
  const badType = load()
  const r1 = await badType.POST(requestFor(reference('bogus')))
  assert.equal(r1.status, 400)
  assert.equal(r1.body.error, 'package_type inválido')
  noAtomic(badType); noResolve(badType)

  const badIndex = load()
  const r2 = await badIndex.POST(requestFor(reference('gems', ID, 99)))
  assert.equal(r2.status, 400)
  assert.equal(r2.body.error, 'Package index inválido')
  noAtomic(badIndex); noResolve(badIndex)
})

test('5. token o comentario incorrectos ⇒ pending sin acreditar', async () => {
  const wrongToken = load({ master: 'OTRO' })
  const r1 = await wrongToken.POST(requestFor(reference()))
  assert.equal(r1.status, 200)
  assert.equal(r1.body.status, 'pending')
  noAtomic(wrongToken); noResolve(wrongToken)

  const wrongComment = load({ comment: 'OTRO_COMENTARIO' })
  const r2 = await wrongComment.POST(requestFor(reference()))
  assert.equal(r2.body.status, 'pending')
  noAtomic(wrongComment); noResolve(wrongComment)
})
// ── fin pruebas 1-5

test('6. TonAPI caído ⇒ pending tonapi_error', async () => {
  const app = load({ tonapiDown: true })
  const res = await app.POST(requestFor(reference()))
  assert.equal(res.body.status, 'pending')
  assert.equal(res.body.reason, 'tonapi_error')
  noAtomic(app); noResolve(app)
})

test('7. importe inválido o insuficiente ⇒ pending sin acreditar', async () => {
  const invalid = load({ amount: 'abc' })
  const r1 = await invalid.POST(requestFor(reference()))
  assert.equal(r1.body.status, 'pending')
  assert.equal(r1.body.reason, 'invalid_amount')
  noAtomic(invalid); noResolve(invalid)

  const short = load({ amount: 1000 })
  const r2 = await short.POST(requestFor(reference()))
  assert.equal(r2.body.status, 'pending')
  assert.equal(r2.body.reason, 'amount_mismatch')
  noAtomic(short); noResolve(short)
})

test('8. first_time ya usado ⇒ 200 error', async () => {
  const app = load({ prior: { id: 1 } })
  const res = await app.POST(requestFor(reference()))
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'error')
  assert.equal(res.body.reason, 'first_time_used')
  noAtomic(app); noResolve(app)
})

test('9. usuario inexistente ⇒ 404 sin acreditar', async () => {
  const app = load({ missingUser: true })
  const res = await app.POST(requestFor(reference()))
  assert.equal(res.status, 404)
  noAtomic(app); noResolve(app)
})

test('10. evidencia aplicada ⇒ already sin reejecutar', async () => {
  const app = load({ evidence: { state: 'applied' } })
  const res = await app.POST(requestFor(reference()))
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'paid')
  assert.equal(res.body.already, true)
  assert.equal(res.body.remaining_gems, 10)
  assert.equal(res.body.remaining_bonus_gems, 7)
  noAtomic(app); noResolve(app)
})
// ── fin pruebas 6-10

test('11. evidencia en conflicto ⇒ 200 conflict sin acreditar', async () => {
  const app = load({ evidence: { state: 'conflict', reason: 'purchase_mismatch' } })
  const res = await app.POST(requestFor(reference()))
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'error')
  assert.equal(res.body.reason, 'conflict')
  noAtomic(app); noResolve(app)
})

test('12. comisión aplicada y orden evidencia → TonAPI → comisión → transacción', async () => {
  const app = load({
    commission: { status: 'resolved', target: { referrer_id: 'ref-1', base_gems: 315 } },
    outcome: { status: 'applied', gems: 325, purchased_gems: 319, bonus_gems: 7,
               commission_applied: true },
  })
  const res = await app.POST(requestFor(reference()))
  assert.equal(res.body.status, 'paid')
  assert.equal(res.body.commission_applied, true)
  assert.equal(res.body.commission_pending, false)
  assert.deepEqual(app.named('resolveCommissionTarget')[0].args, [ID, 315])
  assert.deepEqual(app.named('applyGemPurchaseAtomic')[0].args[0].commission,
    { referrer_id: 'ref-1', base_gems: 315 })
  assert.ok(indexOf(app, 'proveAppliedPurchase') < indexOf(app, 'fetch'))
  assert.ok(indexOf(app, 'fetch') < indexOf(app, 'resolveCommissionTarget'))
  assert.ok(indexOf(app, 'resolveCommissionTarget') < indexOf(app, 'applyGemPurchaseAtomic'))
})

test('13. sin referidor ⇒ compra sin comisión', async () => {
  const app = load({ commission: { status: 'no_referrer' } })
  const res = await app.POST(requestFor(reference()))
  assert.equal(res.body.status, 'paid')
  assert.equal('commission' in app.named('applyGemPurchaseAtomic')[0].args[0], false)
})

test('14. fallo de lectura de comisión ⇒ 503 reintentable', async () => {
  const app = load({ lookupThrows: true })
  const res = await app.POST(requestFor(reference()))
  assert.equal(res.status, 503)
  assert.equal(res.body.reason, 'commission_lookup_failed')
  assert.equal(res.body.retryable, true)
  noAtomic(app)
})

test('15. referidor inexistente ⇒ review_required sin acreditar', async () => {
  const app = load({ commission: { status: 'referrer_missing' } })
  const res = await app.POST(requestFor(reference()))
  assert.equal(res.status, 200)
  assert.equal(res.body.reason, 'commission_referrer_missing')
  assert.equal(res.body.review_required, true)
  noAtomic(app)
})
// ── fin pruebas 11-15

test('16. comisión pendiente ⇒ commission_pending', async () => {
  const app = load({
    commission: { status: 'resolved', target: { referrer_id: 'ref-1', base_gems: 315 } },
    outcome: { status: 'applied', gems: 325, purchased_gems: 319, bonus_gems: 7,
               commission_applied: false, commission_note: 'commission_transient_failure' },
  })
  const res = await app.POST(requestFor(reference()))
  assert.equal(res.body.status, 'paid')
  assert.equal(res.body.commission_pending, true)
  assert.equal(res.body.commission_applied, false)
})

test('17. regresión de importes: mensajes e híbrido', async () => {
  const messages = load({ type: 'messages', amount: 1190000, commission: { status: 'no_referrer' } })
  const r1 = await messages.POST(requestFor(reference('messages')))
  assert.equal(r1.body.status, 'paid')
  assert.equal(r1.body.gems_added, 0)
  assert.equal(r1.body.messages_added, 360)
  assert.equal(r1.body.amount_added, 360)
  assert.equal(r1.body.is_messages, true)
  assert.deepEqual(messages.named('resolveCommissionTarget')[0].args, [ID, 120])

  const hybrid = load({ type: 'hybrid', amount: 2390000, commission: { status: 'no_referrer' } })
  const r2 = await hybrid.POST(requestFor(reference('hybrid')))
  assert.equal(r2.body.status, 'paid')
  assert.equal(r2.body.gems_added, 180)
  assert.equal(r2.body.messages_added, 360)
  assert.equal(r2.body.amount_added, 180)
  assert.equal(r2.body.is_hybrid, true)
  assert.deepEqual(hybrid.named('resolveCommissionTarget')[0].args, [ID, 300])
})

test('18. duplicados: una sola acreditación y una sola comisión', async () => {
  const state = { applied: false }
  const app = load({
    state,
    commission: { status: 'resolved', target: { referrer_id: 'ref-1', base_gems: 315 } },
    outcome: { status: 'applied', gems: 325, purchased_gems: 319, bonus_gems: 7,
               commission_applied: true },
  })
  const ref = reference()

  const first = await app.POST(requestFor(ref))
  assert.equal(first.body.status, 'paid')
  assert.equal(app.named('applyGemPurchaseAtomic').length, 1)
  assert.equal(app.named('resolveCommissionTarget').length, 1)

  const second = await app.POST(requestFor(ref))
  assert.equal(second.body.status, 'paid')
  assert.equal(second.body.already, true)
  assert.equal(app.named('applyGemPurchaseAtomic').length, 1)
  assert.equal(app.named('resolveCommissionTarget').length, 1)
})

test('19. ninguna validación negativa llega a comisión ni a transacción', async () => {
  const cases = [
    { unauthorized: true },
    { tid: OTHER },
    { comment: 'OTRO' },
    { master: 'OTRO' },
    { amount: 1000 },
    { amount: 'abc' },
    { tonapiDown: true },
    { missingUser: true },
    { prior: { id: 1 } },
  ]
  for (const options of cases) {
    const app = load(options)
    const ref = options.tid ? reference('gems', OTHER) : reference()
    await app.POST(requestFor(ref))
    noAtomic(app)
    noResolve(app)
  }
})
// ── fin pruebas 16-19

