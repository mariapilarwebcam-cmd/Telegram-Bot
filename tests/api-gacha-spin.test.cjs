// Pruebas aisladas de autenticación de /api/gacha/spin.
// Sin autenticador real, Turso, credenciales, red, pagos ni generación.
// Los mocks no demuestran criptografía, atomicidad ni concurrencia real.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const VERIFIED_ID = '123456789'
const FORGED_ID = '999999999'
const AUTHORIZATION = 'tma synthetic-mocked-init-data'

const UNAUTHORIZED = {
  ok: false,
  status: 401,
  error: 'No autorizado',
}

const UNAVAILABLE = {
  ok: false,
  status: 503,
  error: 'Servicio de autenticación no disponible',
}

// Expectativa independiente del código fuente del handler.
const SUBSCRIPTION_SQL = `
  SELECT * FROM subscriptions
  WHERE telegram_id = ?
    AND status = 'active'
    AND expires_at > datetime('now')
  ORDER BY expires_at DESC
  LIMIT 1
`
const BALANCES_SQL = `
  SELECT purchased_gems, gems FROM users WHERE telegram_id = ?
`
const DEBIT_SQL = `
  UPDATE users
  SET purchased_gems = purchased_gems - ?, gems = gems - ?
  WHERE telegram_id = ? AND purchased_gems >= ?
  RETURNING purchased_gems, gems
`

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

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim()
}

