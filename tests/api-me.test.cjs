// Pruebas aisladas de /api/me: sin .env, base de datos ni servicios externos.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const VERIFIED_ID = '123456789'
const FORGED_ID = '999999999'

const USER = {
  telegram_id: VERIFIED_ID,
  first_name: 'Synthetic user',
}

const routePath = path.resolve(__dirname, '../app/api/me/route.ts')

const compiledRoute = ts.transpileModule(
  readFileSync(routePath, 'utf8'),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    },
  }
).outputText

function authenticated() {
  // Representa el contrato del autenticador tras verificar una firma.
  // No pretende validar criptografía dentro de esta prueba unitaria.
  return {
    ok: true,
    telegramId: VERIFIED_ID,
    data: {
      auth_date: 1800000000,
      user: { id: Number(VERIFIED_ID) },
    },
  }
}

function requestFor(headers = {}, query = '') {
  return new Request(`https://example.invalid/api/me${query}`, {
    headers,
  })
}

function loadRoute(t, options = {}) {
  const calls = {
    authentication: [],
    ensureUser: [],
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
            headers: {
              'content-type': 'application/json',
            },
          })
        },
      },
    },
    '@/lib/telegram-auth': {
      async authenticateTelegramRequest(request) {
        calls.authentication.push(request)
        calls.order.push('authenticate')

        if (options.authenticate) {
          return options.authenticate(request)
        }

        return authenticated()
      },
    },
    '@/lib/db-queries': {
      async ensureUser(telegramId) {
        calls.ensureUser.push(telegramId)
        calls.order.push('ensureUser')

        if (options.ensureUser) {
          return options.ensureUser(telegramId)
        }

        return USER
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
      }),
    },
    console: new Proxy({}, {
      get(_target, method) {
        if (method === 'error') {
          return (...args) => {
            calls.logs.push(args)
          }
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

  assert.equal(typeof exports.GET, 'function')
  assert.equal(exports.dynamic, 'force-dynamic')

  return { GET: exports.GET, calls }
}

async function assertResponse(response, status, body) {
  assert.ok(response instanceof Response)
  assert.equal(response.status, status)
  assert.deepEqual(await response.json(), body)
}

function assertAuthenticationOnly(calls, request) {
  assert.equal(calls.authentication.length, 1)
  assert.equal(calls.authentication[0], request)
  assert.deepEqual(calls.ensureUser, [])
  assert.deepEqual(calls.order, ['authenticate'])
  assert.deepEqual(calls.logs, [])
}

function assertAuthenticatedLookup(calls, request) {
  assert.equal(calls.authentication.length, 1)
  assert.equal(calls.authentication[0], request)
  assert.deepEqual(calls.ensureUser, [VERIFIED_ID])
  assert.deepEqual(calls.order, ['authenticate', 'ensureUser'])
}

test('returns 401 without Authorization and never calls ensureUser', async t => {
  const request = requestFor()
  const { GET, calls } = loadRoute(t, {
    authenticate(received) {
      assert.equal(received.headers.get('authorization'), null)

      return { ok: false, status: 401, error: 'No autorizado' }
    },
  })

  await assertResponse(await GET(request), 401, {
    error: 'No autorizado',
  })

  assertAuthenticationOnly(calls, request)
})

test('does not authenticate through a forged identity header', async t => {
  const request = requestFor({
    'x-telegram-id-validated': FORGED_ID,
  })

  const { GET, calls } = loadRoute(t, {
    authenticate(received) {
      assert.equal(received.headers.get('authorization'), null)
      assert.equal(
        received.headers.get('x-telegram-id-validated'),
        FORGED_ID
      )

      return { ok: false, status: 401, error: 'No autorizado' }
    },
  })

  await assertResponse(await GET(request), 401, {
    error: 'No autorizado',
  })

  assertAuthenticationOnly(calls, request)
})

test('uses only the verified ID returned by authentication', async t => {
  const authorization = 'tma synthetic-mocked-init-data'
  const request = requestFor({
    Authorization: authorization,
    'x-telegram-id-validated': FORGED_ID,
  }, `?telegramId=${FORGED_ID}&user_id=${FORGED_ID}`)

  const { GET, calls } = loadRoute(t, {
    authenticate(received) {
      assert.equal(received.headers.get('authorization'), authorization)
      assert.equal(
        received.headers.get('x-telegram-id-validated'),
        FORGED_ID
      )

      return authenticated()
    },
  })

  await assertResponse(await GET(request), 200, { user: USER })

  assertAuthenticatedLookup(calls, request)
  assert.deepEqual(calls.logs, [])
})

test('returns 401 when authentication rejects provided credentials', async t => {
  const request = requestFor({
    Authorization: 'tma synthetic-invalid-init-data',
    'x-telegram-id-validated': FORGED_ID,
  })

  const { GET, calls } = loadRoute(t, {
    authenticate() {
      return { ok: false, status: 401, error: 'No autorizado' }
    },
  })

  await assertResponse(await GET(request), 401, {
    error: 'No autorizado',
  })

  assertAuthenticationOnly(calls, request)
})

test('preserves the 503 configuration failure from authentication', async t => {
  const request = requestFor({
    Authorization: 'tma synthetic-mocked-init-data',
  })

  const { GET, calls } = loadRoute(t, {
    authenticate() {
      return {
        ok: false,
        status: 503,
        error: 'Servicio de autenticación no disponible',
      }
    },
  })

  await assertResponse(await GET(request), 503, {
    error: 'Servicio de autenticación no disponible',
  })

  assertAuthenticationOnly(calls, request)
})

test('returns generic 500 for unexpected authentication errors', async t => {
  const request = requestFor({
    Authorization: 'tma synthetic-private-input',
  })

  const { GET, calls } = loadRoute(t, {
    async authenticate() {
      throw new Error('synthetic private authentication detail')
    },
  })

  await assertResponse(await GET(request), 500, {
    error: 'Error interno del servidor',
  })

  assertAuthenticationOnly(calls, request)
})

test('preserves the successful user response without changing the user', async t => {
  const user = {
    ...USER,
    gems: 17,
    referral_code: 'synthetic-referral',
    extra: { preserved: true },
  }

  const original = JSON.stringify(user)
  const request = requestFor({
    Authorization: 'tma synthetic-mocked-init-data',
  })
  const { GET, calls } = loadRoute(t, {
    ensureUser() {
      return user
    },
  })

  await assertResponse(await GET(request), 200, { user })

  assertAuthenticatedLookup(calls, request)
  assert.deepEqual(calls.logs, [])
  assert.equal(JSON.stringify(user), original)
})

test('preserves the business error when ensureUser returns no user', async t => {
  for (const user of [null, undefined]) {
    const request = requestFor({
      Authorization: 'tma synthetic-mocked-init-data',
    })
    const { GET, calls } = loadRoute(t, {
      ensureUser() {
        return user
      },
    })

    await assertResponse(await GET(request), 500, {
      error: 'No se pudo cargar la cuenta',
    })

    assertAuthenticatedLookup(calls, request)
    assert.deepEqual(calls.logs, [])
  }
})

test('preserves business exception details and existing logging', async t => {
  const failures = [
    {
      thrown: new Error('synthetic database failure'),
      detail: 'synthetic database failure',
    },
    {
      thrown: 'synthetic non-Error failure',
      detail: 'synthetic non-Error failure',
    },
  ]

  for (const { thrown, detail } of failures) {
    const request = requestFor({
      Authorization: 'tma synthetic-mocked-init-data',
    })
    const { GET, calls } = loadRoute(t, {
      async ensureUser() {
        throw thrown
      },
    })

    await assertResponse(await GET(request), 500, {
      error: 'Error interno',
      detail,
    })

    assertAuthenticatedLookup(calls, request)
    assert.equal(calls.logs.length, 1)
    assert.equal(calls.logs[0][0], '[me] error:')
    assert.equal(calls.logs[0][1], thrown)
  }
})