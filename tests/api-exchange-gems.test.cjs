// Pruebas aisladas: sin autenticador real, Turso, credenciales ni red.
// Los mocks no demuestran atomicidad ni concurrencia real.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const VERIFIED_ID = '123456789'
const FORGED_ID = '999999999'
const AUTHORIZATION = 'tma synthetic-mocked-init-data'
const INVALID_AMOUNT =
  'Cantidad inválida. Debes cambiar un número par de gemas (mínimo 2).'
const INSUFFICIENT =
  'No tienes suficientes gemas para hacer este cambio.'
const INTERNAL_ERROR = 'Error interno al procesar el cambio'

// Expectativas independientes del código fuente de la ruta.
const DEBIT_SQL = `
  UPDATE users
  SET gems = gems - ?,
      purchased_gems = MAX(COALESCE(purchased_gems, 0) - ?, 0),
      updated_at = datetime('now')
  WHERE telegram_id = ? AND gems >= ?
  RETURNING gems, bonus_gems
`
const CREDIT_SQL = `
  UPDATE users
  SET bonus_gems = COALESCE(bonus_gems, 0) + ?,
      updated_at = datetime('now')
  WHERE telegram_id = ?
  RETURNING gems, bonus_gems
`
const HISTORY_SQL = `
  INSERT INTO gem_transactions
    (telegram_id, amount, transaction_type, description)
  VALUES (?, ?, ?, ?)
`

const routePath = path.resolve(
  __dirname,
  '../app/api/exchange-gems/route.ts'
)
const routeSource = readFileSync(routePath, 'utf8')
const compiledRoute = ts.transpileModule(routeSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim()
}

function authenticated() {
  return {
    ok: true,
    telegramId: VERIFIED_ID,
    data: {
      auth_date: 1800000000,
      user: { id: Number(VERIFIED_ID) },
    },
  }
}

