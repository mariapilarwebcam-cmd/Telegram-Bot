// Handler real transpiliado; SQL y bloqueos ejecutados por SQLite local.
// Un proceso hijo por escenario; sin lib/turso.ts, credenciales ni red.
// No demuestra comportamiento remoto, idempotencia ni reintentos automáticos.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { spawn } = require('node:child_process')
const { inspect } = require('node:util')

const URL = 'file::memory:?cache=shared'
const USER_ID = 'synthetic-concurrency-vip'
const FORGED_ID = 'synthetic-forged-user'
const AUTHORIZATION = 'tma synthetic-concurrency-auth'
const DETAILS = '¡Has ganado 15 Mensajes de Chat!'
const HISTORY_DETAILS = `bonus_gems:${DETAILS}`
const WAIT_MS = 2000
const CHILD_FLAG = '--gacha-concurrency-child'
const CHILD_TIMEOUT_MS = 12000
const TERMINATION_TIMEOUT_MS = 2000
const OUTPUT_LIMIT = 64 * 1024

const SCENARIOS = Object.freeze([
  {
    id: 'contention-zero',
    name: 'VIP contention with 0 gems: only A receives a free reward',
    options: { balance: 0, contention: true, rollback: false },
  },
  {
    id: 'contention-fifty',
    name: 'VIP contention with 50 gems: blocked B does not spend or receive a reward',
    options: { balance: 50, contention: true, rollback: false },
  },
  {
    id: 'after-commit-zero',
    name: 'VIP B acquires after A commits, with 0 gems: B receives 402',
    options: { balance: 0, contention: false, rollback: false },
  },
  {
    id: 'after-commit-fifty',
    name: 'VIP B acquires after A commits, with 50 gems: B pays exactly 50',
    options: { balance: 50, contention: false, rollback: false },
  },
  {
    id: 'after-rollback',
    name: 'rolled-back free reward does not consume eligibility for B',
    options: { balance: 0, contention: false, rollback: true },
  },
])

const routePath = path.resolve(
  __dirname,
  '../app/api/gacha/spin/route.ts'
)
let createClient
let compiledRoute

const normalize = sql => sql.replace(/\s+/g, ' ').trim()

// Expectativas independientes: las consultas se ejecutan sin modificarlas.
const SQL = {
  subscription: `
    SELECT * FROM subscriptions
    WHERE telegram_id = ?
      AND status = 'active'
      AND expires_at > datetime('now')
    ORDER BY expires_at DESC
    LIMIT 1
  `,
  free: `
    SELECT id FROM gacha_history
    WHERE user_id = ? AND cost_gems = 0
      AND created_at >= unixepoch('now', '-7 days')
    LIMIT 1
  `,
  balances: `
    SELECT purchased_gems, gems FROM users WHERE telegram_id = ?
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
    UPDATE users SET bonus_gems = COALESCE(bonus_gems, 0) + ?
    WHERE telegram_id = ?
  `,
  history: `
    INSERT INTO gacha_history
      (user_id, cost_gems, reward_tier, reward_details)
    VALUES (?, ?, ?, ?)
  `,
  accounting: `
    INSERT INTO gem_transactions
      (telegram_id, amount, transaction_type, description)
    VALUES (?, ?, ?, ?)
  `,
}

for (const key of Object.keys(SQL)) {
  SQL[key] = normalize(SQL[key])
}

function signal() {
  let resolve
  const promise = new Promise(done => {
    resolve = done
  })
  return { promise, resolve }
}