function authenticated() {
  // Simula el contrato del helper, no una firma válida de Telegram.
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
    ensureUser: [],
    subscriptions: [],
    transactions: [],
    body: 0,
    logs: [],
    forbidden: [],
    order: [],
  }

  function forbidden(operation) {
    calls.forbidden.push(operation)
    throw new Error(`Forbidden operation: ${operation}`)
  }

  t.after(() => {
    assert.deepEqual(calls.forbidden, [])
  })

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
    '@/lib/db-queries': {
      async ensureUser(telegramId) {
        calls.ensureUser.push(telegramId)
        calls.order.push('ensureUser')

        if (!Object.prototype.hasOwnProperty.call(options, 'user')) {
          return forbidden('ensureUser:unexpected')
        }

        return options.user
      },
      getActiveSubscription() {
        return forbidden('getActiveSubscription outside transaction')
      },
      insertGemTransaction() {
        return forbidden('insertGemTransaction')
      },
    },
    '@/lib/turso': {
      queryOne() {
        return forbidden('queryOne')
      },
      execute() {
        return forbidden('execute')
      },
      db: {
        execute() {
          return forbidden('db.execute outside transaction')
        },
        async transaction(...args) {
          if (!options.allowDebit) {
            return forbidden('transaction:unexpected')
          }

          const record = {
            args,
            execute: [],
            commit: 0,
            rollback: 0,
          }
          calls.transactions.push(record)
          calls.order.push('transaction')

          const steps = [
            {
              key: 'subscription',
              sql: normalizeSql(SUBSCRIPTION_SQL),
              args: [VERIFIED_ID],
            },
            {
              key: 'balances',
              sql: normalizeSql(BALANCES_SQL),
              args: [VERIFIED_ID],
            },
            {
              key: 'debit',
              sql: normalizeSql(DEBIT_SQL),
              args: [50, 50, VERIFIED_ID, 50],
            },
          ]
          let cursor = 0
          let closed = false

          function ensureOpen() {
            if (closed) return forbidden('transaction:operation-after-close')
          }

          return {
            async execute(statement) {
              ensureOpen()
              const actual = {
                sql: normalizeSql(statement.sql),
                args: Array.from(statement.args),
              }
              record.execute.push(actual)
              const expected = steps[cursor]

              if (!expected) {
                return forbidden('transaction:unexpected-sql')
              }

              if (
                actual.sql !== expected.sql ||
                actual.args.length !== expected.args.length ||
                actual.args.some((value, index) => value !== expected.args[index])
              ) {
                return forbidden(`transaction:unexpected-${expected.key}`)
              }

              cursor += 1
              calls.order.push(expected.key)

              if (expected.key === 'subscription') {
                calls.subscriptions.push(actual.args[0])
                // Sin VIP: no se consulta elegibilidad gratuita.
                return { rowsAffected: 0, rows: [] }
              }

              if (expected.key === 'balances') {
                return {
                  rowsAffected: 0,
                  rows: [{
                    purchased_gems: options.user.purchased_gems,
                    gems: options.user.gems,
                  }],
                }
              }

              // Rechazo sintético del débito, sin tocar ningún saldo real.
              return { rowsAffected: 0, rows: [] }
            },
            async rollback() {
              ensureOpen()
              if (cursor !== steps.length) {
                return forbidden('transaction:rollback-before-expected-sql')
              }
              record.rollback += 1
              calls.order.push('rollback')
              closed = true
            },
            async commit() {
              ensureOpen()
              record.commit += 1
              return forbidden('commit')
            },
          }
        },
      },
    },
    '@/lib/constants': {
      // No se carga el módulo real ni se recorren ramas de premios.
      CHARACTER_NAMES_FEMALE: Object.freeze({}),
      CHARACTER_NAMES_MALE: Object.freeze({}),
      PERSONALITIES: Object.freeze({}),
    },
  }

  const exports = {}
  const isolatedMath = Object.create(Math)
  Object.defineProperty(isolatedMath, 'random', {
    value() {
      return forbidden('Math.random')
    },
  })

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
    Math: isolatedMath,
    fetch: () => forbidden('fetch'),
    XMLHttpRequest: function () {
      return forbidden('XMLHttpRequest')
    },
    WebSocket: function () {
      return forbidden('WebSocket')
    },
  }, { filename: routePath, timeout: 1000 })

  assert.equal(typeof exports.POST, 'function')

  function requestFor(requestOptions = {}) {
    const headers = new Headers({ 'content-type': 'application/json' })

    if (requestOptions.authorization !== false) {
      headers.set(
        'Authorization',
        requestOptions.authorization ?? AUTHORIZATION
      )
    }

    for (const [name, value] of Object.entries(
      requestOptions.headers ?? {}
    )) {
      headers.set(name, value)
    }

    const request = new Request(
      `https://example.invalid/api/gacha/spin${requestOptions.query ?? ''}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(
          requestOptions.body ?? { telegram_id: FORGED_ID }
        ),
      }
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
  assert.equal(calls.authentication.length, 1)
  assert.equal(calls.authentication[0], request)
  assert.equal(calls.body, 0)
  assert.equal(request.bodyUsed, false)
  assert.deepEqual(calls.ensureUser, [])
  assert.deepEqual(calls.subscriptions, [])
  assert.deepEqual(calls.transactions, [])
  assert.deepEqual(calls.order, ['authenticate'])
  assert.deepEqual(calls.logs, [])
}

test('returns 401 without Authorization and performs no economic calls', async t => {
  const { POST, calls, requestFor } = loadRoute(t, {
    authenticate(request) {
      assert.equal(request.headers.get('authorization'), null)
      return UNAUTHORIZED
    },
  })
  const request = requestFor({ authorization: false })

  await assertResponse(await POST(request), 401, {
    error: 'No autorizado',
  })
  assertAuthenticationOnly(calls, request)
})

test('a forged internal identity header does not grant access', async t => {
  const { POST, calls, requestFor } = loadRoute(t, {
    authenticate(request) {
      assert.equal(
        request.headers.get('x-telegram-id-validated'),
        FORGED_ID
      )
      return UNAUTHORIZED
    },
  })
  const request = requestFor({
    authorization: false,
    headers: { 'x-telegram-id-validated': FORGED_ID },
  })

  await assertResponse(await POST(request), 401, {
    error: 'No autorizado',
  })
  assertAuthenticationOnly(calls, request)
})

test('propagates a known 401 authentication rejection', async t => {
  const { POST, calls, requestFor } = loadRoute(t, {
    authenticate(request) {
      assert.equal(
        request.headers.get('authorization'),
        'tma synthetic-invalid-init-data'
      )
      return UNAUTHORIZED
    },
  })
  const request = requestFor({
    authorization: 'tma synthetic-invalid-init-data',
  })

  await assertResponse(await POST(request), 401, {
    error: 'No autorizado',
  })
  assertAuthenticationOnly(calls, request)
})

test('propagates authentication configuration failure as 503', async t => {
  const { POST, calls, requestFor } = loadRoute(t, {
    authenticate() {
      return UNAVAILABLE
    },
  })
  const request = requestFor()

  await assertResponse(await POST(request), 503, {
    error: 'Servicio de autenticación no disponible',
  })
  assertAuthenticationOnly(calls, request)
})

test('unexpected authentication exceptions return only a generic 500', async t => {
  const { POST, calls, requestFor } = loadRoute(t, {
    authenticate() {
      throw new Error('synthetic-private-authentication-detail')
    },
  })
  const request = requestFor()

  await assertResponse(await POST(request), 500, {
    error: 'Error interno del servidor',
  })
  assertAuthenticationOnly(calls, request)
})

test('identity comes only from authentication.telegramId', async t => {
  const { POST, calls, requestFor } = loadRoute(t, {
    authenticate() {
      return {
        ...authenticated(),
        // Contrato sintético contradictorio para detectar otra fuente.
        data: { user: { id: Number(FORGED_ID) } },
      }
    },
    user: null,
  })
  const request = requestFor({
    headers: { 'x-telegram-id-validated': FORGED_ID },
    query: `?telegram_id=${FORGED_ID}`,
    body: { telegram_id: FORGED_ID, user_id: FORGED_ID },
  })

  await assertResponse(await POST(request), 500, {
    error: 'Error cargando cuenta',
  })
  assert.equal(calls.authentication.length, 1)
  assert.equal(calls.authentication[0], request)
  assert.deepEqual(calls.ensureUser, [VERIFIED_ID])
  assert.deepEqual(calls.subscriptions, [])
  assert.deepEqual(calls.transactions, [])
  assert.deepEqual(calls.order, ['authenticate', 'ensureUser'])
  assert.deepEqual(calls.logs, [])
  assert.equal(calls.body, 0)
  assert.equal(request.bodyUsed, false)
})

test('no economic calls occur while authentication is pending', async t => {
  let finishAuthentication
  const authenticationResult = new Promise(resolve => {
    finishAuthentication = resolve
  })
  const { POST, calls, requestFor } = loadRoute(t, {
    authenticate() {
      return authenticationResult
    },
  })
  const request = requestFor()
  const pendingResponse = POST(request)

  try {
    assertAuthenticationOnly(calls, request)
  } finally {
    // Completar siempre la promesa para no dejar la petición pendiente.
    finishAuthentication(UNAUTHORIZED)
    await pendingResponse
  }

  await assertResponse(await pendingResponse, 401, {
    error: 'No autorizado',
  })
  assertAuthenticationOnly(calls, request)
})

test('valid authentication reaches the existing mocked debit and 402 response', async t => {
  const { POST, calls, requestFor } = loadRoute(t, {
    user: {
      telegram_id: VERIFIED_ID,
      gems: 0,
      purchased_gems: 0,
      bonus_gems: 100,
    },
    allowDebit: true,
  })
  const request = requestFor({
    headers: { 'x-telegram-id-validated': FORGED_ID },
  })

  await assertResponse(await POST(request), 402, {
    error: 'insufficient_gems',
    message: 'Necesitas 50 gemas compradas.',
  })

  assert.equal(calls.authentication.length, 1)
  assert.equal(calls.authentication[0], request)
  assert.deepEqual(calls.ensureUser, [VERIFIED_ID])
  assert.deepEqual(calls.subscriptions, [VERIFIED_ID])
  assert.equal(calls.transactions.length, 1)

  const record = calls.transactions[0]
  assert.deepEqual(record.args, ['write'])
  assert.deepEqual(record.execute, [{
    sql: normalizeSql(SUBSCRIPTION_SQL),
    args: [VERIFIED_ID],
  }, {
    sql: normalizeSql(BALANCES_SQL),
    args: [VERIFIED_ID],
  }, {
    sql: normalizeSql(DEBIT_SQL),
    args: [50, 50, VERIFIED_ID, 50],
  }])
  assert.equal(record.rollback, 1)
  assert.equal(record.commit, 0)
  assert.deepEqual(calls.order, [
    'authenticate',
    'ensureUser',
    'transaction',
    'subscription',
    'balances',
    'debit',
    'rollback',
  ])
  assert.deepEqual(calls.logs, [])
  assert.equal(calls.body, 0)
  assert.equal(request.bodyUsed, false)
})

test('handler imports and awaits the authentication helper structurally', () => {
  const source = ts.createSourceFile(
    routePath,
    routeSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const helperImports = []
  const helperCalls = []
  const internalHeaderReads = []

  function visit(node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === '@/lib/telegram-auth'
    ) {
      const bindings = node.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        helperImports.push(
          ...bindings.elements.map(element => ({
            imported: (element.propertyName ?? element.name).text,
            local: element.name.text,
          }))
        )
      }
    }

    if (ts.isCallExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'authenticateTelegramRequest'
      ) {
        helperCalls.push(node)
      }

      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'get' &&
        node.arguments.some(argument =>
          ts.isStringLiteral(argument) &&
          argument.text === 'x-telegram-id-validated'
        )
      ) {
        internalHeaderReads.push(node)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(source)

  assert.deepEqual(helperImports, [{
    imported: 'authenticateTelegramRequest',
    local: 'authenticateTelegramRequest',
  }])
  assert.equal(helperCalls.length, 1)
  assert.equal(helperCalls[0].arguments.length, 1)
  assert.equal(helperCalls[0].arguments[0].getText(source), 'request')
  assert.ok(ts.isAwaitExpression(helperCalls[0].parent))
  assert.equal(internalHeaderReads.length, 0)
})