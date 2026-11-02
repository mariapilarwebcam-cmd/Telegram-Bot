// Caracterización del handler ACTUAL de /api/gacha/spin.
// Sin Turso, autenticador real, credenciales, red, pagos ni generación.
// El mock no demuestra atomicidad real ni reproduce un motor SQLite.
// La prueba diagnóstica de elegibilidad incorrecta inyecta un fallo;
// no atribuye ese fallo al despliegue de producción.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const USER_ID = '123456789'
const AUTHORIZATION = 'tma synthetic-mocked-init-data'
const NOW = Date.parse('2030-01-15T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const NOW_SQL = '2030-01-15 12:00:00'

const COMMON_DETAILS = '¡Has ganado 15 Mensajes de Chat!'
const PASS_DETAILS = '¡Pase de Fantasía! (Foto Nivel 5 Ultra-Secreta)'

// Expectativas SQL independientes del código fuente de producción.
const SQL = {
  subscription: `
    SELECT * FROM subscriptions
    WHERE telegram_id = ?
      AND status = 'active'
      AND expires_at > datetime('now')
    ORDER BY expires_at DESC
    LIMIT 1
  `,
  balances: `
    SELECT purchased_gems, gems FROM users WHERE telegram_id = ?
  `,
  free: `
    SELECT id FROM gacha_history
    WHERE user_id = ? AND cost_gems = 0
      AND created_at >= unixepoch('now', '-7 days')
    LIMIT 1
  `,
  debit: `
    UPDATE users
    SET purchased_gems = purchased_gems - ?, gems = gems - ?
    WHERE telegram_id = ? AND purchased_gems >= ?
    RETURNING purchased_gems, gems
  `,
  pity: `
    SELECT reward_tier FROM gacha_history
    WHERE user_id = ? ORDER BY id DESC LIMIT 9
  `,
  bonus: `
    UPDATE users
    SET bonus_gems = COALESCE(bonus_gems, 0) + ?
    WHERE telegram_id = ?
  `,
  pass: `
    INSERT INTO user_inventory (user_id, item_type, item_key)
    VALUES (?, 'fantasy_pass', 'level_5')
  `,
  history: `
    INSERT INTO gacha_history
      (user_id, cost_gems, reward_tier, reward_details)
    VALUES (?, ?, ?, ?)
  `,
  transaction: `
    INSERT INTO gem_transactions
      (telegram_id, amount, transaction_type, description)
    VALUES (?, ?, ?, ?)
  `,
}

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim()
}

for (const key of Object.keys(SQL)) {
  SQL[key] = normalizeSql(SQL[key])
}