async function bounded(promise, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Timed out waiting for ${label}`))
        }, WAIT_MS)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function isLockError(error) {
  return !!error &&
    typeof error.code === 'string' &&
    /^(SQLITE_BUSY|SQLITE_LOCKED)(?:_[A-Z0-9_]+)?$/.test(error.code)
}

async function snapshot(connection) {
  const user = await connection.execute({
    sql: 'SELECT telegram_id, purchased_gems, gems, bonus_gems FROM users',
    args: [],
  })
  const history = await connection.execute(`
    SELECT user_id, cost_gems, reward_tier, reward_details,
           created_at, typeof(created_at) AS storage_type
    FROM gacha_history ORDER BY id
  `)
  const accounting = await connection.execute(`
    SELECT telegram_id, amount, transaction_type, description
    FROM gem_transactions ORDER BY id
  `)

  return {
    user: Array.from(user.rows, row => ({
      telegram_id: row.telegram_id,
      purchased_gems: row.purchased_gems,
      gems: row.gems,
      bonus_gems: row.bonus_gems,
    })),
    history: Array.from(history.rows, row => ({
      user_id: row.user_id,
      cost_gems: row.cost_gems,
      reward_tier: row.reward_tier,
      reward_details: row.reward_details,
      created_at: row.created_at,
      storage_type: row.storage_type,
    })),
    accounting: Array.from(accounting.rows, row => ({
      telegram_id: row.telegram_id,
      amount: row.amount,
      transaction_type: row.transaction_type,
      description: row.description,
    })),
  }
}

async function runScenario(t, options) {
  const clients = []
  const active = new Set()
  const failures = []
  const pending = []
  const cleanupErrors = []
  const signals = {
    usersReady: signal(),
    aPaused: signal(),
    bArrived: signal(),
    bAttempted: signal(),
    aEnded: signal(),
  }
  let readyUsers = 0
  let cancelled = false
  let admin
  let initial
  let afterARollback
  let primaryError
  let pendingSettlement = Promise.resolve([])

  function forbidden(operation) {
    const error = new Error(`Forbidden or unexpected operation: ${operation}`)
    failures.push(error)
    throw error
  }

  function requireCondition(condition, message) {
    if (!condition) forbidden(message)
  }

  async function wait(name) {
    await bounded(signals[name].promise, name)
    requireCondition(!cancelled, `cancelled at ${name}`)
  }

  function newRecord(name) {
    return {
      name,
      authentication: 0,
      ensureUser: 0,
      beginAttempts: 0,
      began: false,
      commit: 0,
      rollback: 0,
      closed: false,
      sql: [],
      freeRows: [],
      debitRows: [],
      logs: [],
      error: null,
      rng: [0.5, 0.1],
    }
  }

  const records = {
    A: newRecord('A'),
    B: newRecord('B'),
  }

  function loadPost(connection, record) {
    const expectedArgs = {
      subscription: [USER_ID],
      free: [USER_ID],
      balances: [USER_ID],
      debit: [50, 50, USER_ID, 50],
      pity: [USER_ID],
      bonus: [15, USER_ID],
      history: [
        USER_ID,
        record.name === 'B' &&
          !options.contention &&
          !options.rollback &&
          options.balance === 50
          ? 50
          : 0,
        'common',
        HISTORY_DETAILS,
      ],
      accounting: [
        USER_ID,
        -50,
        'gacha_spin',
        'Tirada de ruleta (common)',
      ],
    }

    function ensureOpen() {
      requireCondition(
        record.began && !record.closed && active.has(connection),
        `${record.name}: operation outside open transaction`
      )
      requireCondition(!cancelled, `${record.name}: cancelled operation`)
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
          requireCondition(
            request.headers.get('authorization') === AUTHORIZATION,
            `${record.name}: authorization`
          )
          record.authentication += 1
          return {
            ok: true,
            telegramId: USER_ID,
            data: { user: { id: USER_ID } },
          }
        },
      },
      '@/lib/db-queries': {
        async ensureUser(id) {
          requireCondition(id === USER_ID, `${record.name}: ensureUser identity`)
          record.ensureUser += 1
          const result = await connection.execute({
            sql: 'SELECT * FROM users WHERE telegram_id = ?',
            args: [id],
          })
          requireCondition(result.rows.length === 1, 'missing synthetic user')
          readyUsers += 1
          if (readyUsers === 2) signals.usersReady.resolve()
          await wait('usersReady')
          return result.rows[0]
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
          async transaction(mode) {
            requireCondition(mode === 'write', 'transaction mode')
            requireCondition(!record.began, 'duplicate transaction')
            requireCondition(!cancelled, 'transaction after cancellation')

            if (record.name === 'B') {
              await wait('aPaused')
              signals.bArrived.resolve()
              if (!options.contention) await wait('aEnded')
            }

            record.beginAttempts += 1
            try {
              await connection.execute('BEGIN IMMEDIATE')
              record.began = true
              active.add(connection)
            } catch (error) {
              record.error = error
              throw error
            } finally {
              if (record.name === 'B') signals.bAttempted.resolve()
            }

            return {
              async execute(statement) {
                ensureOpen()
                const key = Object.keys(SQL).find(
                  name => SQL[name] === normalize(statement.sql)
                )
                requireCondition(!!key, `${record.name}: unrecognized SQL`)
                const args = Array.from(statement.args)
                requireCondition(
                  args.length === expectedArgs[key].length &&
                    args.every((value, index) =>
                      value === expectedArgs[key][index]
                    ),
                  `${record.name}: unexpected arguments for ${key}`
                )
                record.sql.push(key)

                let result
                try {
                  // Original SQL, original arguments, original SQLite result.
                  result = await connection.execute(statement)
                } catch (error) {
                  record.error = error
                  throw error
                }

                if (key === 'free') record.freeRows.push(result.rows.length)
                if (key === 'debit') record.debitRows.push(result.rows.length)

                if (record.name === 'A' && key === 'balances') {
                  signals.aPaused.resolve()
                  await wait('bArrived')
                  if (options.contention) await wait('bAttempted')
                }
                return result
              },
              async commit() {
                ensureOpen()
                await connection.execute('COMMIT')
                record.commit += 1
                record.closed = true
                active.delete(connection)
                if (record.name === 'A') signals.aEnded.resolve()
              },
              async rollback() {
                ensureOpen()
                await connection.execute('ROLLBACK')
                record.rollback += 1
                record.closed = true
                active.delete(connection)

                if (record.name === 'A') {
                  if (options.rollback) {
                    afterARollback = await snapshot(connection)
                    // Retirar solo el fallo sintético antes de permitir B.
                    await connection.execute(
                      'DROP TRIGGER synthetic_history_failure'
                    )
                  }
                  signals.aEnded.resolve()
                }
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
        requireCondition(record.rng.length > 0, 'unexpected RNG call')
        return record.rng.shift()
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
          if (method !== 'error') {
            return () => forbidden(`console:${String(method)}`)
          }
          return (...args) => record.logs.push(args)
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
    return exports.POST
  }

  async function invoke(POST) {
    const response = await POST(new Request(
      'https://example.invalid/api/gacha/spin',
      {
        method: 'POST',
        headers: {
          Authorization: AUTHORIZATION,
          'x-telegram-id-validated': FORGED_ID,
        },
      }
    ))
    assert.ok(response instanceof Response)
    return { status: response.status, body: await response.json() }
  }

  function assertSuccess(response, free, balance) {
    assert.equal(response.status, 200)
    assert.deepEqual(response.body, {
      success: true,
      tier: 'common',
      reward_type: 'bonus_gems',
      reward_details: DETAILS,
      item_key: '15',
      remaining_gems: balance,
      remaining_purchased_gems: balance,
      is_free_spin: free,
    })
  }

  function assertLoggedError(record) {
    assert.equal(record.logs.length, 1)
    assert.equal(record.logs[0].length, 2)
    assert.equal(record.logs[0][0], '[gacha/spin] error:')
    assert.equal(record.logs[0][1], record.error)
  }

  try {
    for (let index = 0; index < 3; index++) {
      const connection = createClient({ url: URL })
      clients.push(connection)
      assert.equal(connection.protocol, 'file')
      await connection.execute('PRAGMA busy_timeout = 0')
      const timeout = await connection.execute('PRAGMA busy_timeout')
      assert.equal(Number(timeout.rows[0].timeout), 0)
      const databases = await connection.execute('PRAGMA database_list')
      const main = databases.rows.find(row => row.name === 'main')
      assert.ok(main)
      assert.equal(main.file, '')
    }

    const [setup, a, b] = clients
    admin = setup

    // Fixture mínima, no afirmación del esquema completo de producción.
    await admin.execute(`
      CREATE TABLE users (
        telegram_id TEXT PRIMARY KEY,
        purchased_gems INTEGER NOT NULL,
        gems INTEGER NOT NULL,
        bonus_gems INTEGER NOT NULL,
        interested_in TEXT
      )
    `)
    await admin.execute(`
      CREATE TABLE subscriptions (
        id INTEGER PRIMARY KEY,
        telegram_id TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    `)
    await admin.execute(`
      CREATE TABLE gacha_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        cost_gems INTEGER NOT NULL,
        reward_tier TEXT NOT NULL,
        reward_details TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `)
    await admin.execute(`
      CREATE TABLE gem_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        transaction_type TEXT NOT NULL,
        description TEXT NOT NULL
      )
    `)
    await admin.execute({
      sql: `
        INSERT INTO users
          (telegram_id, purchased_gems, gems, bonus_gems, interested_in)
        VALUES (?, ?, ?, 0, 'female')
      `,
      args: [USER_ID, options.balance, options.balance],
    })
    await admin.execute({
      sql: `
        INSERT INTO subscriptions (id, telegram_id, status, expires_at)
        VALUES (1, ?, 'active', datetime('now', '+30 days'))
      `,
      args: [USER_ID],
    })

    initial = await snapshot(admin)
    for (const connection of [a, b]) {
      try {
        assert.deepEqual(await snapshot(connection), initial)
      } catch (cause) {
        throw new Error(
          'CAPABILITY LIMITATION: connections did not demonstrate shared memory',
          { cause }
        )
      }
    }

    if (options.rollback) {
      await admin.execute(`
        CREATE TRIGGER synthetic_history_failure
        BEFORE INSERT ON gacha_history
        BEGIN
          SELECT RAISE(ABORT, 'synthetic history failure');
        END
      `)
    }

    const postA = loadPost(a, records.A)
    const postB = loadPost(b, records.B)

    pending.push(invoke(postA), invoke(postB))
    pendingSettlement = Promise.allSettled(pending)
    const [responseA, responseB] = await bounded(
      Promise.all(pending),
      'both handler responses'
    )

    assert.equal(failures.length, 0)
    assert.equal(active.size, 0)

    const eligibility = ['subscription', 'free', 'balances']
    const freeSql = [...eligibility, 'pity', 'bonus', 'history']

    assert.deepEqual(records.A.sql, freeSql)
    assert.deepEqual(records.A.freeRows, [0])
    assert.deepEqual(records.A.debitRows, [])
    assert.equal(records.A.rng.length, 0)
    assert.equal(records.A.began, true)
    assert.equal(records.A.closed, true)

    if (options.rollback) {
      assert.equal(responseA.status, 500)
      assert.deepEqual(responseA.body, { error: 'Error interno' })
      assert.equal(records.A.commit, 0)
      assert.equal(records.A.rollback, 1)
      assert.ok(records.A.error)
      assert.match(records.A.error.code, /^SQLITE_CONSTRAINT(?:_|$)/)
      assert.match(records.A.error.message, /synthetic history failure/)
      assertLoggedError(records.A)
      assert.deepEqual(afterARollback, initial)

      assertSuccess(responseB, true, options.balance)
      assert.deepEqual(records.B.sql, freeSql)
      assert.deepEqual(records.B.freeRows, [0])
      assert.deepEqual(records.B.debitRows, [])
      assert.equal(records.B.commit, 1)
      assert.equal(records.B.rollback, 0)
      assert.equal(records.B.rng.length, 0)
      assert.deepEqual(records.B.logs, [])
      assert.equal(records.B.error, null)
    } else {
      assertSuccess(responseA, true, options.balance)
      assert.equal(records.A.commit, 1)
      assert.equal(records.A.rollback, 0)
      assert.deepEqual(records.A.logs, [])
      assert.equal(records.A.error, null)

      if (options.contention) {
        assert.equal(responseB.status, 500)
        assert.deepEqual(responseB.body, { error: 'Error interno' })
        assert.ok(isLockError(records.B.error))
        assertLoggedError(records.B)
        assert.equal(records.B.began, false)
        assert.equal(records.B.closed, false)
        assert.equal(records.B.commit, 0)
        assert.equal(records.B.rollback, 0)
        assert.deepEqual(records.B.sql, [])
        assert.deepEqual(records.B.freeRows, [])
        assert.deepEqual(records.B.debitRows, [])
        assert.equal(records.B.rng.length, 2)
        t.diagnostic(
          'Actual local lock; handler returns generic 500, not a dedicated ' +
          `concurrency response: ${records.B.error.code}; ` +
          `rawCode=${records.B.error.rawCode ?? 'unavailable'}`
        )
      } else if (options.balance === 0) {
        assert.equal(responseB.status, 402)
        assert.deepEqual(responseB.body, {
          error: 'insufficient_gems',
          message: 'Necesitas 50 gemas compradas.',
        })
        assert.deepEqual(records.B.sql, [...eligibility, 'debit'])
        assert.deepEqual(records.B.freeRows, [1])
        assert.deepEqual(records.B.debitRows, [0])
        assert.equal(records.B.commit, 0)
        assert.equal(records.B.rollback, 1)
        assert.equal(records.B.rng.length, 2)
        assert.deepEqual(records.B.logs, [])
        assert.equal(records.B.error, null)
      } else {
        assertSuccess(responseB, false, 0)
        assert.deepEqual(records.B.sql, [
          ...eligibility,
          'debit',
          'pity',
          'bonus',
          'history',
          'accounting',
        ])
        assert.deepEqual(records.B.freeRows, [1])
        assert.deepEqual(records.B.debitRows, [1])
        assert.equal(records.B.commit, 1)
        assert.equal(records.B.rollback, 0)
        assert.equal(records.B.rng.length, 0)
        assert.deepEqual(records.B.logs, [])
        assert.equal(records.B.error, null)
      }
    }

    for (const record of Object.values(records)) {
      assert.equal(record.authentication, 1)
      assert.equal(record.ensureUser, 1)
      assert.equal(record.beginAttempts, 1)
    }
    if (!options.contention) {
      assert.equal(records.B.began, true)
      assert.equal(records.B.closed, true)
    }

    const paid = !options.contention &&
      !options.rollback &&
      options.balance === 50
      ? 1
      : 0
    const successes = 1 + paid
    const final = await snapshot(admin)

    assert.deepEqual(final.user, [{
      telegram_id: USER_ID,
      purchased_gems: options.balance - 50 * paid,
      gems: options.balance - 50 * paid,
      bonus_gems: 15 * successes,
    }])
    assert.equal(final.history.length, successes)
    assert.equal(
      final.history.filter(row => row.cost_gems === 0).length,
      1
    )
    assert.equal(
      final.history.filter(row => row.cost_gems === 50).length,
      paid
    )

    for (const row of final.history) {
      assert.equal(row.user_id, USER_ID)
      assert.equal(row.reward_tier, 'common')
      assert.equal(row.reward_details, HISTORY_DETAILS)
      assert.equal(row.storage_type, 'integer')
      assert.ok(Number.isInteger(row.created_at))
    }

    const recent = await admin.execute({
      sql: `
        SELECT COUNT(*) AS count FROM gacha_history
        WHERE user_id = ? AND cost_gems = 0
          AND created_at >= unixepoch('now', '-7 days')
      `,
      args: [USER_ID],
    })
    assert.equal(Number(recent.rows[0].count), 1)

    assert.deepEqual(final.accounting, paid ? [{
      telegram_id: USER_ID,
      amount: -50,
      transaction_type: 'gacha_spin',
      description: 'Tirada de ruleta (common)',
    }] : [])

    // Ambas conexiones deben ver el mismo estado confirmado.
    assert.deepEqual(await snapshot(a), final)
    assert.deepEqual(await snapshot(b), final)
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    cancelled = true
    for (const entry of Object.values(signals)) entry.resolve()

    let settled
    try {
      settled = await bounded(
        pendingSettlement,
        'pending handlers during cleanup'
      )
    } catch (cleanupTimeout) {
      // No tocar SQLite mientras las llamadas puedan seguir utilizándolo.
      throw new AggregateError(
        [primaryError, cleanupTimeout].filter(Boolean),
        'Cleanup timed out with potentially active handlers; ' +
        'connections were intentionally not closed'
      )
    }

    for (const result of settled) {
      if (result.status === 'rejected' && result.reason !== primaryError) {
        cleanupErrors.push(result.reason)
      }
    }

    // Solo limpiar después de que ambas llamadas hayan terminado.
    for (const connection of active) {
      try {
        await connection.execute('ROLLBACK')
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    active.clear()

    if (admin) {
      for (const sql of [
        'DROP TRIGGER IF EXISTS synthetic_history_failure',
        'DROP TABLE IF EXISTS gem_transactions',
        'DROP TABLE IF EXISTS gacha_history',
        'DROP TABLE IF EXISTS subscriptions',
        'DROP TABLE IF EXISTS users',
      ]) {
        try {
          await admin.execute(sql)
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
    }

    for (const connection of clients.reverse()) {
      try {
        connection.close()
        assert.equal(connection.closed, true)
      } catch (error) {
        cleanupErrors.push(error)
      }
    }

    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [primaryError, ...cleanupErrors].filter(Boolean),
        'SQLite fixture cleanup failed'
      )
    }
  }
}

function childEnvironment() {
  const allowed = new Set([
    'systemroot',
    'windir',
    'path',
    'pathext',
    'temp',
    'tmp',
    'home',
    'userprofile',
    'localappdata',
    'appdata',
  ])

  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      allowed.has(key.toLowerCase())
    )
  )
}

async function superviseScenario(t, scenario) {
  await new Promise((resolve, reject) => {
    let child
    let timer
    let terminationTimer
    let finished = false
    let stopping = false
    let result
    let stdout = ''
    let stderr = ''
    const errors = []

    function finish(code, signal) {
      if (finished) return
      finished = true
      clearTimeout(timer)
      clearTimeout(terminationTimer)

      if (stdout) t.diagnostic(`Child stdout:\n${stdout}`)
      if (stderr) t.diagnostic(`Child stderr:\n${stderr}`)

      if (code !== 0 || signal !== null) {
        errors.push(new Error(
          `Child terminated abnormally: code=${code}; signal=${signal}`
        ))
      }

      if (!result || result.ok !== true) {
        errors.push(new Error(
          result?.error || 'Child did not report successful completion'
        ))
      }

      if (errors.length > 0) {
        reject(new AggregateError(
          errors,
          `Isolated scenario failed: ${scenario.id}`
        ))
      } else {
        resolve()
      }
    }

    function stop(error) {
      // Los eventos tardíos siguen teniendo listener, pero no reinician el cierre.
      if (finished) return
      errors.push(error)
      if (stopping) return
      stopping = true
      clearTimeout(timer)

      try {
        if (!child.kill('SIGKILL')) {
          errors.push(new Error('Child termination request was not accepted'))
        }
      } catch (killError) {
        errors.push(killError)
      }

      terminationTimer = setTimeout(() => {
        if (finished) return

        errors.push(new Error(
          'Child closure was not observed after termination; ' +
          'OS resource release could not be confirmed'
        ))

        // No se realizan operaciones SQLite desde el padre.
        for (const stream of [child.stdout, child.stderr]) {
          try {
            stream?.destroy()
          } catch (streamError) {
            errors.push(streamError)
          }
        }
        try {
          if (child.connected) child.disconnect()
        } catch (disconnectError) {
          errors.push(disconnectError)
        }
        try {
          child.unref()
        } catch (unrefError) {
          errors.push(unrefError)
        }
        finish(null, null)
      }, TERMINATION_TIMEOUT_MS)
    }

    function capture(stream, chunk) {
      if (finished) return
      const text = chunk.toString('utf8')
      const previous = stream === 'stdout' ? stdout : stderr
      const combined = previous + text

      if (stream === 'stdout') {
        stdout = combined.slice(0, OUTPUT_LIMIT)
      } else {
        stderr = combined.slice(0, OUTPUT_LIMIT)
      }

      if (combined.length > OUTPUT_LIMIT && !stopping) {
        stop(new Error(`Child ${stream} exceeded the diagnostic limit`))
      }
    }

    try {
      child = spawn(
        process.execPath,
        [__filename, CHILD_FLAG, scenario.id],
        {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          env: childEnvironment(),
        }
      )
    } catch (error) {
      reject(error)
      return
    }

    child.stdout.on('data', chunk => capture('stdout', chunk))
    child.stderr.on('data', chunk => capture('stderr', chunk))
    child.stdout.on('error', stop)
    child.stderr.on('error', stop)

    child.on('message', message => {
      if (finished || stopping) return
      if (
        !message ||
        message.type !== 'gacha-concurrency-result' ||
        message.scenario !== scenario.id ||
        typeof message.ok !== 'boolean' ||
        result !== undefined
      ) {
        stop(new Error('Invalid or duplicate child result'))
        return
      }

      result = message

      if (!message.ok) {
        stop(new Error(message.error || 'Child reported failure'))
      }
    })

    child.on('error', stop)
    child.once('close', finish)

    timer = setTimeout(() => {
      stop(new Error(
        `External scenario timeout after ${CHILD_TIMEOUT_MS} ms`
      ))
    }, CHILD_TIMEOUT_MS)
  })
}

async function sendResult(message) {
  await new Promise((resolve, reject) => {
    process.send(message, error => {
      if (error) reject(error)
      else resolve()
    })
  })
}

async function runChild(scenario) {
  let scenarioError

  try {
    const ts = require('typescript')
    createClient = require('@libsql/client/sqlite3').createClient
    compiledRoute = ts.transpileModule(readFileSync(routePath, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText

    await runScenario({
      diagnostic(message) {
        process.stdout.write(`${message}\n`)
      },
    }, scenario.options)
  } catch (error) {
    scenarioError = error
  }

  if (scenarioError) {
    const details = inspect(scenarioError, { depth: null })
    process.stderr.write(`${details}\n`)
    process.exitCode = 1

    await sendResult({
      type: 'gacha-concurrency-result',
      scenario: scenario.id,
      ok: false,
      error: details,
    })
  } else {
    await sendResult({
      type: 'gacha-concurrency-result',
      scenario: scenario.id,
      ok: true,
    })
  }

  if (process.connected) process.disconnect()
}

if (process.argv[2] === CHILD_FLAG) {
  const scenario = SCENARIOS.find(entry => entry.id === process.argv[3])

  if (
    !scenario ||
    process.argv.length !== 4 ||
    typeof process.send !== 'function'
  ) {
    console.error('Invalid isolated scenario invocation')
    process.exitCode = 1
    if (process.connected) process.disconnect()
  } else {
    // Observar también fallos del canal IPC o de la finalización del hijo.
    void runChild(scenario).catch(error => {
      console.error(inspect(error, { depth: null }))
      process.exitCode = 1
      if (process.connected) process.disconnect()
    })
  }
} else {
  const { test } = require('node:test')

  for (const scenario of SCENARIOS) {
    test(scenario.name, { concurrency: false }, async t => {
      await superviseScenario(t, scenario)
    })
  }
}