// Pruebas aisladas: sin .env, secretos reales ni servicios externos.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const { createHmac, webcrypto } = require('node:crypto')
const ts = require('typescript')

const TOKEN = 'synthetic-auth-helper-token-not-a-real-credential'
const NOW = 1800000000000
const USER = {
  id: 123456789,
  first_name: 'Synthetic ñ + &',
}
const OTHER_ID = '999999999'

const validatorPath = path.resolve(
  __dirname,
  '../lib/validate-telegram.ts'
)
const helperPath = path.resolve(
  __dirname,
  '../lib/telegram-auth.ts'
)

function compile(filePath) {
  return ts.transpileModule(readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText
}

const compiledValidator = compile(validatorPath)
const compiledHelper = compile(helperPath)

// Firmante independiente: no utiliza funciones del validador.
function signed(overrides = {}, token = TOKEN) {
  const params = new URLSearchParams({
    auth_date: String(NOW / 1000),
    user: JSON.stringify(USER),
    ...overrides,
  })

  const entries = Array.from(params.entries())
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => {
      if (left < right) return -1
      if (left > right) return 1
      return 0
    })

  const check = entries
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secret = createHmac('sha256', 'WebAppData')
    .update(token, 'utf8')
    .digest()

  const hash = createHmac('sha256', secret)
    .update(check, 'utf8')
    .digest('hex')

  params.set('hash', hash)
  return params.toString()
}

function loadHelper(options = {}) {
  const calls = { network: 0, logs: 0 }
  const token = Object.prototype.hasOwnProperty.call(options, 'token')
    ? options.token
    : TOKEN

  const forbiddenNetwork = () => {
    calls.network += 1
    throw new Error('External operations are forbidden in this test')
  }

  const forbiddenLog = () => {
    calls.logs += 1
    throw new Error('Logging is forbidden in this test')
  }

  class FixedDate extends Date {
    static now() {
      return NOW
    }
  }

  const environment = new Proxy({}, {
    get(_target, key) {
      assert.equal(key, 'TELEGRAM_BOT_TOKEN')
      return token
    },
  })

  function evaluate(compiled, filename, dependencies = {}) {
    const exports = {}

    vm.runInNewContext(compiled, {
      exports,
      require(name) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(dependencies, name),
          'Unexpected module dependency'
        )
        return dependencies[name]
      },
      process: { env: environment },
      crypto: options.cryptoImpl ?? webcrypto,
      Date: FixedDate,
      TextEncoder,
      URLSearchParams,
      Uint8Array,
      console: new Proxy({}, {
        get() {
          return forbiddenLog
        },
      }),
      fetch: forbiddenNetwork,
      XMLHttpRequest: forbiddenNetwork,
      WebSocket: forbiddenNetwork,
    }, { filename, timeout: 1000 })

    return exports
  }

  const validator = evaluate(compiledValidator, validatorPath)
  const helper = evaluate(compiledHelper, helperPath, {
    './validate-telegram': validator,
  })

  return { helper, calls }
}

function requestFor(raw, extraHeaders = {}) {
  const headers = new Headers(extraHeaders)

  if (raw !== null) {
    headers.set('Authorization', `tma ${raw}`)
  }

  return new Request('https://example.invalid/api/test', { headers })
}

function assertFailure(result, status) {
  assert.equal(result.ok, false)
  assert.equal(result.status, status)
  assert.equal(
    result.error,
    status === 401
      ? 'No autorizado'
      : 'Servicio de autenticación no disponible'
  )
  assert.equal(
    Object.keys(result).sort().join(','),
    'error,ok,status'
  )
  assert.ok(!JSON.stringify(result).includes(TOKEN))
}

function assertNoExternalEffects(calls) {
  assert.equal(calls.network, 0)
  assert.equal(calls.logs, 0)
}

test('accepts valid signed Authorization and returns a string telegramId', async () => {
  const { helper, calls } = loadHelper()

  const result = await helper.authenticateTelegramRequest(
    requestFor(signed())
  )

  assert.equal(result.ok, true)
  assert.equal(typeof result.telegramId, 'string')
  assert.equal(result.telegramId, String(USER.id))
  assert.equal(result.data.user.id, USER.id)
  assert.equal(result.data.user.first_name, USER.first_name)
  assert.equal(result.data.authDate.getTime(), NOW)
  assert.equal(
    Object.keys(result).sort().join(','),
    'data,ok,telegramId'
  )
  assertNoExternalEffects(calls)
})

