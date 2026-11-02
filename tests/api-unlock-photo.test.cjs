// Pruebas aisladas de /api/unlock-photo: sin .env, motor real ni red.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const VERIFIED_ID = '123456789'
const FORGED_ID = '999999999'
const AUTHORIZATION = 'tma synthetic-mocked-init-data'
const OFFER_ID = 42
const PUBLIC_URL = 'https://images.example.invalid///'

const RESULT = Object.freeze({
  already_unlocked: false,
  r2_key: 'synthetic/photo.webp',
  paid_with: 'gems',
})

const routePath = path.resolve(
  __dirname,
  '../app/api/unlock-photo/route.ts'
)

const routeSource = readFileSync(routePath, 'utf8')

const compiledRoute = ts.transpileModule(routeSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText

function authenticated() {
  // Simula el resultado de autenticación, no la criptografía.
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
    unlockOffer: [],
    body: 0,
    logs: [],
    forbidden: [],
    order: [],
  }

  function forbidden(operation) {
    calls.forbidden.push(operation)
    throw new Error(`Forbidden operation: ${operation}`)
  }

  // Clase sintética: el motor real nunca se carga.
  class HttpError extends Error {
    constructor(status, code) {
      super(code)
      this.status = status
      this.code = code
    }
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
    '@/lib/unlock-engine': {
      HttpError,
      async unlockOffer(...args) {
        calls.unlockOffer.push(args)
        calls.order.push('unlockOffer')

        if (options.unlockOffer) {
          return options.unlockOffer(...args)
        }

        return RESULT
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
          if (key === 'NEXT_PUBLIC_R2_PUBLIC_URL') {
            return Object.prototype.hasOwnProperty.call(options, 'publicUrl')
              ? options.publicUrl
              : PUBLIC_URL
          }

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

  function requestFor(body = { offer_id: OFFER_ID }, requestOptions = {}) {
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
      'https://example.invalid/api/unlock-photo',
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

  return { POST: exports.POST, calls, requestFor, HttpError }
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
  assert.deepEqual(calls.unlockOffer, [])
  assert.deepEqual(calls.order, ['authenticate'])
  assert.deepEqual(calls.logs, [])
}

function assertBodyRead(calls, request) {
  assert.equal(calls.authentication.length, 1)
  assert.equal(calls.authentication[0], request)
  assert.equal(request.headers.get('authorization'), AUTHORIZATION)
  assert.equal(calls.body, 1)
  assert.equal(request.bodyUsed, true)
}

function assertDelegation(calls, request, offerId = OFFER_ID) {
  assertBodyRead(calls, request)
  assert.deepEqual(calls.unlockOffer, [[VERIFIED_ID, offerId]])
  assert.deepEqual(calls.order, [
    'authenticate',
    'body',
    'unlockOffer',
  ])
}

function successfulBody(imageUrl, paidWith = 'gems') {
  return {
    success: true,
    image_url: imageUrl,
    already_unlocked: false,
    paid_with: paidWith,
  }
}

test('returns 401 without Authorization before reading body', async t => {
  const { POST, calls, requestFor } = loadRoute(t, {
    authenticate(request) {
      assert.equal(request.headers.get('authorization'), null)
      return { ok: false, status: 401, error: 'No autorizado' }
    },
  })

  const request = requestFor(
    { offer_id: OFFER_ID },
    { authorization: false }
  )

  await assertResponse(await POST(request), 401, {
    error: 'No autorizado',
  })

  assertAuthenticationOnly(calls, request)
})

test('rejects a forged validated header without Authorization', async t => {
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

  const request = requestFor({ offer_id: OFFER_ID }, {
    authorization: false,
    headers: { 'x-telegram-id-validated': FORGED_ID },
  })

  await assertResponse(await POST(request), 401, {
    error: 'No autorizado',
  })

  assertAuthenticationOnly(calls, request)
})

test('uses exclusively the authenticated ID despite conflicting IDs', async t => {
  const { POST, calls, requestFor } = loadRoute(t)
  const request = requestFor({
    offer_id: OFFER_ID,
    id: FORGED_ID,
    telegram_id: FORGED_ID,
    telegramId: FORGED_ID,
    user: { id: Number(FORGED_ID) },
  }, {
    headers: {
      'x-telegram-id-validated': FORGED_ID,
      'x-telegram-id': FORGED_ID,
    },
  })

  await assertResponse(await POST(request), 200, successfulBody(
    'https://images.example.invalid///synthetic/photo.webp'
  ))

  assertDelegation(calls, request)
  assert.deepEqual(calls.logs, [])
})

test('propagates 401 and 503 from the mocked authenticator', async t => {
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

    const request = requestFor({}, { rawBody: '{invalid-json' })

    await assertResponse(await POST(request), failure.status, {
      error: failure.error,
    })

    assertAuthenticationOnly(calls, request)
  }
})

test('returns generic 500 for unexpected authentication exceptions', async t => {
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

test('waits for authentication to finish before reading the body', async t => {
  let finishAuthentication

  const pendingAuthentication = new Promise(resolve => {
    finishAuthentication = resolve
  })

  const { POST, calls, requestFor } = loadRoute(t, {
    authenticate() {
      return pendingAuthentication
    },
  })

  const request = requestFor()
  const pendingResponse = POST(request)

  try {
    assertAuthenticationOnly(calls, request)
  } finally {
    finishAuthentication(authenticated())
  }

  await assertResponse(await pendingResponse, 200, successfulBody(
    'https://images.example.invalid///synthetic/photo.webp'
  ))

  assertDelegation(calls, request)
  assert.deepEqual(calls.logs, [])
})

test('preserves rejection of currently invalid offer_id values', async t => {
  const bodies = [
    {},
    null,
    [],
    'synthetic',
    42,
    { offer_id: null },
    { offer_id: false },
    { offer_id: 0 },
    { offer_id: -1 },
    { offer_id: '' },
    { offer_id: '   ' },
    { offer_id: '0' },
    { offer_id: '-1' },
    { offer_id: 'not-a-number' },
    { offer_id: [] },
    { offer_id: [0] },
    { offer_id: [1, 2] },
    { offer_id: {} },
  ]

  for (const body of bodies) {
    const { POST, calls, requestFor } = loadRoute(t)
    const request = requestFor(body)

    await assertResponse(await POST(request), 400, {
      error: 'offer_id inválido o faltante',
    })

    assertBodyRead(calls, request)
    assert.deepEqual(calls.unlockOffer, [])
    assert.deepEqual(calls.order, ['authenticate', 'body'])
    assert.deepEqual(calls.logs, [])
  }
})

test('preserves the 400 fallback for malformed JSON', async t => {
  const { POST, calls, requestFor } = loadRoute(t)
  const request = requestFor({}, { rawBody: '{invalid-json' })

  await assertResponse(await POST(request), 400, {
    error: 'offer_id inválido o faltante',
  })

  assertBodyRead(calls, request)
  assert.deepEqual(calls.unlockOffer, [])
  assert.deepEqual(calls.order, ['authenticate', 'body'])
  assert.deepEqual(calls.logs, [])
})

test('preserves existing Number conversion without stricter validation', async t => {
  const cases = [
    [42, 42],
    ['42', 42],
    [' 42 ', 42],
    [1.5, 1.5],
    ['1.5', 1.5],
    [true, 1],
    [[2], 2],
    ['0x10', 16],
    ['Infinity', Infinity],
  ]

  for (const [rawOfferId, expectedOfferId] of cases) {
    const { POST, calls, requestFor } = loadRoute(t)
    const request = requestFor({ offer_id: rawOfferId })

    await assertResponse(await POST(request), 200, successfulBody(
      'https://images.example.invalid///synthetic/photo.webp'
    ))

    assertDelegation(calls, request, expectedOfferId)
    assert.deepEqual(calls.logs, [])
  }
})

test('preserves successful responses for all existing payment modes', async t => {
  for (const paidWith of ['free', 'token', 'gems']) {
    const result = Object.freeze({
      ...RESULT,
      paid_with: paidWith,
    })
    const original = JSON.stringify(result)

    const { POST, calls, requestFor } = loadRoute(t, {
      unlockOffer() {
        return result
      },
    })

    const request = requestFor()

    await assertResponse(await POST(request), 200, successfulBody(
      'https://images.example.invalid///synthetic/photo.webp',
      paidWith
    ))

    assertDelegation(calls, request)
    assert.deepEqual(calls.logs, [])
    assert.equal(JSON.stringify(result), original)
  }
})

test('preserves current public image URL construction', async t => {
  const cases = [
    {
      publicUrl: PUBLIC_URL,
      key: 'synthetic/photo.webp',
      expected: 'https://images.example.invalid///synthetic/photo.webp',
    },
    {
      publicUrl: PUBLIC_URL,
      key: 'https://cdn.example.invalid/synthetic/photo.webp',
      expected: 'https://cdn.example.invalid/synthetic/photo.webp',
    },
    {
      publicUrl: PUBLIC_URL,
      key: 'http://cdn.example.invalid/synthetic/photo.webp',
      expected: 'http://cdn.example.invalid/synthetic/photo.webp',
    },
    {
      publicUrl: '',
      key: 'synthetic/photo.webp',
      expected: '/synthetic/photo.webp',
    },
    {
      publicUrl: undefined,
      key: 'synthetic/photo.webp',
      expected: '/synthetic/photo.webp',
    },
  ]

  for (const { publicUrl, key, expected } of cases) {
    const { POST, calls, requestFor } = loadRoute(t, {
      publicUrl,
      unlockOffer() {
        return { ...RESULT, r2_key: key }
      },
    })

    const request = requestFor()

    await assertResponse(
      await POST(request),
      200,
      successfulBody(expected)
    )

    assertDelegation(calls, request)
    assert.deepEqual(calls.logs, [])
  }
})

test('preserves already-unlocked response without adding paid_with', async t => {
  const result = Object.freeze({
    already_unlocked: true,
    r2_key: 'synthetic/already-unlocked.webp',
  })
  const original = JSON.stringify(result)

  const { POST, calls, requestFor } = loadRoute(t, {
    unlockOffer() {
      return result
    },
  })

  const request = requestFor()

  await assertResponse(await POST(request), 200, {
    success: true,
    image_url:
      'https://images.example.invalid///synthetic/already-unlocked.webp',
    already_unlocked: true,
  })

  assertDelegation(calls, request)
  assert.deepEqual(calls.logs, [])
  assert.equal(JSON.stringify(result), original)
})

test('preserves existing HttpError statuses and codes', async t => {
  const cases = [
    [402, 'insufficient_gems'],
    [404, 'offer_not_found'],
    [404, 'image_not_found'],
    [500, 'corrupted_offer'],
    [500, 'image_disappeared'],
  ]

  for (const [status, code] of cases) {
    let failure

    const { POST, calls, requestFor, HttpError } = loadRoute(t, {
      unlockOffer() {
        throw failure
      },
    })

    failure = new HttpError(status, code)
    const request = requestFor()

    await assertResponse(await POST(request), status, {
      error: code,
    })

    assertDelegation(calls, request)
    assert.deepEqual(calls.logs, [])
  }
})

test('preserves generic unlock failures and existing error logging', async t => {
  const failures = [
    new Error('synthetic private engine detail'),
    'synthetic non-Error failure',
  ]

  for (const failure of failures) {
    const { POST, calls, requestFor } = loadRoute(t, {
      async unlockOffer() {
        throw failure
      },
    })

    const request = requestFor()

    await assertResponse(await POST(request), 500, {
      error: 'Error interno',
    })

    assertDelegation(calls, request)
    assert.equal(calls.logs.length, 1)
    assert.equal(calls.logs[0][0], '[unlock-photo] error:')
    assert.equal(calls.logs[0][1], failure)
  }
})

test('keeps direct dependencies and calls limited to route orchestration', () => {
  const source = ts.createSourceFile(
    routePath,
    routeSource,
    ts.ScriptTarget.ES2020,
    true,
    ts.ScriptKind.TS
  )

  const imports = []
  const calls = []

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

    if (ts.isCallExpression(node)) {
      calls.push(node)
    }

    ts.forEachChild(node, visit)
  }

  visit(source)

  // La igualdad exacta también rechaza imports adicionales,
  // incluidos módulos económicos o de base de datos.
  assert.deepEqual(imports, [
    {
      module: 'next/server',
      bindings: ['NextResponse'],
    },
    {
      module: '@/lib/unlock-engine',
      bindings: ['HttpError', 'unlockOffer'],
    },
    {
      module: '@/lib/telegram-auth',
      bindings: ['authenticateTelegramRequest'],
    },
  ])

  const authenticationCalls = calls.filter(
    call => call.expression.getText(source) ===
      'authenticateTelegramRequest'
  )

  assert.equal(authenticationCalls.length, 1)
  assert.deepEqual(
    authenticationCalls[0].arguments.map(arg => arg.getText(source)),
    ['request']
  )

  const unlockCalls = calls.filter(
    call => call.expression.getText(source) === 'unlockOffer'
  )

  assert.equal(unlockCalls.length, 1)
  assert.deepEqual(
    unlockCalls[0].arguments.map(arg => arg.getText(source)),
    ['tid', 'offer_id']
  )
})