// Pruebas aisladas: sin .env, secretos reales, red ni servicios externos.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const { createHmac, webcrypto } = require('node:crypto')
const ts = require('typescript')

const TOKEN = 'synthetic-validator-token-not-a-real-credential'
const NOW = 1800000000000
const NOW_SECONDS = NOW / 1000
const USER = {
  id: 123456789,
  first_name: 'Prueba ñ + &',
}

const validatorPath = path.resolve(
  __dirname,
  '../lib/validate-telegram.ts'
)
const source = readFileSync(validatorPath, 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText

function fields(overrides = {}) {
  return new URLSearchParams({
    auth_date: String(NOW_SECONDS),
    user: JSON.stringify(USER),
    query_id: 'synthetic-query',
    ...overrides,
  })
}

// Firmante independiente: usa node:crypto, no el código del validador.
// Ordena por clave explícitamente y conserva valores ya decodificados.
function sign(params, token = TOKEN) {
  const entries = Array.from(params.entries())
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => {
      if (left < right) return -1
      if (left > right) return 1
      return 0
    })

  const dataCheckString = entries
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secret = createHmac('sha256', 'WebAppData')
    .update(token, 'utf8')
    .digest()

  const hash = createHmac('sha256', secret)
    .update(dataCheckString, 'utf8')
    .digest('hex')

  const result = new URLSearchParams(params)
  result.set('hash', hash)
  return result.toString()
}

function loadValidator(options = {}) {
  const calls = { environment: 0, network: 0 }
  const environment = {
    token: Object.prototype.hasOwnProperty.call(options, 'token')
      ? options.token
      : TOKEN,
  }
  const clock = { now: NOW }
  const cryptoImpl = options.cryptoImpl ?? webcrypto

  const forbiddenNetwork = () => {
    calls.network += 1
    throw new Error('External operations are forbidden in this test')
  }

  class FixedDate extends Date {
    static now() {
      return clock.now
    }
  }

  const exports = {}

  vm.runInNewContext(compiled, {
    exports,
    require() {
      throw new Error('Unexpected dependency in Telegram validator')
    },
    process: {
      env: new Proxy({}, {
        get(_target, key) {
          calls.environment += 1
          assert.equal(key, 'TELEGRAM_BOT_TOKEN')
          return environment.token
        },
      }),
    },
    crypto: cryptoImpl,
    Date: FixedDate,
    TextEncoder,
    URLSearchParams,
    Uint8Array,
    fetch: forbiddenNetwork,
    XMLHttpRequest: forbiddenNetwork,
    WebSocket: forbiddenNetwork,
  }, { filename: validatorPath, timeout: 1000 })

  return { api: exports, calls, environment, clock }
}

async function rejectsAuth(api, raw, ...args) {
  await assert.rejects(
    api.validateTelegramInitData(raw, ...args),
    error => {
      assert.ok(error instanceof api.TelegramAuthError)
      assert.ok(!(error instanceof api.TelegramAuthConfigurationError))
      assert.equal(error.status, 401)
      assert.equal(error.message, 'No autorizado')
      return true
    }
  )
}

async function rejectsConfiguration(api, raw, ...args) {
  await assert.rejects(
    api.validateTelegramInitData(raw, ...args),
    error => {
      assert.ok(error instanceof api.TelegramAuthConfigurationError)
      assert.ok(!(error instanceof api.TelegramAuthError))
      assert.equal(error.status, 503)
      assert.equal(
        error.message,
        'Servicio de autenticación no disponible'
      )
      return true
    }
  )
}

test('accepts a valid synthetic signature and preserves the return contract', async () => {
  const { api, calls } = loadValidator()
  const result = await api.validateTelegramInitData(sign(fields()))

  assert.equal(typeof api.validateTelegramInitData, 'function')
  assert.equal(typeof api.extractInitData, 'function')
  assert.equal(result.user.id, USER.id)
  assert.equal(result.user.first_name, USER.first_name)
  assert.equal(result.authDate.getTime(), NOW)
  assert.equal(result.queryId, 'synthetic-query')
  assert.equal(
    Object.keys(result).sort().join(','),
    'authDate,queryId,user'
  )
  assert.equal(calls.network, 0)
})