const routePath = path.resolve(
  __dirname,
  '../app/api/gacha/spin/route.ts'
)
const routeSource = readFileSync(routePath, 'utf8')
const compiledRoute = ts.transpileModule(routeSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText

function copy(value) {
  return JSON.parse(JSON.stringify(value))
}

function rewardFor(kind) {
  assert.ok(kind === 'common' || kind === 'epic')

  return kind === 'epic'
    ? {
        tier: 'epic',
        type: 'fantasy_pass',
        key: 'level_5',
        details: PASS_DETAILS,
      }
    : {
        tier: 'common',
        type: 'bonus_gems',
        key: '15',
        details: COMMON_DETAILS,
      }
}

function success(cost, kind = 'common') {
  return { status: 200, cost, kind }
}

function rejected() {
  return { status: 402, cost: 50, kind: null }
}

function historyFailure(cost, kind) {
  return { status: 500, cost, kind, failHistory: true }
}

function initialState(balance, recentFree = false) {
  return {
    user: {
      telegram_id: USER_ID,
      gems: balance,
      purchased_gems: balance,
      bonus_gems: 37,
    },
    history: recentFree
      ? [{
          id: 1,
          user_id: USER_ID,
          cost_gems: 0,
          reward_tier: 'epic',
          reward_details: 'fantasy_pass:synthetic previous reward',
          created_at: '2030-01-14 12:00:00',
        }]
      : [],
    inventory: [],
    gemTransactions: [],
  }
}

function nextId(rows) {
  return rows.reduce((maximum, row) => Math.max(maximum, row.id), 0) + 1
}

function historyRow(state, plan) {
  const reward = rewardFor(plan.kind)

  return {
    id: nextId(state.history),
    user_id: USER_ID,
    cost_gems: plan.cost,
    reward_tier: reward.tier,
    reward_details: `${reward.type}:${reward.details}`,
    created_at: NOW_SQL,
  }
}

// Oráculo explícito del resultado de cada petición.
// No obtiene expectativas del SQL ni del resultado devuelto por el handler.
function expectedAfter(before, plan) {
  const expected = copy(before)
  if (plan.status !== 200) return expected

  expected.user.purchased_gems -= plan.cost
  expected.user.gems -= plan.cost

  if (plan.kind === 'common') {
    expected.user.bonus_gems += 15
  } else {
    expected.inventory.push({
      id: nextId(expected.inventory),
      user_id: USER_ID,
      item_type: 'fantasy_pass',
      item_key: 'level_5',
    })
  }

  expected.history.push(historyRow(expected, plan))

  if (plan.cost > 0) {
    expected.gemTransactions.push({
      id: nextId(expected.gemTransactions),
      telegram_id: USER_ID,
      amount: -50,
      transaction_type: 'gacha_spin',
      description: `Tirada de ruleta (${plan.kind})`,
    })
  }

  return expected
}

function makeHarness(t, options) {
  let committed = copy(options.state)
  let current = null
  let activeTransaction = false
  const subscription = options.subscription
  const hasActiveSubscription = !!subscription &&
    subscription.status === 'active' &&
    subscription.expiresAt > NOW

  const records = []
  const forbiddenCalls = []
  const injectedError = new Error('synthetic history insert failure')

  function forbidden(operation) {
    forbiddenCalls.push(operation)
    throw new Error(`Forbidden operation: ${operation}`)
  }

  function check(condition, message) {
    if (!condition) forbidden(message)
  }

  function same(actual, expected, message) {
    try {
      assert.deepEqual(actual, expected)
    } catch {
      forbidden(message)
    }
  }

  function event(name) {
    check(current !== null, `event outside request:${name}`)
    current.order.push(name)
  }

  function sqlResult(rows = [], rowsAffected = 0, lastInsertRowid = 0) {
    return { rows, rowsAffected, lastInsertRowid }
  }

  function expectedSteps(plan) {
    const steps = [{ key: 'subscription', args: [USER_ID] }]
    if (hasActiveSubscription) {
      steps.push({ key: 'free', args: [USER_ID] })
    }
    steps.push({ key: 'balances', args: [USER_ID] })
    if (plan.cost > 0) {
      steps.push({
        key: 'debit',
        args: [50, 50, USER_ID, 50],
      })
    }
    if (plan.status === 402) return steps

    const reward = rewardFor(plan.kind)
    steps.push({ key: 'pity', args: [USER_ID] })
    steps.push(plan.kind === 'common'
      ? { key: 'bonus', args: [15, USER_ID] }
      : { key: 'pass', args: [USER_ID] })
    steps.push({
      key: 'history',
      args: [
        USER_ID,
        plan.cost,
        reward.tier,
        `${reward.type}:${reward.details}`,
      ],
    })

    if (!plan.failHistory && plan.cost > 0) {
      steps.push({
        key: 'transaction',
        args: [
          USER_ID,
          -50,
          'gacha_spin',
          `Tirada de ruleta (${reward.tier})`,
        ],
      })
    }
    return steps
  }

  const dependencies = {
    'next/server': {
      NextResponse: {
        json(body, init) {
          return new Response(JSON.stringify(body), {
            ...init,
            headers: { 'content-type': 'application/json' },
          })
        },
      },
    },
    '@/lib/telegram-auth': {
      async authenticateTelegramRequest(request) {
        event('authenticate')
        check(
          request.headers.get('authorization') === AUTHORIZATION,
          'unexpected authorization'
        )
        current.authentication += 1

        return {
          ok: true,
          telegramId: USER_ID,
          data: { user: { id: Number(USER_ID) } },
        }
      },
    },
    '@/lib/db-queries': {
      async ensureUser(telegramId) {
        event('ensureUser')
        same([telegramId], [USER_ID], 'ensureUser identity')
        return copy(committed.user)
      },
      getActiveSubscription() {
        return forbidden('getActiveSubscription outside transaction')
      },
      insertGemTransaction() {
        return forbidden('insertGemTransaction outside transaction')
      },
    },
    '@/lib/turso': {
      queryOne() {
        return forbidden('queryOne outside transaction')
      },
      execute() {
        return forbidden('execute outside transaction')
      },
      db: {
        execute() {
          return forbidden('db.execute outside transaction')
        },
        async transaction(...args) {
          event('open')
          same(args, ['write'], 'transaction mode')
          check(!activeTransaction, 'overlapping transaction')
          activeTransaction = true

          const record = current
          const working = copy(committed)
          const steps = expectedSteps(record.plan)
          let cursor = 0
          let closed = false

          function ensureOpen() {
            check(!closed, 'operation on closed transaction')
            check(current === record, 'transaction crossed request')
          }

          return {
            async execute(statement) {
              ensureOpen()
              const expected = steps[cursor]
              check(!!expected, 'unexpected additional SQL')
              same(
                normalizeSql(statement.sql),
                SQL[expected.key],
                `unexpected SQL at step ${cursor}`
              )
              const args = Array.from(statement.args)
              same(
                args,
                expected.args,
                `unexpected arguments at step ${cursor}`
              )
              cursor += 1
              record.sql.push(expected.key)
              event(expected.key)

              switch (expected.key) {
                case 'subscription': {
                  return sqlResult(hasActiveSubscription ? [{
                    id: 1,
                    telegram_id: USER_ID,
                    status: 'active',
                    expires_at: '2030-02-15 12:00:00',
                  }] : [])
                }
                case 'free': {
                  check(activeTransaction, 'free lookup outside transaction')
                  const match = working.history.find(row =>
                    row.user_id === USER_ID &&
                    row.cost_gems === 0 &&
                    Date.parse(row.created_at.replace(' ', 'T') + 'Z') >= NOW - 7 * DAY
                  )
                  const result = options.injectEligibilityMiss ? null : match
                  record.freeLookup = result ? result.id : null
                  return sqlResult(result ? [{ id: result.id }] : [])
                }
                case 'balances': {
                  check(
                    working.user.telegram_id === args[0],
                    'balances user mismatch'
                  )
                  return sqlResult([{
                    purchased_gems: working.user.purchased_gems,
                    gems: working.user.gems,
                  }])
                }
                case 'debit': {
                  const [purchasedCost, gemsCost, telegramId, minimum] = args
                  check(
                    working.user.telegram_id === telegramId,
                    'debit user mismatch'
                  )
                  record.debitAttempts += 1

                  if (working.user.purchased_gems < minimum) {
                    return sqlResult()
                  }

                  working.user.purchased_gems -= purchasedCost
                  working.user.gems -= gemsCost
                  record.effectiveDebits += 1

                  return sqlResult([{
                    purchased_gems: working.user.purchased_gems,
                    gems: working.user.gems,
                  }], 1)
                }
                case 'pity': {
                  const rows = working.history
                    .filter(row => row.user_id === USER_ID)
                    .slice()
                    .sort((a, b) => b.id - a.id)
                    .slice(0, 9)
                    .map(row => ({ reward_tier: row.reward_tier }))
                  record.pityRows = copy(rows)
                  return sqlResult(rows)
                }
                case 'bonus': {
                  const [amount, telegramId] = args
                  check(
                    working.user.telegram_id === telegramId,
                    'bonus user mismatch'
                  )
                  working.user.bonus_gems =
                    (working.user.bonus_gems ?? 0) + amount
                  return sqlResult([], 1)
                }
                case 'pass': {
                  const [userId] = args
                  const row = {
                    id: nextId(working.inventory),
                    user_id: userId,
                    item_type: 'fantasy_pass',
                    item_key: 'level_5',
                  }
                  working.inventory.push(row)
                  return sqlResult([], 1, row.id)
                }
                case 'history': {
                  if (record.plan.failHistory) throw injectedError

                  const [userId, cost, tier, details] = args
                  const row = {
                    id: nextId(working.history),
                    user_id: userId,
                    cost_gems: cost,
                    reward_tier: tier,
                    reward_details: details,
                    created_at: NOW_SQL,
                  }
                  working.history.push(row)
                  return sqlResult([], 1, row.id)
                }
                case 'transaction': {
                  const [telegramId, amount, transactionType, description] = args
                  const row = {
                    id: nextId(working.gemTransactions),
                    telegram_id: telegramId,
                    amount,
                    transaction_type: transactionType,
                    description,
                  }
                  working.gemTransactions.push(row)
                  return sqlResult([], 1, row.id)
                }
                default:
                  return forbidden(`unhandled SQL:${expected.key}`)
              }
            },
            async commit() {
              ensureOpen()
              check(record.plan.status === 200, 'unexpected commit')
              check(cursor === steps.length, 'commit before expected SQL')
              record.commit += 1
              record.confirmedDebits = record.effectiveDebits
              event('commit')
              committed = working
              closed = true
              activeTransaction = false
            },
            async rollback() {
              ensureOpen()
              check(record.plan.status !== 200, 'unexpected rollback')
              check(cursor === steps.length, 'rollback before expected SQL')
              record.rollback += 1
              event('rollback')
              closed = true
              activeTransaction = false
            },
          }
        },
      },
    },
    '@/lib/constants': {
      CHARACTER_NAMES_FEMALE: Object.freeze({}),
      CHARACTER_NAMES_MALE: Object.freeze({}),
      PERSONALITIES: Object.freeze({}),
    },
  }

  const isolatedMath = Object.create(Math)
  Object.defineProperty(isolatedMath, 'random', {
    value() {
      check(current !== null, 'RNG outside request')
      check(current.rng.length > 0, 'unexpected RNG call')
      current.rngCalls += 1
      return current.rng.shift()
    },
  })

  const exports = {}
  vm.runInNewContext(compiledRoute, {
    exports,
    require(name) {
      if (!Object.prototype.hasOwnProperty.call(dependencies, name)) {
        return forbidden(`require:${name}`)
      }
      return dependencies[name]
    },
    Math: isolatedMath,
    process: {
      env: new Proxy({}, {
        get(_target, key) {
          return forbidden(`env:${String(key)}`)
        },
        set(_target, key) {
          return forbidden(`env-write:${String(key)}`)
        },
      }),
    },
    console: new Proxy({}, {
      get(_target, method) {
        return (...args) => {
          check(method === 'error', `console:${String(method)}`)
          check(current !== null, 'log outside request')
          current.logs.push(args)
        }
      },
    }),
    fetch: () => forbidden('fetch'),
    XMLHttpRequest: function () {
      return forbidden('XMLHttpRequest')
    },
    WebSocket: function () {
      return forbidden('WebSocket')
    },
  }, { filename: routePath, timeout: 1000 })

  assert.equal(typeof exports.POST, 'function')

  t.after(() => {
    assert.deepEqual(forbiddenCalls, [])
    assert.equal(activeTransaction, false)
    assert.equal(current, null)
  })

  async function request(plan) {
    assert.equal(current, null)
    const record = {
      plan,
      authentication: 0,
      order: [],
      sql: [],
      logs: [],
      rng: plan.status === 402
        ? []
        : plan.kind === 'epic'
          ? [0.5, 0.5, 0.1]
          : [0.5, 0.1],
      rngCalls: 0,
      debitAttempts: 0,
      effectiveDebits: 0,
      confirmedDebits: 0,
      commit: 0,
      rollback: 0,
      freeLookup: undefined,
      pityRows: null,
    }
    current = record
    records.push(record)

    try {
      const response = await exports.POST(new Request(
        'https://example.invalid/api/gacha/spin',
        {
          method: 'POST',
          headers: { Authorization: AUTHORIZATION },
        }
      ))
      assert.ok(response instanceof Response)
      const body = await response.json()
      assert.equal(record.rng.length, 0, 'unused RNG values')
      assert.equal(activeTransaction, false)
      return { status: response.status, body, record }
    } finally {
      current = null
    }
  }

  return {
    request,
    snapshot: () => copy(committed),
    records,
    injectedError,
  }
}

function vipSubscription() {
  return {
    status: 'active',
    expiresAt: NOW + 30 * DAY,
  }
}

function assertOutcome(
  result,
  before,
  after,
  plan,
  isVip,
  injectedError
) {
  const { status, body, record } = result
  assert.equal(status, plan.status)

  const prefix = ['authenticate', 'ensureUser', 'open']
  const eligibilitySql = ['subscription']
  if (isVip) eligibilitySql.push('free')
  eligibilitySql.push('balances')

  assert.equal(record.authentication, 1)
  assert.equal(record.debitAttempts, plan.cost > 0 ? 1 : 0)
  assert.equal(
    record.effectiveDebits,
    plan.cost > 0 && before.user.purchased_gems >= 50 ? 1 : 0
  )
  assert.equal(
    record.confirmedDebits,
    plan.status === 200 && plan.cost > 0 ? 1 : 0
  )
  assert.equal(record.commit, plan.status === 200 ? 1 : 0)
  assert.equal(record.rollback, plan.status === 200 ? 0 : 1)
  assert.deepEqual(record.order, [
    ...prefix,
    ...record.sql,
    plan.status === 200 ? 'commit' : 'rollback',
  ])

  if (plan.status === 402) {
    assert.deepEqual(body, {
      error: 'insufficient_gems',
      message: 'Necesitas 50 gemas compradas.',
    })
    assert.deepEqual(record.sql, [...eligibilitySql, 'debit'])
    assert.equal(record.rngCalls, 0)
    assert.equal(record.pityRows, null)
    assert.deepEqual(record.logs, [])
    assert.deepEqual(after, before)
    return
  }

  // El resultado épico debe proceder del pity y no del RNG normal.
  const previous = before.history
    .filter(row => row.user_id === USER_ID)
    .slice()
    .sort((a, b) => b.id - a.id)
    .slice(0, 9)
    .map(row => ({ reward_tier: row.reward_tier }))
  assert.deepEqual(record.pityRows, previous)

  const forced = previous.length === 9 &&
    previous.every(row =>
      row.reward_tier === 'common' || row.reward_tier === 'rare'
    )
  assert.equal(forced, plan.kind === 'epic')
  assert.equal(record.rngCalls, forced ? 3 : 2)

  const expectedSql = [...eligibilitySql]
  if (plan.cost > 0) expectedSql.push('debit')
  expectedSql.push(
    'pity',
    plan.kind === 'common' ? 'bonus' : 'pass',
    'history'
  )
  if (plan.status === 200 && plan.cost > 0) {
    expectedSql.push('transaction')
  }
  assert.deepEqual(record.sql, expectedSql)

  if (plan.status === 500) {
    assert.equal(plan.failHistory, true)
    assert.deepEqual(body, { error: 'Error interno' })

    // El débito y el premio pudieron prepararse, pero no confirmarse.
    assert.equal(record.commit, 0)
    assert.equal(record.rollback, 1)
    assert.equal(record.confirmedDebits, 0)
    assert.equal(record.sql.at(-1), 'history')
    assert.equal(record.sql.includes('transaction'), false)

    // Incluye saldo, mensajes, inventario e historial sin cambios.
    assert.deepEqual(after, before)

    // Se conserva el error original; no se serializa en la respuesta.
    assert.equal(record.logs.length, 1)
    assert.equal(record.logs[0].length, 2)
    assert.equal(record.logs[0][0], '[gacha/spin] error:')
    assert.equal(record.logs[0][1], injectedError)
    return
  }

  const reward = rewardFor(plan.kind)
  assert.deepEqual(body, {
    success: true,
    tier: reward.tier,
    reward_type: reward.type,
    reward_details: reward.details,
    item_key: reward.key,
    remaining_gems: after.user.gems,
    remaining_purchased_gems: after.user.purchased_gems,
    is_free_spin: plan.cost === 0,
  })
  assert.deepEqual(record.logs, [])
}

async function runFifteen(t, options, plans, totals) {
  assert.equal(plans.length, 15)
  const initial = copy(options.state)
  const harness = makeHarness(t, options)
  let expected = copy(initial)

  for (let index = 0; index < plans.length; index++) {
    const plan = plans[index]
    const before = copy(expected)

    // Esperar respuesta y comprobaciones antes de la siguiente petición.
    const result = await harness.request(plan)
    expected = expectedAfter(before, plan)
    const after = harness.snapshot()

    assert.deepEqual(after, expected, `state after request ${index + 1}`)
    assertOutcome(
      result,
      before,
      after,
      plan,
      !!options.subscription,
      harness.injectedError
    )

    if (options.subscription) {
      const eligibleHistory = before.history.find(row =>
        row.user_id === USER_ID &&
        row.cost_gems === 0 &&
        Date.parse(row.created_at.replace(' ', 'T') + 'Z') >= NOW - 7 * DAY
      )
      assert.equal(
        result.record.freeLookup,
        options.injectEligibilityMiss ? null : eligibleHistory?.id ?? null
      )
    }
  }

  const final = harness.snapshot()
  const newHistory = final.history.slice(initial.history.length)
  const records = harness.records

  assert.equal(records.length, 15)
  assert.equal(newHistory.length, totals.successes)
  assert.equal(
    newHistory.filter(row => row.cost_gems === 0).length,
    totals.free
  )
  assert.equal(
    newHistory.filter(row => row.cost_gems === 50).length,
    totals.paid
  )
  assert.equal(final.gemTransactions.length, totals.paid)
  assert.equal(
    final.gemTransactions.reduce((sum, row) => sum + row.amount, 0),
    totals.paid === 0 ? 0 : -50 * totals.paid
  )
  assert.equal(
    records.reduce((sum, row) => sum + row.confirmedDebits, 0),
    totals.paid
  )
  assert.equal(
    records.reduce((sum, row) => sum + row.commit, 0),
    totals.successes
  )
  assert.equal(
    records.reduce((sum, row) => sum + row.rollback, 0),
    15 - totals.successes
  )
  assert.equal(final.user.purchased_gems, totals.balance)
  assert.equal(final.user.gems, totals.balance)
  assert.equal(final.user.bonus_gems, 37 + totals.common * 15)
  assert.equal(final.inventory.length, totals.epic)
  assert.equal(
    newHistory.filter(row => row.reward_tier === 'common').length,
    totals.common
  )
  assert.equal(
    newHistory.filter(row => row.reward_tier === 'epic').length,
    totals.epic
  )

  return { final, records, newHistory }
}

function fifteenSuccesses(costFor) {
  return Array.from({ length: 15 }, (_, index) =>
    success(costFor(index), index === 9 ? 'epic' : 'common')
  )
}

test('normal: 15 sequential paid spins debit 750 and persist every reward', async t => {
  await runFifteen(t, {
    state: initialState(1000),
  }, fifteenSuccesses(() => 50), {
    successes: 15,
    free: 0,
    paid: 15,
    common: 14,
    epic: 1,
    balance: 250,
  })
})

test('VIP available: first spin is free and the next 14 debit 700', async t => {
  const result = await runFifteen(t, {
    state: initialState(1000),
    subscription: vipSubscription(),
  }, fifteenSuccesses(index => index === 0 ? 0 : 50), {
    successes: 15,
    free: 1,
    paid: 14,
    common: 14,
    epic: 1,
    balance: 300,
  })

  assert.equal(result.records[0].freeLookup, null)
  for (const record of result.records.slice(1)) {
    assert.equal(record.freeLookup, result.newHistory[0].id)
  }
})

test('VIP already used: all 15 spins are paid', async t => {
  await runFifteen(t, {
    state: initialState(1000, true),
    subscription: vipSubscription(),
  }, fifteenSuccesses(() => 50), {
    successes: 15,
    free: 0,
    paid: 15,
    common: 14,
    epic: 1,
    balance: 250,
  })
})

test('normal with 49 gems: all 15 requests reject without rewards', async t => {
  await runFifteen(t, {
    state: initialState(49),
  }, Array.from({ length: 15 }, () => rejected()), {
    successes: 0,
    free: 0,
    paid: 0,
    common: 0,
    epic: 0,
    balance: 49,
  })
})

test('normal with 100 gems: two successes and 13 rejections', async t => {
  await runFifteen(t, {
    state: initialState(100),
  }, Array.from({ length: 15 }, (_, index) =>
    index < 2 ? success(50) : rejected()
  ), {
    successes: 2,
    free: 0,
    paid: 2,
    common: 2,
    epic: 0,
    balance: 0,
  })
})

test('VIP with zero gems: one free success followed by 14 rejections', async t => {
  await runFifteen(t, {
    state: initialState(0),
    subscription: vipSubscription(),
  }, Array.from({ length: 15 }, (_, index) =>
    index === 0 ? success(0) : rejected()
  ), {
    successes: 1,
    free: 1,
    paid: 0,
    common: 1,
    epic: 0,
    balance: 0,
  })
})

test('history insert failure rolls back debit, pity reward and inventory', async t => {
  const plans = Array.from({ length: 15 }, (_, index) => {
    if (index === 9) return historyFailure(50, 'epic')
    if (index === 10) return success(50, 'epic')
    return success(50)
  })

  const result = await runFifteen(t, {
    state: initialState(1000),
  }, plans, {
    successes: 14,
    free: 0,
    paid: 14,
    common: 13,
    epic: 1,
    balance: 300,
  })

  const failed = result.records[9]
  const retry = result.records[10]
  assert.equal(failed.effectiveDebits, 1)
  assert.equal(failed.confirmedDebits, 0)
  assert.deepEqual(failed.pityRows, retry.pityRows)
  assert.equal(result.newHistory[9].reward_tier, 'epic')

  assert.equal(failed.commit, 0)
  assert.equal(failed.rollback, 1)
  assert.deepEqual(failed.sql, [
    'subscription',
    'balances',
    'debit',
    'pity',
    'pass',
    'history',
  ])

  assert.equal(retry.commit, 1)
  assert.equal(retry.rollback, 0)
  assert.equal(retry.confirmedDebits, 1)

  assert.equal(result.final.inventory.length, 1)
  assert.equal(result.final.gemTransactions.length, 14)
  assert.equal(result.newHistory.length, 14)
})

test('DIAGNOSTIC INJECTED FAULT: eligibility lookup always misses, producing 15 free spins', async t => {
  const result = await runFifteen(t, {
    state: initialState(1000),
    subscription: vipSubscription(),
    injectEligibilityMiss: true,
  }, fifteenSuccesses(() => 0), {
    successes: 15,
    free: 15,
    paid: 0,
    common: 14,
    epic: 1,
    balance: 1000,
  })

  assert.equal(result.newHistory.length, 15)
  assert.ok(result.records.every(record => record.freeLookup === null))
  // Solo reproduce el síntoma bajo un fallo deliberadamente inyectado.
  // No demuestra que producción haya leído incorrectamente el historial.
})