function loadRoute(t, options = {}) {
  const calls = {
    authentication: [],
    body: 0,
    transactions: [],
    logs: [],
    forbidden: [],
    order: [],
  }

  function forbidden(operation) {
    calls.forbidden.push(operation)
    throw new Error(`Forbidden operation: ${operation}`)
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
        calls.authentication.push(request)
        calls.order.push('authenticate')
        return options.authenticate
          ? options.authenticate(request)
          : authenticated()
      },
    },
    '@/lib/turso': {
      db: {
        async transaction(...args) {
          const index = calls.transactions.length
          const script = options.transactions?.[index] ?? {}
          const record = {
            args,
            execute: [],
            commit: 0,
            rollback: 0,
          }
          calls.transactions.push(record)
          calls.order.push(`tx${index}:open`)

          if (script.openError) throw script.openError

          const results = script.results ?? [
            { rows: [{ gems: 18, bonus_gems: 5 }] },
            { rows: [{ gems: 18, bonus_gems: 8 }] },
            { rows: [] },
          ]

          return {
            async execute(statement) {
              const step = record.execute.length
              record.execute.push({
                sql: statement.sql,
                // Convertir el array del contexto VM al contexto del test.
                args: Array.from(statement.args),
              })
              calls.order.push(`tx${index}:sql${step}`)

              if (step >= results.length) {
                return forbidden(`tx${index}:unexpected-sql${step}`)
              }
              if (script.sqlError && script.failAt === step) {
                throw script.sqlError
              }
              return results[step]
            },
            async commit() {
              record.commit += 1
              calls.order.push(`tx${index}:commit`)
              if (script.commitError) throw script.commitError
            },
            async rollback() {
              record.rollback += 1
              calls.order.push(`tx${index}:rollback`)
              const failure = script.rollbackErrors?.[record.rollback - 1]
              if (failure) throw failure
            },
          }
        },
      },
    },
  }

  const exports = {}
  vm.runInNewContext(compiledRoute, {
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
          return forbidden(`env:${String(key)}`)
        },
        set(_target, key) {
          return forbidden(`env-write:${String(key)}`)
        },
      }),
    },
    console: new Proxy({}, {
      get(_target, method) {
        if (method === 'error') {
          return (...args) => calls.logs.push(args)
        }
        return () => forbidden(`console:${String(method)}`)
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

  t.after(() => {
    assert.deepEqual(calls.forbidden, [])
  })
  assert.equal(typeof exports.POST, 'function')

  function requestFor(body = { gems: 2 }, requestOptions = {}) {
    const headers = new Headers({ 'content-type': 'application/json' })
    if (requestOptions.authorization !== false) {
      headers.set('Authorization', AUTHORIZATION)
    }
    for (const [name, value] of Object.entries(
      requestOptions.headers ?? {}
    )) {
      headers.set(name, value)
    }

    const rawBody = Object.prototype.hasOwnProperty.call(
      requestOptions,
      'rawBody'
    )
      ? requestOptions.rawBody
      : JSON.stringify(body)
    const request = new Request(
      `https://example.invalid/api/exchange-gems${requestOptions.query ?? ''}`,
      { method: 'POST', headers, body: rawBody }
    )
    const originalJson = request.json.bind(request)
    Object.defineProperty(request, 'json', {
      value() {
        calls.body += 1
        calls.order.push('body')
        return originalJson()
      },
    })
    return request
  }

  return { POST: exports.POST, calls, requestFor }
}

async function assertResponse(response, status, body) {
  assert.ok(response instanceof Response)
  assert.equal(response.status, status)
  assert.deepEqual(await response.json(), body)
}

function assertAuthenticationOnly(calls, request) {
  assert.deepEqual(calls.authentication, [request])
  assert.equal(calls.body, 0)
  assert.equal(request.bodyUsed, false)
  assert.deepEqual(calls.transactions, [])
  assert.deepEqual(calls.order, ['authenticate'])
  assert.deepEqual(calls.logs, [])
}

function assertBodyRead(calls, request) {
  assert.deepEqual(calls.authentication, [request])
  assert.equal(calls.body, 1)
  assert.equal(request.bodyUsed, true)
}

function expectedStatements(gems = 2, messages = 3) {
  return [
    {
      sql: normalizeSql(DEBIT_SQL),
      args: [gems, gems, VERIFIED_ID, gems],
    },
    {
      sql: normalizeSql(CREDIT_SQL),
      args: [messages, VERIFIED_ID],
    },
    {
      sql: normalizeSql(HISTORY_SQL),
      args: [
        VERIFIED_ID,
        -gems,
        'exchange',
        `Cambio de ${gems} gemas por ${messages} mensajes`,
      ],
    },
  ]
}

function assertStatements(record, gems = 2, messages = 3, count = 3) {
  assert.deepEqual(record.args, ['write'])
  assert.deepEqual(
    record.execute.map(statement => ({
      sql: normalizeSql(statement.sql),
      args: statement.args,
    })),
    expectedStatements(gems, messages).slice(0, count)
  )
}

function successBody(
  gems = 2,
  messages = 3,
  remainingGems = 18,
  remainingMessages = 8
) {
  return {
    success: true,
    remaining_gems: remainingGems,
    remaining_bonus_gems: remainingMessages,
    exchanged: { gems, messages },
  }
}

function successOrder(index = 0) {
  return [
    'authenticate',
    'body',
    `tx${index}:open`,
    `tx${index}:sql0`,
    `tx${index}:sql1`,
    `tx${index}:sql2`,
    `tx${index}:commit`,
  ]
}

function assertSuccess(calls, request, gems = 2, messages = 3) {
  assertBodyRead(calls, request)
  assert.equal(calls.transactions.length, 1)
  const record = calls.transactions[0]
  assertStatements(record, gems, messages)
  assert.equal(record.commit, 1)
  assert.equal(record.rollback, 0)
  assert.deepEqual(calls.order, successOrder())
  assert.deepEqual(calls.logs, [])
}

function assertEconomicLog(calls, failure) {
  assert.equal(calls.logs.length, 1)
  assert.equal(calls.logs[0][0], '[exchange-gems] Error:')
  assert.equal(calls.logs[0][1], failure)
}

test('rejects missing Authorization without reading body or opening a transaction', async t => {
  const { POST, calls, requestFor } = loadRoute(t, {
    authenticate(request) {
      assert.equal(request.headers.get('authorization'), null)
      return { ok: false, status: 401, error: 'No autorizado' }
    },
  })
  const request = requestFor({ gems: 2 }, { authorization: false })
  await assertResponse(await POST(request), 401, { error: 'No autorizado' })
  assertAuthenticationOnly(calls, request)
})

test('rejects forged identity headers without Authorization', async t => {
  const { POST, calls, requestFor } = loadRoute(t, {
    authenticate(request) {
      assert.equal(request.headers.get('authorization'), null)
      assert.equal(
        request.headers.get('x-telegram-id-validated'),
        FORGED_ID
      )
      assert.equal(request.headers.get('x-telegram-id'), FORGED_ID)
      return { ok: false, status: 401, error: 'No autorizado' }
    },
  })
  const request = requestFor({ gems: 2 }, {
    authorization: false,
    headers: {
      'x-telegram-id-validated': FORGED_ID,
      'x-telegram-id': FORGED_ID,
    },
  })
  await assertResponse(await POST(request), 401, { error: 'No autorizado' })
  assertAuthenticationOnly(calls, request)
})

test('uses only authenticated telegramId in all economic statements', async t => {
  const { POST, calls, requestFor } = loadRoute(t, {
    authenticate(request) {
      assert.equal(request.headers.get('authorization'), AUTHORIZATION)
      // Incluso data.user.id no debe sustituir a telegramId en la ruta.
      return {
        ...authenticated(),
        data: { ...authenticated().data, user: { id: Number(FORGED_ID) } },
      }
    },
  })
  const request = requestFor({
    gems: 2,
    telegram_id: FORGED_ID,
    telegramId: FORGED_ID,
    user_id: FORGED_ID,
    user: { id: Number(FORGED_ID) },
  }, {
    query: `?telegramId=${FORGED_ID}&user_id=${FORGED_ID}`,
    headers: {
      'x-telegram-id-validated': FORGED_ID,
      'x-telegram-id': FORGED_ID,
    },
  })
  await assertResponse(await POST(request), 200, successBody())
  assertSuccess(calls, request)
})

test('propagates authenticator 401 and 503 without economic operations', async t => {
  for (const failure of [
    { ok: false, status: 401, error: 'No autorizado' },
    {
      ok: false,
      status: 503,
      error: 'Servicio de autenticación no disponible',
    },
  ]) {
    const { POST, calls, requestFor } = loadRoute(t, {
      authenticate() {
        return failure
      },
    })
    const request = requestFor({}, { rawBody: '{invalid-json' })
    await assertResponse(await POST(request), failure.status, {
      error: failure.error,
    })
    assertAuthenticationOnly(calls, request)
  }
})

test('returns generic authentication 500 without economic operations', async t => {
  const { POST, calls, requestFor } = loadRoute(t, {
    async authenticate() {
      throw new Error('synthetic private authentication detail')
    },
  })
  const request = requestFor()
  await assertResponse(await POST(request), 500, {
    error: 'Error interno del servidor',
  })
  assertAuthenticationOnly(calls, request)
})

test('waits for authentication before body and transaction', async t => {
  let finishAuthentication
  const pending = new Promise(resolve => {
    finishAuthentication = resolve
  })
  const { POST, calls, requestFor } = loadRoute(t, {
    authenticate() {
      return pending
    },
  })
  const request = requestFor()
  const response = POST(request)
  try {
    assertAuthenticationOnly(calls, request)
  } finally {
    finishAuthentication(authenticated())
  }
  await assertResponse(await response, 200, successBody())
  assertSuccess(calls, request)
})

test('preserves current gems type integer minimum and parity validation', async t => {
  const bodies = [
    {}, [], 'synthetic', 2,
    { gems: null }, { gems: '2' }, { gems: true }, { gems: false },
    { gems: [] }, { gems: [2] }, { gems: {} },
    { gems: -2 }, { gems: 0 }, { gems: 1 },
    { gems: 2.5 }, { gems: 3 }, { gems: 5 },
  ]
  for (const body of bodies) {
    const { POST, calls, requestFor } = loadRoute(t)
    const request = requestFor(body)
    await assertResponse(await POST(request), 400, { error: INVALID_AMOUNT })
    assertBodyRead(calls, request)
    assert.deepEqual(calls.transactions, [])
    assert.deepEqual(calls.order, ['authenticate', 'body'])
    assert.deepEqual(calls.logs, [])
  }
})

test('preserves invalid amount response for malformed JSON', async t => {
  const { POST, calls, requestFor } = loadRoute(t)
  const request = requestFor({}, { rawBody: '{invalid-json' })
  await assertResponse(await POST(request), 400, { error: INVALID_AMOUNT })
  assertBodyRead(calls, request)
  assert.deepEqual(calls.transactions, [])
  assert.deepEqual(calls.order, ['authenticate', 'body'])
  assert.deepEqual(calls.logs, [])
})

test('preserves existing economic 500 for null JSON body', async t => {
  const { POST, calls, requestFor } = loadRoute(t)
  const request = requestFor(null)
  await assertResponse(await POST(request), 500, { error: INTERNAL_ERROR })
  assertBodyRead(calls, request)
  assert.deepEqual(calls.transactions, [])
  assert.deepEqual(calls.order, ['authenticate', 'body'])
  assert.equal(calls.logs.length, 1)
  const failure = calls.logs[0][1]
  assert.equal(failure.name, 'TypeError')
  assert.equal(typeof failure.message, 'string')
  assert.ok(failure.message.length > 0)
  assertEconomicLog(calls, failure)
})

test('preserves two gems to three messages without adding a safe integer limit', async t => {
  for (const [gems, messages] of [
    [2, 3],
    [4, 6],
    [10, 15],
    [9007199254740992, 13510798882111488],
  ]) {
    const { POST, calls, requestFor } = loadRoute(t)
    const request = requestFor({ gems })
    await assertResponse(await POST(request), 200, successBody(gems, messages))
    assertSuccess(calls, request, gems, messages)
  }
})

test('executes exact debit credit history and commit in order', async t => {
  const { POST, calls, requestFor } = loadRoute(t)
  const request = requestFor()
  await assertResponse(await POST(request), 200, successBody())
  assertSuccess(calls, request)
})

test('preserves numeric conversion and default balances from credit rows', async t => {
  const cases = [
    { rows: [{ gems: '12', bonus_gems: '21' }], gems: 12, messages: 21 },
    { rows: [{}], gems: 0, messages: 0 },
    { rows: [{ gems: null, bonus_gems: null }], gems: 0, messages: 0 },
    { rows: [], gems: 0, messages: 0 },
  ]
  for (const scenario of cases) {
    const { POST, calls, requestFor } = loadRoute(t, {
      transactions: [{
        results: [
          { rows: [{ gems: 999, bonus_gems: 888 }] },
          { rows: scenario.rows },
          { rows: [] },
        ],
      }],
    })
    const request = requestFor()
    await assertResponse(await POST(request), 200, successBody(
      2, 3, scenario.gems, scenario.messages
    ))
    assertSuccess(calls, request)
  }
})

test('rolls back insufficient balance without credit history or commit', async t => {
  const { POST, calls, requestFor } = loadRoute(t, {
    transactions: [{ results: [{ rows: [] }] }],
  })
  const request = requestFor()
  await assertResponse(await POST(request), 400, { error: INSUFFICIENT })
  assertBodyRead(calls, request)
  assert.equal(calls.transactions.length, 1)
  const record = calls.transactions[0]
  assertStatements(record, 2, 3, 1)
  assert.equal(record.rollback, 1)
  assert.equal(record.commit, 0)
  assert.deepEqual(calls.order, [
    'authenticate', 'body', 'tx0:open', 'tx0:sql0', 'tx0:rollback',
  ])
  assert.deepEqual(calls.logs, [])
})

test('preserves economic 500 when opening a transaction fails', async t => {
  const failure = new Error('synthetic transaction opening failure')
  const { POST, calls, requestFor } = loadRoute(t, {
    transactions: [{ openError: failure }],
  })
  const request = requestFor()
  await assertResponse(await POST(request), 500, { error: INTERNAL_ERROR })
  assertBodyRead(calls, request)
  assert.deepEqual(calls.transactions, [{
    args: ['write'], execute: [], commit: 0, rollback: 0,
  }])
  assert.deepEqual(calls.order, ['authenticate', 'body', 'tx0:open'])
  assertEconomicLog(calls, failure)
})

test('rolls back SQL failures at each phase and preserves economic 500', async t => {
  for (const failAt of [0, 1, 2]) {
    const failure = new Error(`synthetic SQL failure ${failAt}`)
    const { POST, calls, requestFor } = loadRoute(t, {
      transactions: [{ failAt, sqlError: failure }],
    })
    const request = requestFor()
    await assertResponse(await POST(request), 500, { error: INTERNAL_ERROR })
    assertBodyRead(calls, request)
    assert.equal(calls.transactions.length, 1)
    const record = calls.transactions[0]
    assertStatements(record, 2, 3, failAt + 1)
    assert.equal(record.rollback, 1)
    assert.equal(record.commit, 0)
    assert.deepEqual(calls.order, [
      'authenticate', 'body', 'tx0:open',
      ...Array.from({ length: failAt + 1 }, (_, i) => `tx0:sql${i}`),
      'tx0:rollback',
    ])
    assertEconomicLog(calls, failure)
  }
})

test('attempts rollback after commit failure and preserves economic 500', async t => {
  const failure = new Error('synthetic commit failure')
  const { POST, calls, requestFor } = loadRoute(t, {
    transactions: [{ commitError: failure }],
  })
  const request = requestFor()
  await assertResponse(await POST(request), 500, { error: INTERNAL_ERROR })
  assertBodyRead(calls, request)
  assert.equal(calls.transactions.length, 1)
  const record = calls.transactions[0]
  assertStatements(record)
  assert.equal(record.commit, 1)
  assert.equal(record.rollback, 1)
  assert.deepEqual(calls.order, [...successOrder(), 'tx0:rollback'])
  assertEconomicLog(calls, failure)
})

test('preserves original errors when rollback rejects including insufficient balance', async t => {
  const sqlFailure = new Error('synthetic original SQL failure')
  const firstRollbackFailure = new Error('synthetic first rollback failure')
  const secondRollbackFailure = new Error('synthetic second rollback failure')
  const cases = [
    {
      script: {
        failAt: 0,
        sqlError: sqlFailure,
        rollbackErrors: [firstRollbackFailure],
      },
      expectedError: sqlFailure,
      rollbacks: 1,
    },
    {
      script: {
        results: [{ rows: [] }],
        rollbackErrors: [firstRollbackFailure],
      },
      expectedError: firstRollbackFailure,
      rollbacks: 2,
    },
    {
      script: {
        results: [{ rows: [] }],
        rollbackErrors: [firstRollbackFailure, secondRollbackFailure],
      },
      expectedError: firstRollbackFailure,
      rollbacks: 2,
    },
  ]
  for (const scenario of cases) {
    const { POST, calls, requestFor } = loadRoute(t, {
      transactions: [scenario.script],
    })
    const request = requestFor()
    await assertResponse(await POST(request), 500, { error: INTERNAL_ERROR })
    assertBodyRead(calls, request)
    assert.equal(calls.transactions.length, 1)
    const record = calls.transactions[0]
    assertStatements(record, 2, 3, 1)
    assert.equal(record.commit, 0)
    assert.equal(record.rollback, scenario.rollbacks)
    assert.deepEqual(calls.order, [
      'authenticate', 'body', 'tx0:open', 'tx0:sql0',
      ...Array(scenario.rollbacks).fill('tx0:rollback'),
    ])
    assertEconomicLog(calls, scenario.expectedError)
  }
})

test('repeated requests remain independent without invented idempotency', async t => {
  for (const insufficientSecond of [false, true]) {
    const { POST, calls, requestFor } = loadRoute(t, {
      transactions: [
        {},
        insufficientSecond
          ? { results: [{ rows: [] }] }
          : {
              results: [
                { rows: [{ gems: 16, bonus_gems: 8 }] },
                { rows: [{ gems: 16, bonus_gems: 11 }] },
                { rows: [] },
              ],
            },
      ],
    })
    const first = requestFor()
    const second = requestFor()
    await assertResponse(await POST(first), 200, successBody())
    await assertResponse(
      await POST(second),
      insufficientSecond ? 400 : 200,
      insufficientSecond
        ? { error: INSUFFICIENT }
        : successBody(2, 3, 16, 11)
    )
    assert.deepEqual(calls.authentication, [first, second])
    assert.equal(calls.body, 2)
    assert.equal(first.bodyUsed, true)
    assert.equal(second.bodyUsed, true)
    assert.equal(calls.transactions.length, 2)
    assert.notEqual(calls.transactions[0], calls.transactions[1])
    assertStatements(calls.transactions[0])
    assert.equal(calls.transactions[0].commit, 1)
    assert.equal(calls.transactions[0].rollback, 0)
    assertStatements(calls.transactions[1], 2, 3, insufficientSecond ? 1 : 3)
    assert.equal(calls.transactions[1].commit, insufficientSecond ? 0 : 1)
    assert.equal(calls.transactions[1].rollback, insufficientSecond ? 1 : 0)
    assert.deepEqual(calls.order, [
      ...successOrder(),
      ...(insufficientSecond
        ? ['authenticate', 'body', 'tx1:open', 'tx1:sql0', 'tx1:rollback']
        : successOrder(1)),
    ])
    assert.deepEqual(calls.logs, [])
  }
})

test('keeps expected imports authentication transaction and no identity header read', () => {
  const source = ts.createSourceFile(
    routePath, routeSource, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS
  )
  const imports = []
  const calls = []
  const identityHeaders = []

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const bindings = node.importClause?.namedBindings
      assert.equal(node.importClause?.name, undefined)
      assert.ok(bindings && ts.isNamedImports(bindings))
      imports.push({
        module: node.moduleSpecifier.text,
        bindings: bindings.elements.map(element => {
          assert.equal(element.propertyName, undefined)
          return element.name.text
        }).sort(),
      })
    }
    if (ts.isCallExpression(node)) calls.push(node)
    if (
      ts.isStringLiteralLike(node) &&
      node.text === 'x-telegram-id-validated'
    ) {
      identityHeaders.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  assert.deepEqual(imports, [
    { module: 'next/server', bindings: ['NextResponse'] },
    { module: '@/lib/turso', bindings: ['db'] },
    {
      module: '@/lib/telegram-auth',
      bindings: ['authenticateTelegramRequest'],
    },
  ])
  assert.deepEqual(identityHeaders, [])

  const authenticationCalls = calls.filter(
    call => call.expression.getText(source) === 'authenticateTelegramRequest'
  )
  assert.equal(authenticationCalls.length, 1)
  assert.deepEqual(
    authenticationCalls[0].arguments.map(arg => arg.getText(source)),
    ['request']
  )

  const transactionCalls = calls.filter(
    call => call.expression.getText(source) === 'db.transaction'
  )
  assert.equal(transactionCalls.length, 1)
  assert.equal(transactionCalls[0].arguments.length, 1)
  assert.ok(ts.isStringLiteral(transactionCalls[0].arguments[0]))
  assert.equal(transactionCalls[0].arguments[0].text, 'write')
})