test('accepts reordered fields and correctly encoded special characters', async () => {
  const { api } = loadValidator()
  const params = fields({
    custom_field: 'signed value: ñ + & = /',
  })
  const raw = sign(params)
  const reordered = new URLSearchParams(
    Array.from(new URLSearchParams(raw).entries()).reverse()
  )

  const result = await api.validateTelegramInitData(
    reordered.toString()
  )
  assert.equal(result.user.first_name, USER.first_name)

  const withoutQuery = fields()
  withoutQuery.delete('query_id')
  const noQueryResult = await api.validateTelegramInitData(
    sign(withoutQuery)
  )
  assert.equal(noQueryResult.queryId, undefined)
})

test('accepts valid optional user fields', async () => {
  const { api } = loadValidator()
  const user = {
    ...USER,
    last_name: 'Synthetic',
    username: 'synthetic_user',
    language_code: 'es',
    is_premium: true,
    photo_url: 'https://example.invalid/synthetic-photo',
  }

  const result = await api.validateTelegramInitData(
    sign(fields({ user: JSON.stringify(user) }))
  )
  assert.equal(JSON.stringify(result.user), JSON.stringify(user))
})

test('rejects incorrect signatures and a different synthetic bot token', async () => {
  const { api } = loadValidator()
  const params = new URLSearchParams(sign(fields()))
  const hash = params.get('hash')
  params.set(
    'hash',
    (hash[0] === '0' ? '1' : '0') + hash.slice(1)
  )

  await rejectsAuth(api, params.toString())
  await rejectsAuth(
    api,
    sign(fields(), 'another-synthetic-token')
  )
})

test('rejects missing and malformed hashes', async () => {
  const { api } = loadValidator()

  for (const hash of [
    null,
    '',
    'abc',
    '0'.repeat(63),
    '0'.repeat(65),
    'g'.repeat(64),
    ' '.repeat(64),
  ]) {
    const params = new URLSearchParams(sign(fields()))
    if (hash === null) params.delete('hash')
    else params.set('hash', hash)

    await rejectsAuth(api, params.toString())
  }
})

test('rejects fields changed, removed or added after signing', async () => {
  const { api } = loadValidator()
  const raw = sign(fields({ custom_field: 'original' }))

  for (const [key, value] of [
    ['user', JSON.stringify({ ...USER, id: 999999999 })],
    ['auth_date', String(NOW_SECONDS + 1)],
    ['query_id', 'changed-query'],
    ['custom_field', 'changed'],
    ['new_field', 'unsigned'],
  ]) {
    const params = new URLSearchParams(raw)
    params.set(key, value)
    await rejectsAuth(api, params.toString())
  }

  const removed = new URLSearchParams(raw)
  removed.delete('custom_field')
  await rejectsAuth(api, removed.toString())
})

test('enforces the exact 24-hour and 60-second boundaries', async () => {
  const { api, clock } = loadValidator()

  for (const deltaSeconds of [-86400, -1, 0, 60]) {
    await api.validateTelegramInitData(
      sign(fields({
        auth_date: String(NOW_SECONDS + deltaSeconds),
      }))
    )
  }

  for (const deltaSeconds of [-86401, 61]) {
    await rejectsAuth(
      api,
      sign(fields({
        auth_date: String(NOW_SECONDS + deltaSeconds),
      }))
    )
  }

  // Un milisegundo fuera de cada límite también debe rechazarse.
  clock.now = NOW + 1
  await rejectsAuth(
    api,
    sign(fields({ auth_date: String(NOW_SECONDS - 86400) }))
  )

  clock.now = NOW - 1
  await rejectsAuth(
    api,
    sign(fields({ auth_date: String(NOW_SECONDS + 60) }))
  )
})