test('uses signed identity instead of header, URL or body identity', async () => {
  const { helper, calls } = loadHelper()
  const body = JSON.stringify({
    telegram_id: OTHER_ID,
    user_id: OTHER_ID,
  })

  const request = new Request(
    `https://example.invalid/api/test?telegram_id=${OTHER_ID}`,
    {
      method: 'POST',
      headers: {
        Authorization: `tma ${signed()}`,
        'x-telegram-id-validated': OTHER_ID,
        'content-type': 'application/json',
      },
      body,
    }
  )

  assert.equal(request.bodyUsed, false)

  const result = await helper.authenticateTelegramRequest(request)

  assert.equal(result.ok, true)
  assert.equal(typeof result.telegramId, 'string')
  assert.equal(result.telegramId, String(USER.id))
  assert.notEqual(result.telegramId, OTHER_ID)
  assert.equal(result.data.user.id, USER.id)
  assert.equal(request.bodyUsed, false)
  assert.equal(await request.text(), body)
  assertNoExternalEffects(calls)
})

test('rejects absent Authorization even with an identity header', async () => {
  const { helper, calls } = loadHelper()

  for (const headers of [
    {},
    { 'x-telegram-id-validated': String(USER.id) },
  ]) {
    const result = await helper.authenticateTelegramRequest(
      requestFor(null, headers)
    )

    assertFailure(result, 401)
  }

  assertNoExternalEffects(calls)
})

test('rejects invalid, missing and manipulated signatures with generic 401', async () => {
  const { helper, calls } = loadHelper()

  const missingHash = new URLSearchParams(signed())
  missingHash.delete('hash')

  const malformedHash = new URLSearchParams(signed())
  malformedHash.set('hash', 'not-a-valid-hash')

  const invalidHash = new URLSearchParams(signed())
  const hash = invalidHash.get('hash')
  invalidHash.set(
    'hash',
    (hash[0] === '0' ? '1' : '0') + hash.slice(1)
  )

  const manipulatedUser = new URLSearchParams(signed())
  manipulatedUser.set(
    'user',
    JSON.stringify({ ...USER, id: Number(OTHER_ID) })
  )

  const manipulatedDate = new URLSearchParams(signed())
  manipulatedDate.set('auth_date', String(NOW / 1000 + 1))

  for (const raw of [
    '',
    missingHash.toString(),
    malformedHash.toString(),
    invalidHash.toString(),
    manipulatedUser.toString(),
    manipulatedDate.toString(),
    signed({}, 'different-synthetic-token'),
  ]) {
    const result = await helper.authenticateTelegramRequest(
      requestFor(raw, {
        'x-telegram-id-validated': String(USER.id),
      })
    )

    assertFailure(result, 401)

    if (raw) {
      assert.ok(!JSON.stringify(result).includes(raw))
    }
  }

  assertNoExternalEffects(calls)
})

test('returns generic 503 for missing or empty server token', async () => {
  for (const token of [undefined, null, '', ' ', '\t\n']) {
    const { helper, calls } = loadHelper({ token })

    const result = await helper.authenticateTelegramRequest(
      requestFor(signed())
    )

    assertFailure(result, 503)
    assertNoExternalEffects(calls)
  }
})

test('leaves request bodies untouched for 401 and 503 results', async () => {
  for (const status of [401, 503]) {
    const { helper, calls } = loadHelper(
      status === 503 ? { token: undefined } : {}
    )

    const request = new Request('https://example.invalid/api/test', {
      method: 'POST',
      headers: {
        Authorization: `tma ${status === 401 ? 'invalid' : signed()}`,
      },
      body: 'synthetic-body',
    })

    assert.equal(request.bodyUsed, false)

    const result = await helper.authenticateTelegramRequest(request)

    assertFailure(result, status)
    assert.equal(request.bodyUsed, false)
    assert.equal(await request.text(), 'synthetic-body')
    assertNoExternalEffects(calls)
  }
})

test('propagates unexpected errors unchanged without logging or consuming body', async () => {
  const unexpected = new Error('synthetic unexpected crypto failure')
  const { helper, calls } = loadHelper({
    cryptoImpl: {
      subtle: {
        importKey() {
          throw unexpected
        },
      },
    },
  })

  const request = new Request('https://example.invalid/api/test', {
    method: 'POST',
    headers: { Authorization: `tma ${signed()}` },
    body: 'synthetic-body',
  })

  assert.equal(request.bodyUsed, false)

  await assert.rejects(
    helper.authenticateTelegramRequest(request),
    error => {
      assert.equal(error, unexpected)
      assert.equal(error.message, 'synthetic unexpected crypto failure')
      assert.ok(!error.message.includes(TOKEN))
      return true
    }
  )

  assert.equal(request.bodyUsed, false)
  assert.equal(await request.text(), 'synthetic-body')
  assertNoExternalEffects(calls)
})