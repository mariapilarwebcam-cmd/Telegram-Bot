// Pruebas aisladas de /api/init-user: sin .env, base de datos ni red.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const VERIFIED_ID = '123456789'
const FORGED_ID = '999999999'
const AUTHORIZATION = 'tma synthetic-mocked-init-data'

const VERIFIED_USER = {
  id: Number(VERIFIED_ID),
  first_name: '  Verified ñ + &  ',
  username: 'verified_telegram_user',
}

const USER = {
  telegram_id: VERIFIED_ID,
  first_name: 'Synthetic user',
}

const DEFAULT_PROFILE = {
  first_name: VERIFIED_USER.first_name,
  username: VERIFIED_USER.username,
  language: 'es',
}

const routePath = path.resolve(
  __dirname,
  '../app/api/init-user/route.ts'
)

const compiledRoute = ts.transpileModule(
  readFileSync(routePath, 'utf8'),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    },
  }
).outputText

function authenticated(user = VERIFIED_USER) {
  // Simula el contrato tras verificar una firma, no la criptografía.
  return {
    ok: true,
    telegramId: VERIFIED_ID,
    data: {
      authDate: new Date(1800000000 * 1000),
      user: { ...user },
    },
  }
}

function loadRoute(t, options = {}) {
  const calls = {
    authentication: [],
    ensureUser: [],
    body: 0,
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
      async ensureUser(telegramId, profile) {
        calls.ensureUser.push([telegramId, profile])
        calls.order.push('ensureUser')

        if (options.ensureUser) {
          return options.ensureUser(telegramId, profile)
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

  assert.equal(typeof exports.POST, 'function')

  function requestFor(body = {}, requestOptions = {}) {
    const headers = new Headers({
      'content-type': 'application/json',
    })

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
      'https://example.invalid/api/init-user',
      {
        method: 'POST',
        headers,
        body: rawBody,
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
  assert.deepEqual(calls.order, ['authenticate'])
  assert.deepEqual(calls.logs, [])
}

function assertAuthenticatedLookup(
  calls,
  request,
  profile,
  order = ['authenticate', 'body', 'ensureUser']
) {
  assert.equal(calls.authentication.length, 1)
  assert.equal(calls.authentication[0], request)
  assert.equal(request.headers.get('authorization'), AUTHORIZATION)
  assert.equal(calls.body, 1)
  assert.equal(request.bodyUsed, true)
  assert.equal(calls.ensureUser.length, 1)
  assert.equal(calls.ensureUser[0][0], VERIFIED_ID)

  // El perfil se crea dentro de node:vm: normalizamos su realm
  // para comparar sus valores y claves con assert/strict.
  const actualProfile = JSON.parse(
    JSON.stringify(calls.ensureUser[0][1])
  )

  assert.deepEqual(actualProfile, profile)
  assert.deepEqual(calls.order, order)
}

test('returns 401 without Authorization before reading body', async t => {
  const { POST, calls, requestFor } = loadRoute(t, {
    authenticate(request) {
      assert.equal(request.headers.get('authorization'), null)

      return { ok: false, status: 401, error: 'No autorizado' }
    },
  })

  const request = requestFor({}, { authorization: false })

  await assertResponse(await POST(request), 401, {
    error: 'No autorizado',
  })

  assertAuthenticationOnly(calls, request)
})

test('rejects a forged identity header without Authorization', async t => {
  const { POST, calls, requestFor } = loadRoute(t, {
    authenticate(request) {
      assert.equal(request.headers.get('authorization'), null)
      assert.equal(
        request.headers.get('x-telegram-id-validated'),
        FORGED_ID
      )

      return { ok: false, status: 401, error: 'No autorizado' }
    },
  })

  const request = requestFor({}, {
    authorization: false,
    headers: { 'x-telegram-id-validated': FORGED_ID },
  })

  await assertResponse(await POST(request), 401, {
    error: 'No autorizado',
  })

  assertAuthenticationOnly(calls, request)
})

test('uses only the authenticated ID and profile despite conflicting body fields', async t => {
  const { POST, calls, requestFor } = loadRoute(t)
  const profile = {
    first_name: 'Synthetic ñ + &',
    username: 'synthetic_user',
    language: 'en',
  }

  const request = requestFor({
    ...profile,
    id: FORGED_ID,
    telegram_id: FORGED_ID,
    telegramId: FORGED_ID,
    user: { id: Number(FORGED_ID) },
  }, {
    headers: { 'x-telegram-id-validated': FORGED_ID },
  })

  await assertResponse(await POST(request), 200, {
    user: USER,
    created: false,
  })

  assertAuthenticatedLookup(calls, request, {
    ...DEFAULT_PROFILE,
    language: 'en',
  })
  assert.deepEqual(calls.logs, [])
})

test('uses null when Telegram has no username despite a body username', async t => {
  const { POST, calls, requestFor } = loadRoute(t, {
    authenticate() {
      return authenticated({
        id: Number(VERIFIED_ID),
        first_name: VERIFIED_USER.first_name,
      })
    },
  })

  const request = requestFor({
    first_name: 'Forged name',
    username: 'forged_username',
    language: 'en',
  })

  await assertResponse(await POST(request), 200, {
    user: USER,
    created: false,
  })

  assertAuthenticatedLookup(calls, request, {
    ...DEFAULT_PROFILE,
    username: null,
    language: 'en',
  })
  assert.deepEqual(calls.logs, [])
})

test('passes signed empty profile strings without falling back to body fields', async t => {
  const { POST, calls, requestFor } = loadRoute(t, {
    authenticate() {
      return authenticated({
        id: Number(VERIFIED_ID),
        first_name: '',
        username: '',
      })
    },
  })

  const request = requestFor({
    first_name: 'Forged name',
    username: 'forged_username',
  })

  await assertResponse(await POST(request), 200, {
    user: USER,
    created: false,
  })

  assertAuthenticatedLookup(calls, request, {
    first_name: '',
    username: '',
    language: 'es',
  })
  assert.deepEqual(calls.logs, [])
})

test('preserves 401 and 503 authentication failures without reading body', async t => {
  const failures = [
    { ok: false, status: 401, error: 'No autorizado' },
    {
      ok: false,
      status: 503,
      error: 'Servicio de autenticación no disponible',
    },
  ]

  for (const failure of failures) {
    const { POST, calls, requestFor } = loadRoute(t, {
      authenticate() {
        return failure
      },
    })

    // Ni siquiera un body inválido debe leerse al rechazar autenticación.
    const request = requestFor({}, { rawBody: '{invalid-json' })

    await assertResponse(await POST(request), failure.status, {
      error: failure.error,
    })

    assertAuthenticationOnly(calls, request)
  }
})

test('returns generic 500 for unexpected authentication errors', async t => {
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

test('finishes asynchronous authentication before reading body', async t => {
  let calls

  const loaded = loadRoute(t, {
    async authenticate(request) {
      assert.equal(request.bodyUsed, false)
      assert.equal(calls.body, 0)

      await Promise.resolve()

      assert.equal(request.bodyUsed, false)
      assert.equal(calls.body, 0)
      calls.order.push('authenticated')

      return authenticated()
    },
  })

  calls = loaded.calls
  const request = loaded.requestFor()

  await assertResponse(await loaded.POST(request), 200, {
    user: USER,
    created: false,
  })

  assertAuthenticatedLookup(calls, request, DEFAULT_PROFILE, [
    'authenticate',
    'authenticated',
    'body',
    'ensureUser',
  ])

  assert.deepEqual(calls.logs, [])
})

test('ignores body profile fields and preserves exact language normalization', async t => {
  const cases = [
    {
      body: {},
      profile: DEFAULT_PROFILE,
    },
    {
      body: {
        first_name: '  Synthetic ñ + &  ',
        username: '@synthetic_user',
        language: 'en',
      },
      profile: {
        ...DEFAULT_PROFILE,
        language: 'en',
      },
    },
    {
      body: { first_name: '', username: '', language: 'es' },
      profile: DEFAULT_PROFILE,
    },
    {
      body: { first_name: null, username: null, language: 'EN' },
      profile: DEFAULT_PROFILE,
    },
    {
      body: { first_name: 123, username: false, language: 'fr' },
      profile: DEFAULT_PROFILE,
    },
    {
      body: { first_name: {}, username: [], language: null },
      profile: DEFAULT_PROFILE,
    },
    {
      body: { first_name: true, username: 123, language: 1 },
      profile: DEFAULT_PROFILE,
    },
    {
      body: { language: ' en ' },
      profile: DEFAULT_PROFILE,
    },
    {
      body: [],
      profile: DEFAULT_PROFILE,
    },
    {
      body: 'synthetic primitive',
      profile: DEFAULT_PROFILE,
    },
    {
      body: 123,
      profile: DEFAULT_PROFILE,
    },
    {
      body: false,
      profile: DEFAULT_PROFILE,
    },
  ]

  for (const { body, profile } of cases) {
    const { POST, calls, requestFor } = loadRoute(t)
    const request = requestFor(body)

    await assertResponse(await POST(request), 200, {
      user: USER,
      created: false,
    })

    assertAuthenticatedLookup(calls, request, profile)
    assert.deepEqual(calls.logs, [])
  }
})

test('preserves the verified profile and language fallback for invalid JSON', async t => {
  const { POST, calls, requestFor } = loadRoute(t)
  const request = requestFor({}, { rawBody: '{invalid-json' })

  await assertResponse(await POST(request), 200, {
    user: USER,
    created: false,
  })

  assertAuthenticatedLookup(calls, request, DEFAULT_PROFILE)
  assert.deepEqual(calls.logs, [])
})

test('preserves the user response and created false without mutation', async t => {
  const user = {
    ...USER,
    username: 'existing_username',
    language: 'en',
    gems: 17,
    purchased_gems: 7,
    bonus_gems: 30,
    referral_code: 'synthetic-referral',
    referred_by: 'synthetic-referrer',
    total_referrals: 3,
    extra: { preserved: true },
  }

  const original = JSON.stringify(user)
  const { POST, calls, requestFor } = loadRoute(t, {
    ensureUser() {
      return user
    },
  })

  const request = requestFor()

  await assertResponse(await POST(request), 200, {
    user,
    created: false,
  })

  assertAuthenticatedLookup(calls, request, DEFAULT_PROFILE)
  assert.deepEqual(calls.logs, [])
  assert.equal(JSON.stringify(user), original)
})

test('preserves the business error when ensureUser returns no user', async t => {
  for (const user of [null, undefined]) {
    const { POST, calls, requestFor } = loadRoute(t, {
      ensureUser() {
        return user
      },
    })

    const request = requestFor()

    await assertResponse(await POST(request), 500, {
      error: 'Error creando usuario',
    })

    assertAuthenticatedLookup(calls, request, DEFAULT_PROFILE)
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
    const { POST, calls, requestFor } = loadRoute(t, {
      async ensureUser() {
        throw thrown
      },
    })

    const request = requestFor()

    await assertResponse(await POST(request), 500, {
      error: 'Error interno',
      detail,
    })

    assertAuthenticatedLookup(calls, request, DEFAULT_PROFILE)
    assert.equal(calls.logs.length, 1)
    assert.equal(calls.logs[0][0], '[init-user] error:')
    assert.equal(calls.logs[0][1], thrown)
  }
})

test('preserves the existing business failure for a null JSON body', async t => {
  const { POST, calls, requestFor } = loadRoute(t)
  const request = requestFor(null)
  const response = await POST(request)

  assert.equal(calls.authentication.length, 1)
  assert.equal(calls.authentication[0], request)
  assert.equal(request.headers.get('authorization'), AUTHORIZATION)
  assert.equal(calls.body, 1)
  assert.equal(request.bodyUsed, true)
  assert.deepEqual(calls.ensureUser, [])
  assert.deepEqual(calls.order, ['authenticate', 'body'])

  assert.equal(calls.logs.length, 1)
  assert.equal(calls.logs[0][0], '[init-user] error:')

  const error = calls.logs[0][1]
  assert.equal(error.name, 'TypeError')
  assert.equal(typeof error.message, 'string')
  assert.ok(error.message.length > 0)

  // No fijamos el texto de TypeError, que puede variar entre versiones.
  // Sí comprobamos que la respuesta conserve el detalle del error registrado.
  await assertResponse(response, 500, {
    error: 'Error interno',
    detail: error.message,
  })
})