test('preserves the existing custom maxAgeSeconds argument', async () => {
  const { api } = loadValidator()

  await api.validateTelegramInitData(
    sign(fields({ auth_date: String(NOW_SECONDS - 10) })),
    10
  )

  await rejectsAuth(
    api,
    sign(fields({ auth_date: String(NOW_SECONDS - 11) })),
    10
  )
})

test('rejects missing, malformed, unsafe or unrepresentable auth_date', async () => {
  const { api } = loadValidator()

  for (const auth_date of [
    '',
    '123abc',
    '-1',
    '1.5',
    '1e9',
    'NaN',
    'Infinity',
    ' 1800000000',
    '1800000000 ',
    '9007199254740992',
    '8640000000001',
  ]) {
    await rejectsAuth(api, sign(fields({ auth_date })))
  }

  const missing = fields()
  missing.delete('auth_date')
  await rejectsAuth(api, sign(missing))
})

test('rejects signed duplicate parameters including encoded equivalent keys', async () => {
  const { api } = loadValidator()

  for (const key of ['user', 'auth_date', 'query_id', 'custom']) {
    const params = fields({ custom: 'first' })
    params.append(key, params.get(key))
    await rejectsAuth(api, sign(params))
  }

  const raw = sign(fields())
  const hash = new URLSearchParams(raw).get('hash')

  for (const suffix of [
    `&hash=${hash}`,
    `&%68ash=${hash}`,
    '&%75ser=' + encodeURIComponent(JSON.stringify(USER)),
    '&%61uth_date=' + NOW_SECONDS,
    '&=empty-key',
  ]) {
    await rejectsAuth(api, raw + suffix)
  }

  // Duplicado codificado con firma calculada sobre ambos valores.
  const encodedDuplicate = fields().toString() +
    '&%75ser=' + encodeURIComponent(JSON.stringify(USER))

  await rejectsAuth(
    api,
    sign(new URLSearchParams(encodedDuplicate))
  )
})

test('rejects invalid user JSON, objects and identifiers even when signed', async () => {
  const { api } = loadValidator()
  const invalidUsers = [
    null,
    [],
    'synthetic',
    123,
    true,
    {},
    { first_name: 'Missing ID' },
    { id: USER.id },
    { ...USER, id: '123456789' },
    { ...USER, id: null },
    { ...USER, id: true },
    { ...USER, id: 0 },
    { ...USER, id: -1 },
    { ...USER, id: 1.5 },
    { ...USER, id: Number.MAX_SAFE_INTEGER + 1 },
    { ...USER, first_name: 123 },
  ]

  for (const user of invalidUsers) {
    await rejectsAuth(
      api,
      sign(fields({ user: JSON.stringify(user) }))
    )
  }

  for (const user of ['', '{invalid-json', 'undefined']) {
    await rejectsAuth(api, sign(fields({ user })))
  }

  const missing = fields()
  missing.delete('user')
  await rejectsAuth(api, sign(missing))
})

test('rejects incorrect types of optional user fields', async () => {
  const { api } = loadValidator()

  for (const [key, value] of [
    ['last_name', 123],
    ['username', false],
    ['language_code', []],
    ['photo_url', null],
    ['is_premium', 'true'],
  ]) {
    await rejectsAuth(
      api,
      sign(fields({
        user: JSON.stringify({ ...USER, [key]: value }),
      }))
    )
  }
})

test('reads the token during validation, not during module import', async () => {
  const { api, calls, environment } = loadValidator({
    token: undefined,
  })

  assert.equal(calls.environment, 0)
  await rejectsConfiguration(api, sign(fields()))

  environment.token = TOKEN
  await api.validateTelegramInitData(sign(fields()))
  assert.equal(calls.environment, 2)
  assert.equal(calls.network, 0)
})

test('distinguishes missing or empty configuration from invalid credentials', async () => {
  for (const token of [undefined, null, '', ' ', '\t\n']) {
    const { api } = loadValidator({ token })
    await rejectsConfiguration(api, sign(fields()))
  }

  const { api, clock } = loadValidator()
  for (const maxAge of [-1, 0.5, NaN, Infinity, '86400']) {
    await rejectsConfiguration(api, sign(fields()), maxAge)
  }

  clock.now = NaN
  await rejectsConfiguration(api, sign(fields()))
})

test('extractInitData accepts the Authorization format sent by tgFetch', () => {
  const { api, calls } = loadValidator()
  const raw = sign(fields())
  const headers = new Headers()
  headers.set('Authorization', `tma ${raw}`)

  const request = new Request('https://example.invalid/api/test', {
    method: 'POST',
    headers,
    body: 'synthetic-body',
  })

  assert.equal(api.extractInitData(request), raw)
  assert.equal(request.bodyUsed, false)
  assert.equal(calls.environment, 0)
  assert.equal(calls.network, 0)
})

test('extractInitData rejects ambiguous headers and identity header alone', () => {
  const { api } = loadValidator()
  const raw = sign(fields())

  for (const value of [
    '',
    'tma',
    'tma ',
    `Bearer ${raw}`,
    `TMA ${raw}`,
    `tma  ${raw}`,
    `tma\t${raw}`,
    `tma ${raw} extra`,
    `tma ${raw},tma ${raw}`,
    `tma ${raw}, tma ${raw}`,
  ]) {
    // Stub para comprobar el valor exacto, sin normalización de Headers.
    const request = {
      headers: {
        get(name) {
          assert.equal(name, 'authorization')
          return value
        },
      },
    }

    assert.throws(
      () => api.extractInitData(request),
      api.TelegramAuthError
    )
  }

  const identityOnly = new Request('https://example.invalid', {
    headers: { 'x-telegram-id-validated': String(USER.id) },
  })

  assert.throws(
    () => api.extractInitData(identityOnly),
    api.TelegramAuthError
  )

  const combined = new Headers()
  combined.append('Authorization', `tma ${raw}`)
  combined.append('Authorization', `tma ${raw}`)

  assert.throws(
    () => api.extractInitData(
      new Request('https://example.invalid', { headers: combined })
    ),
    api.TelegramAuthError
  )
})

test('extractInitData rejects all literal C0, DEL and C1 controls', () => {
  const { api } = loadValidator()
  const raw = sign(fields())
  const codes = [
    ...Array.from({ length: 32 }, (_value, index) => index),
    ...Array.from({ length: 33 }, (_value, index) => 127 + index),
  ]

  for (const code of codes) {
    const control = String.fromCharCode(code)

    for (const value of [
      `${control}tma ${raw}`,
      `tma ${control}${raw}`,
      `tma ${raw}${control}`,
    ]) {
      const request = {
        headers: {
          get() {
            return value
          },
        },
      }

      assert.throws(
        () => api.extractInitData(request),
        api.TelegramAuthError
      )
    }
  }
})

test('errors are generic and unexpected Web Crypto failures propagate', async () => {
  const { api } = loadValidator()

  for (const raw of ['', null, undefined, 123, 'synthetic-private-input']) {
    await rejectsAuth(api, raw)
  }

  const unexpected = new Error('synthetic unexpected crypto failure')
  const broken = loadValidator({
    cryptoImpl: {
      subtle: {
        importKey() {
          throw unexpected
        },
      },
    },
  })

  await assert.rejects(
    broken.api.validateTelegramInitData(sign(fields())),
    error => {
      assert.equal(error, unexpected)
      assert.ok(!(error instanceof broken.api.TelegramAuthError))
      assert.ok(
        !(error instanceof broken.api.TelegramAuthConfigurationError)
      )
      return true
    }
  )

  assert.equal(broken.calls.network, 0)
})