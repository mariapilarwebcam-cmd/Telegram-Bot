// Atomicidad real de applyGemPurchaseAtomic sobre motor libSQL/SQLite local.
// Se ejecuta el código de producción (lib/db-queries.ts) con una conexión
// local en memoria. Sin .env, sin Turso, sin red y sin datos reales.
// Los resultados NO demuestran el comportamiento del servidor remoto.
const assert = require('node:assert/strict')
const { readFileSync, rmSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const { createClient } = require('@libsql/client/sqlite3')

const ROOT = path.resolve(__dirname, '..')

const stripComments = (sql) =>
  sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')

const MIGRATIONS = [
  'migrations/002_gem_purchase_records.sql',
  'migrations/003_referral_commission_uniqueness.sql',
  'migrations/004_gem_purchase_commission_decision.sql',
  'migrations/005_gem_purchase_commission_referrer.sql',
]
  .map((file) => stripComments(readFileSync(path.join(ROOT, file), 'utf8')))
  .join('\n')

// Reglas comerciales reales de lib/constants.ts (fixture explícito).
const REFERRAL_RULES = {
  REFERRAL_PURCHASE_COMMISSION_PCT: 5,
  REFERRAL_TOP_TIER_THRESHOLD: 5,
  REFERRAL_TOP_TIER_PCT: 7,
  REFERRAL_ELITE_TIER_THRESHOLD: 20,
  REFERRAL_ELITE_TIER_PCT: 10,
}

// Esquema documentado (README.md 187-205) + migración 002.
const SCHEMA = `
CREATE TABLE users (
    telegram_id TEXT PRIMARY KEY,
    first_name TEXT,
    username TEXT,
    gems INTEGER DEFAULT 0,
    purchased_gems INTEGER DEFAULT 0,
    bonus_gems INTEGER DEFAULT 0,
    language TEXT,
    hook_messages_remaining INTEGER DEFAULT 0,
    hook_used INTEGER DEFAULT 0,
    referral_code TEXT,
    total_referrals INTEGER DEFAULT 0,
    paying_referrals_count INTEGER DEFAULT 0,
    age_verified INTEGER DEFAULT 0,
    streak_count INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_daily_claim TEXT,
    referred_by TEXT,
    pending_referral_code TEXT,
    gender TEXT,
    interested_in TEXT,
    onboarding_complete INTEGER DEFAULT 0,
    last_proactive_at TEXT,
    proactive_count INTEGER DEFAULT 0,
    bot_blocked INTEGER DEFAULT 0,
    photo_tokens INTEGER DEFAULT 0,
    photo_tokens_at INTEGER,
    updated_at TEXT
);

CREATE TABLE referral_commissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id TEXT,
    referred_id TEXT,
    purchase_gems INTEGER,
    commission_gems INTEGER,
    commission_pct INTEGER,
    source TEXT,
    reference TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE gem_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT,
    amount INTEGER,
    transaction_type TEXT,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE star_purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT,
    stars_amount INTEGER,
    gems_amount INTEGER,
    is_first_purchase INTEGER,
    telegram_charge_id TEXT UNIQUE,
    payment_method TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
` + MIGRATIONS

// Carga el módulo real de producción con un './turso' local y un
// './gem-payments' vacío (el import es solo de tipos y se elimina al compilar).
function loadDbQueries(db, overrides = {}) {
  const source = readFileSync(path.join(ROOT, 'lib/db-queries.ts'), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText

  const logs = []
  const turso = {
    db,
    query: async (sql, args = []) => (await db.execute({ sql, args })).rows,
    queryOne: async (sql, args = []) => {
      if (overrides.failQueryOne) throw overrides.failQueryOne
      const result = await db.execute({ sql, args })
      return result.rows[0] ?? null
    },
    execute: async (sql, args = []) => {
      const result = await db.execute({ sql, args })
      return {
        rowsAffected: result.rowsAffected,
        lastInsertRowid: result.lastInsertRowid,
      }
    },
    transaction: (statements) => db.batch(statements, 'write'),
  }

  const module = { exports: {} }
  const sandbox = {
    console: {
      log: () => {},
      warn: () => {},
      error: (...args) => logs.push(args),
    },
    module,
    exports: module.exports,
    require: (id) => {
      if (id === './turso') return turso
      if (id === './gem-payments') return {}
      if (id === './constants') return REFERRAL_RULES
      throw new Error(`require inesperado: ${id}`)
    },
  }

  vm.runInNewContext(
    `(function(require, module, exports) { ${compiled} \n})`,
    sandbox
  )(sandbox.require, module, module.exports)

  return { lib: module.exports, logs }
}

// El adaptador local en memoria pierde el esquema al revertir una transacción,
// así que se usa un archivo temporal FUERA del repositorio, eliminado al final.
async function withDb(callback, overrides) {
  const file = path.join(
    os.tmpdir(),
    `taboo-gems-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`
  )
  const client = createClient({ url: `file:${file}` })
  const db = overrides && overrides.wrapDb ? overrides.wrapDb(client) : client
  try {
    await db.executeMultiple(SCHEMA)
    await db.execute({
      sql: `INSERT INTO users
              (telegram_id, gems, purchased_gems, bonus_gems,
               hook_messages_remaining, updated_at)
            VALUES ('u1', 10, 4, 7, 3, '2026-01-01T00:00:00.000Z')`,
      args: [],
    })
    const loaded = loadDbQueries(db, overrides)
    await callback({ db, ...loaded })
  } finally {
    try {
      client.close()
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50))
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        rmSync(`${file}${suffix}`, { force: true })
      } catch {}
    }
  }
}

const userRow = async (db) =>
  (await db.execute(
    `SELECT gems, purchased_gems, bonus_gems, hook_messages_remaining
       FROM users WHERE telegram_id = 'u1'`
  )).rows[0]

const count = async (db, table) =>
  (await db.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n

// Planes equivalentes a los del catálogo (gems 150★→315, messages 100★→315,
// híbrido 200★→155+315). La derivación real del catálogo se prueba aparte.
const GEMS_PLAN = {
  rail: 'stars', type: 'gems', stars_amount: 150, gems_amount: 315,
  credit_gems: 315, credit_messages: 0, payment_method: 'gems',
  ledger: { amount: 315, type: 'purchase', description: 'Compra con 150 stars' },
  requiresLedger: true,
}
const MESSAGES_PLAN = {
  rail: 'stars', type: 'messages', stars_amount: 100, gems_amount: 0,
  credit_gems: 0, credit_messages: 315, payment_method: 'messages',
  ledger: null, requiresLedger: false,
}
const HYBRID_PLAN = {
  rail: 'stars', type: 'hybrid', stars_amount: 200, gems_amount: 155,
  credit_gems: 155, credit_messages: 315, payment_method: 'hybrid',
  ledger: { amount: 155, type: 'purchase', description: 'Compra con 200 stars' },
  requiresLedger: true,
}

test('gemas: aplica una vez y deja compra + movimiento en estado applied', async () => {
  await withDb(async ({ db, lib }) => {
    const result = await lib.applyGemPurchaseAtomic({
      telegram_id: 'u1',
      telegram_charge_id: 'ch-gems',
      is_first_purchase: false,
      plan: GEMS_PLAN,
    })

    assert.equal(result.status, 'applied')
    assert.deepEqual(
      { gems: result.gems, purchased: result.purchased_gems, bonus: result.bonus_gems },
      { gems: 325, purchased: 319, bonus: 7 }
    )
    assert.deepEqual(
      { ...(await userRow(db)) },
      { gems: 325, purchased_gems: 319, bonus_gems: 7, hook_messages_remaining: 0 }
    )

    const purchase = (await db.execute(
      `SELECT stars_amount, gems_amount, is_first_purchase, payment_method,
              status, applied_at
         FROM star_purchases WHERE telegram_charge_id = 'ch-gems'`
    )).rows

    assert.equal(purchase.length, 1)
    assert.equal(purchase[0].status, 'applied')
    assert.notEqual(purchase[0].applied_at, null)
    assert.equal(purchase[0].payment_method, 'gems')
    assert.equal(purchase[0].stars_amount, 150)
    assert.equal(purchase[0].gems_amount, 315)
    assert.equal(purchase[0].is_first_purchase, 0)

    const ledger = (await db.execute(
      `SELECT telegram_id, amount, transaction_type, charge_id
         FROM gem_transactions WHERE charge_id = 'ch-gems'`
    )).rows

    assert.equal(ledger.length, 1)
    assert.equal(ledger[0].telegram_id, 'u1')
    assert.equal(ledger[0].amount, 315)
    assert.equal(ledger[0].transaction_type, 'purchase')
  })
})

test('reintento del mismo cargo: duplicate sin doble acreditación', async () => {
  await withDb(async ({ db, lib }) => {
    const input = {
      telegram_id: 'u1',
      telegram_charge_id: 'ch-retry',
      is_first_purchase: false,
      plan: GEMS_PLAN,
    }

    assert.equal((await lib.applyGemPurchaseAtomic(input)).status, 'applied')
    assert.equal((await lib.applyGemPurchaseAtomic(input)).status, 'duplicate')
    assert.equal((await lib.applyGemPurchaseAtomic(input)).status, 'duplicate')

    assert.equal((await userRow(db)).gems, 325)
    assert.equal(await count(db, 'star_purchases'), 1)
    assert.equal(await count(db, 'gem_transactions'), 1)
  })
})

test('mensajes: solo bonus_gems, sin movimiento contable, idempotente', async () => {
  await withDb(async ({ db, lib }) => {
    const input = {
      telegram_id: 'u1',
      telegram_charge_id: 'ch-msgs',
      is_first_purchase: false,
      plan: MESSAGES_PLAN,
    }

    const result = await lib.applyGemPurchaseAtomic(input)
    assert.equal(result.status, 'applied')
    assert.equal(result.gems, 10)
    assert.equal(result.purchased_gems, 4)
    assert.equal(result.bonus_gems, 322)

    // Comportamiento previo: paquete de mensajes sin asiento contable.
    assert.equal(await count(db, 'gem_transactions'), 0)

    // La prueba de duplicado no depende del asiento: usa status = 'applied'.
    assert.equal((await lib.applyGemPurchaseAtomic(input)).status, 'duplicate')
    assert.equal((await userRow(db)).bonus_gems, 322)
    assert.equal(await count(db, 'star_purchases'), 1)
  })
})

test('híbrido: gemas y mensajes se acreditan juntos', async () => {
  await withDb(async ({ db, lib }) => {
    const input = {
      telegram_id: 'u1',
      telegram_charge_id: 'ch-hybrid',
      is_first_purchase: true,
      plan: HYBRID_PLAN,
    }

    const result = await lib.applyGemPurchaseAtomic(input)
    assert.equal(result.status, 'applied')
    assert.deepEqual(
      { ...(await userRow(db)) },
      { gems: 165, purchased_gems: 159, bonus_gems: 322, hook_messages_remaining: 0 }
    )

    const purchase = (await db.execute(
      `SELECT is_first_purchase, payment_method, gems_amount
         FROM star_purchases WHERE telegram_charge_id = 'ch-hybrid'`
    )).rows[0]
    assert.equal(purchase.is_first_purchase, 1)
    assert.equal(purchase.payment_method, 'hybrid')
    assert.equal(purchase.gems_amount, 155)

    assert.equal(
      (await db.execute(
        `SELECT amount FROM gem_transactions WHERE charge_id = 'ch-hybrid'`
      )).rows[0].amount,
      155
    )

    assert.equal((await lib.applyGemPurchaseAtomic(input)).status, 'duplicate')
    assert.equal((await userRow(db)).bonus_gems, 322)
  })
})

test('error al acreditar: rollback total, sin compra ni movimiento', async () => {
  await withDb(async ({ db, lib }) => {
    await db.execute(
      `CREATE TRIGGER fail_users BEFORE UPDATE ON users
       BEGIN SELECT RAISE(ABORT, 'synthetic credit failure'); END`
    )

    await assert.rejects(
      lib.applyGemPurchaseAtomic({
        telegram_id: 'u1',
        telegram_charge_id: 'ch-credit-fail',
        is_first_purchase: false,
        plan: GEMS_PLAN,
      }),
      /synthetic credit failure/
    )

    assert.equal(await count(db, 'star_purchases'), 0)
    assert.equal(await count(db, 'gem_transactions'), 0)
    assert.deepEqual(
      { ...(await userRow(db)) },
      { gems: 10, purchased_gems: 4, bonus_gems: 7, hook_messages_remaining: 3 }
    )
  })
})

test('error al registrar el movimiento contable: rollback total', async () => {
  await withDb(async ({ db, lib }) => {
    await db.execute(
      `CREATE TRIGGER fail_ledger BEFORE INSERT ON gem_transactions
       BEGIN SELECT RAISE(ABORT, 'synthetic ledger failure'); END`
    )

    await assert.rejects(
      lib.applyGemPurchaseAtomic({
        telegram_id: 'u1',
        telegram_charge_id: 'ch-ledger-fail',
        is_first_purchase: false,
        plan: GEMS_PLAN,
      }),
      /synthetic ledger failure/
    )

    // El cargo no queda consumido: un reintento posterior puede aplicarlo.
    assert.equal(await count(db, 'star_purchases'), 0)
    assert.equal(await count(db, 'gem_transactions'), 0)
    assert.equal((await userRow(db)).gems, 10)

    await db.execute('DROP TRIGGER fail_ledger')
    const retry = await lib.applyGemPurchaseAtomic({
      telegram_id: 'u1',
      telegram_charge_id: 'ch-ledger-fail',
      is_first_purchase: false,
      plan: GEMS_PLAN,
    })
    assert.equal(retry.status, 'applied')
    assert.equal((await userRow(db)).gems, 325)
  })
})

test('usuario inexistente: user_missing y sin filas persistidas', async () => {
  await withDb(async ({ db, lib }) => {
    const result = await lib.applyGemPurchaseAtomic({
      telegram_id: 'nobody',
      telegram_charge_id: 'ch-missing-user',
      is_first_purchase: false,
      plan: GEMS_PLAN,
    })

    assert.equal(result.status, 'user_missing')
    assert.equal(await count(db, 'star_purchases'), 0)
    assert.equal(await count(db, 'gem_transactions'), 0)
  })
})

test('compra antigua sin estado probado: conflict, sin acreditar ni duplicar', async () => {
  await withDb(async ({ db, lib }) => {
    // Fila creada por el código anterior a la migración.
    await db.execute({
      sql: `INSERT INTO star_purchases
              (telegram_id, stars_amount, gems_amount, is_first_purchase,
               telegram_charge_id, payment_method)
            VALUES ('u1', 150, 315, 0, 'ch-legacy', 'gems')`,
      args: [],
    })

    const result = await lib.applyGemPurchaseAtomic({
      telegram_id: 'u1',
      telegram_charge_id: 'ch-legacy',
      is_first_purchase: false,
      plan: GEMS_PLAN,
    })

    // Objeto creado en otro contexto vm: se copia al contexto del test.
    assert.deepEqual({ ...result }, { status: 'conflict', reason: 'purchase_not_applied' })
    assert.deepEqual(
      { ...(await userRow(db)) },
      { gems: 10, purchased_gems: 4, bonus_gems: 7, hook_messages_remaining: 3 }
    )
    assert.equal(await count(db, 'gem_transactions'), 0)
  })
})

test('compra applied sin movimiento contable: conflict ledger_missing', async () => {
  await withDb(async ({ db, lib }) => {
    await db.execute({
      sql: `INSERT INTO star_purchases
              (telegram_id, stars_amount, gems_amount, is_first_purchase,
               telegram_charge_id, payment_method, status, applied_at)
            VALUES ('u1', 150, 315, 0, 'ch-noledger', 'gems', 'applied', 'now')`,
      args: [],
    })

    const result = await lib.applyGemPurchaseAtomic({
      telegram_id: 'u1',
      telegram_charge_id: 'ch-noledger',
      is_first_purchase: false,
      plan: GEMS_PLAN,
    })

    assert.deepEqual({ ...result }, { status: 'conflict', reason: 'ledger_missing' })
    assert.equal((await userRow(db)).gems, 10)
  })
})

test('movimiento contable discordante: conflict ledger_mismatch', async () => {
  await withDb(async ({ db, lib }) => {
    await db.execute({
      sql: `INSERT INTO star_purchases
              (telegram_id, stars_amount, gems_amount, is_first_purchase,
               telegram_charge_id, payment_method, status, applied_at)
            VALUES ('u1', 150, 315, 0, 'ch-mismatch', 'gems', 'applied', 'now')`,
      args: [],
    })
    await db.execute({
      sql: `INSERT INTO gem_transactions
              (telegram_id, amount, transaction_type, description, charge_id)
            VALUES ('u1', 999, 'purchase', 'otro', 'ch-mismatch')`,
      args: [],
    })

    const result = await lib.applyGemPurchaseAtomic({
      telegram_id: 'u1',
      telegram_charge_id: 'ch-mismatch',
      is_first_purchase: false,
      plan: GEMS_PLAN,
    })

    assert.deepEqual({ ...result }, { status: 'conflict', reason: 'ledger_mismatch' })
    assert.equal((await userRow(db)).gems, 10)
  })
})

test('error de lectura en la prueba de evidencia: no se responde duplicate', async () => {
  const readFailure = new Error('synthetic evidence read failure')

  await withDb(
    async ({ lib }) => {
      const input = {
        telegram_id: 'u1',
        telegram_charge_id: 'ch-evidence',
        is_first_purchase: false,
        plan: GEMS_PLAN,
      }

      assert.equal((await lib.applyGemPurchaseAtomic(input)).status, 'applied')
      await assert.rejects(
        lib.applyGemPurchaseAtomic(input),
        /synthetic evidence read failure/
      )
    },
    { failQueryOne: readFailure }
  )
})

// ═══════════════ Comisiones y conciliación ═══════════════

const seedReferrer = async (db, id = 'ref-1') => {
  await db.execute({
    sql: `INSERT INTO users
            (telegram_id, gems, purchased_gems, bonus_gems,
             hook_messages_remaining, updated_at, referred_by,
             paying_referrals_count)
          VALUES (?, 0, 0, 0, 0, '2026-01-01T00:00:00.000Z', NULL, 0)`,
    args: [id],
  })
}

const linkReferral = async (db, buyer = 'u1', referrer = 'ref-1') => {
  await db.execute({
    sql: `UPDATE users SET referred_by = ? WHERE telegram_id = ?`,
    args: [referrer, buyer],
  })
}

const gemsOf = async (db, id) =>
  (await db.execute({ sql: `SELECT gems FROM users WHERE telegram_id = ?`, args: [id] }))
    .rows[0].gems

const seedAppliedPurchase = async (db, charge, pct, base, referrer = 'ref-1') => {
  await db.execute({
    sql: `INSERT INTO star_purchases
            (telegram_id, stars_amount, gems_amount, is_first_purchase,
             telegram_charge_id, payment_method, status, applied_at,
             commission_referrer_id, commission_base_gems, commission_pct)
          VALUES ('u1', 150, 315, 0, ?, 'gems', 'applied', 'now', ?, ?, ?)`,
    args: [charge, referrer, base, pct],
  })
}

const seedBuyers = async (db, referrer, buyers) => {
  for (const buyer of buyers) {
    await db.execute({
      sql: `INSERT INTO referral_commissions
              (referrer_id, referred_id, purchase_gems, commission_gems,
               commission_pct, source, reference)
            VALUES (?, ?, 100, 5, 5, 'stars', ?)`,
      args: [referrer, buyer, `old-${buyer}`],
    })
  }
}

// Simula una respuesta perdida de commit(): revierte y lanza.
const failingCommitDb = (client) => ({
  execute: (...args) => client.execute(...args),
  executeMultiple: (...args) => client.executeMultiple(...args),
  transaction: async (mode) => {
    const tx = await client.transaction(mode)
    return {
      execute: (...args) => tx.execute(...args),
      rollback: (...args) => tx.rollback(...args),
      commit: async () => {
        await tx.rollback().catch(() => {})
        throw new Error('synthetic commit failure')
      },
      close: () => {
        try {
          tx.close()
        } catch {}
      },
    }
  },
})

test('comisión 5%: referidor, registro, contador y asiento en la misma transacción', async () => {
  await withDb(async ({ db, lib }) => {
    await seedReferrer(db)
    await linkReferral(db)

    const result = await lib.applyGemPurchaseAtomic({
      telegram_id: 'u1',
      telegram_charge_id: 'ch-com-1',
      is_first_purchase: false,
      plan: GEMS_PLAN,
      commission: { referrer_id: 'ref-1', base_gems: 315 },
    })

    assert.equal(result.status, 'applied')
    assert.equal(result.commission_applied, true)
    assert.equal(await gemsOf(db, 'ref-1'), 15)

    const row = (await db.execute(
      `SELECT referrer_id, purchase_gems, commission_gems, commission_pct, source
         FROM referral_commissions WHERE reference = 'ch-com-1'`
    )).rows[0]
    assert.equal(row.referrer_id, 'ref-1')
    assert.equal(row.purchase_gems, 315)
    assert.equal(row.commission_gems, 15)
    assert.equal(row.commission_pct, 5)
    assert.equal(row.source, 'stars')

    const ledger = (await db.execute(
      `SELECT telegram_id, amount FROM gem_transactions
        WHERE charge_id = 'ch-com-1:commission'`
    )).rows[0]
    assert.equal(ledger.telegram_id, 'ref-1')
    assert.equal(ledger.amount, 15)

    const decision = (await db.execute(
      `SELECT commission_referrer_id, commission_base_gems, commission_pct
         FROM star_purchases WHERE telegram_charge_id = 'ch-com-1'`
    )).rows[0]
    assert.equal(decision.commission_referrer_id, 'ref-1')
    assert.equal(decision.commission_base_gems, 315)
    assert.equal(decision.commission_pct, 5)

    const counter = (await db.execute(
      `SELECT paying_referrals_count FROM users WHERE telegram_id = 'ref-1'`
    )).rows[0].paying_referrals_count
    assert.equal(counter, 1)
  })
})

test('tramo 7% y reintento sin doble comisión', async () => {
  await withDb(async ({ db, lib }) => {
    await seedReferrer(db)
    await linkReferral(db)
    await seedBuyers(db, 'ref-1', ['b1', 'b2', 'b3', 'b4'])

    const input = {
      telegram_id: 'u1',
      telegram_charge_id: 'ch-com-2',
      is_first_purchase: false,
      plan: GEMS_PLAN,
      commission: { referrer_id: 'ref-1', base_gems: 315 },
    }

    const first = await lib.applyGemPurchaseAtomic(input)
    assert.equal(first.status, 'applied')
    assert.equal(await gemsOf(db, 'ref-1'), 22) // floor(315 * 7 / 100)

    const again = await lib.applyGemPurchaseAtomic(input)
    assert.equal(again.status, 'duplicate')
    assert.equal(await gemsOf(db, 'ref-1'), 22)
    assert.equal(await count(db, 'referral_commissions'), 5)
  })
})

test('conciliación: pct ORIGINAL persistido, idempotente y ajeno al tramo actual', async () => {
  await withDb(async ({ db, lib }) => {
    await seedReferrer(db)
    await seedAppliedPurchase(db, 'ch-pend', 5, 315)
    // El referidor sube de tramo DESPUÉS de la compra.
    await seedBuyers(db, 'ref-1', ['b1', 'b2', 'b3', 'b4', 'b5'])

    const first = await lib.reconcileCommissionByCharge('u1', 'ch-pend')
    assert.deepEqual({ ...first }, { status: 'applied', commission_gems: 15 })
    assert.equal(await gemsOf(db, 'ref-1'), 15) // 5 %, no 7 %

    const second = await lib.reconcileCommissionByCharge('u1', 'ch-pend')
    assert.deepEqual({ ...second }, { status: 'already_applied' })
    assert.equal(await gemsOf(db, 'ref-1'), 15)
    assert.equal(await count(db, 'referral_commissions'), 6)
  })
})

test('conciliación: asiento huérfano exige revisión y no acredita', async () => {
  await withDb(async ({ db, lib }) => {
    await seedReferrer(db)
    await seedAppliedPurchase(db, 'ch-orphan', 5, 315)
    await db.execute({
      sql: `INSERT INTO gem_transactions
              (telegram_id, amount, transaction_type, description, charge_id)
            VALUES ('ref-1', 15, 'referral_commission', 'x', 'ch-orphan:commission')`,
      args: [],
    })

    const result = await lib.reconcileCommissionByCharge('u1', 'ch-orphan')
    assert.deepEqual({ ...result }, { status: 'review_required', reason: 'ledger_orphan' })
    assert.equal(await gemsOf(db, 'ref-1'), 0)
  })
})

test('fallo de commit: estado incierto sin acreditar a nadie', async () => {
  await withDb(
    async ({ db, lib }) => {
      await seedReferrer(db)
      await linkReferral(db)

      await assert.rejects(
        lib.applyGemPurchaseAtomic({
          telegram_id: 'u1',
          telegram_charge_id: 'ch-commit',
          is_first_purchase: false,
          plan: GEMS_PLAN,
          commission: { referrer_id: 'ref-1', base_gems: 315 },
        }),
        /gem_purchase_commit_uncertain/
      )

      assert.equal(await count(db, 'star_purchases'), 0)
      assert.equal(await count(db, 'referral_commissions'), 0)
      assert.equal(await gemsOf(db, 'ref-1'), 0)
      assert.equal((await userRow(db)).gems, 10)
    },
    { wrapDb: failingCommitDb }
  )
})

test('comisión pendiente: compra confirmada con decisión persistida y recuperable', async () => {
  await withDb(async ({ db, lib }) => {
    await seedReferrer(db)
    await linkReferral(db)
    await db.execute(
      `CREATE TRIGGER fail_commission BEFORE INSERT ON referral_commissions
       BEGIN SELECT RAISE(ABORT, 'synthetic commission failure'); END`
    )

    const input = {
      telegram_id: 'u1',
      telegram_charge_id: 'ch-pending',
      is_first_purchase: false,
      plan: GEMS_PLAN,
      commission: { referrer_id: 'ref-1', base_gems: 315 },
    }

    const result = await lib.applyGemPurchaseAtomic(input)
    assert.equal(result.status, 'applied')
    assert.equal(result.commission_applied, false)
    assert.equal(result.commission_note, 'commission_transient_failure')
    assert.equal((await userRow(db)).gems, 325) // el comprador SÍ recibe
    assert.equal(await count(db, 'referral_commissions'), 0)
    assert.equal(await gemsOf(db, 'ref-1'), 0)

    const decision = (await db.execute(
      `SELECT commission_referrer_id, commission_base_gems, commission_pct
         FROM star_purchases WHERE telegram_charge_id = 'ch-pending'`
    )).rows[0]
    assert.equal(decision.commission_referrer_id, 'ref-1')
    assert.equal(decision.commission_base_gems, 315)
    assert.equal(decision.commission_pct, 5)

    assert.equal((await lib.applyGemPurchaseAtomic(input)).status, 'duplicate')
    assert.equal((await userRow(db)).gems, 325)

    await db.execute('DROP TRIGGER fail_commission')
    const repaired = await lib.reconcileCommissionByCharge('u1', 'ch-pending')
    assert.deepEqual({ ...repaired }, { status: 'applied', commission_gems: 15 })
    assert.equal(await gemsOf(db, 'ref-1'), 15)
  })
})

test('fallo de rollback: gem_purchase_rollback_failed sin acreditar', async () => {
  const calls = { writes: 0 }
  const failingRollbackDb = (client) => ({
    execute: (...args) => client.execute(...args),
    executeMultiple: (...args) => client.executeMultiple(...args),
    transaction: async (mode) => {
      if (mode === 'write') calls.writes += 1
      const tx = await client.transaction(mode)
      return {
        execute: (...args) => tx.execute(...args),
        commit: (...args) => tx.commit(...args),
        rollback: async () => {
          throw new Error('synthetic rollback failure')
        },
        close: () => {
          try {
            tx.close()
          } catch {}
        },
      }
    },
  })

  await withDb(
    async ({ db, lib }) => {
      await seedReferrer(db)
      await linkReferral(db)
      await db.execute(
        `CREATE TRIGGER fail_commission BEFORE INSERT ON referral_commissions
         BEGIN SELECT RAISE(ABORT, 'synthetic commission failure'); END`
      )

      await assert.rejects(
        lib.applyGemPurchaseAtomic({
          telegram_id: 'u1',
          telegram_charge_id: 'ch-rollback',
          is_first_purchase: false,
          plan: GEMS_PLAN,
          commission: { referrer_id: 'ref-1', base_gems: 315 },
        }),
        /gem_purchase_rollback_failed/
      )

      assert.equal(await gemsOf(db, 'ref-1'), 0)
      assert.equal(calls.writes, 1) // la transacción NO se reejecuta
    },
    { wrapDb: failingRollbackDb }
  )
})

test('conciliación: histórico sin decisión, referidor inexistente y cargo no aplicado', async () => {
  await withDb(async ({ db, lib }) => {
    await db.execute({
      sql: `INSERT INTO star_purchases
              (telegram_id, stars_amount, gems_amount, is_first_purchase,
               telegram_charge_id, payment_method, status, applied_at)
            VALUES ('u1', 150, 315, 0, 'ch-history', 'gems', 'applied', 'now')`,
      args: [],
    })
    assert.deepEqual(
      { ...(await lib.reconcileCommissionByCharge('u1', 'ch-history')) },
      { status: 'review_required', reason: 'decision_missing' }
    )

    await seedAppliedPurchase(db, 'ch-noref', 5, 315, 'ref-deleted')
    assert.deepEqual(
      { ...(await lib.reconcileCommissionByCharge('u1', 'ch-noref')) },
      { status: 'referrer_missing' }
    )
    assert.equal(await count(db, 'referral_commissions'), 0)

    assert.deepEqual(
      { ...(await lib.reconcileCommissionByCharge('u1', 'ch-unknown')) },
      { status: 'not_applied_purchase' }
    )
  })
})

test('charge_id de comisión: coexiste con el del comprador y no admite duplicados', async () => {
  await withDb(async ({ db, lib }) => {
    await seedReferrer(db)
    await linkReferral(db)

    await lib.applyGemPurchaseAtomic({
      telegram_id: 'u1',
      telegram_charge_id: 'ch-col',
      is_first_purchase: false,
      plan: GEMS_PLAN,
      commission: { referrer_id: 'ref-1', base_gems: 315 },
    })

    const rows = (await db.execute(
      `SELECT charge_id FROM gem_transactions
        WHERE charge_id LIKE 'ch-col%' ORDER BY charge_id`
    )).rows.map((r) => r.charge_id)
    assert.deepEqual(rows, ['ch-col', 'ch-col:commission'])

    await assert.rejects(
      db.execute({
        sql: `INSERT INTO gem_transactions
                (telegram_id, amount, transaction_type, description, charge_id)
              VALUES ('ref-1', 15, 'referral_commission', 'dup', 'ch-col:commission')`,
        args: [],
      }),
      /UNIQUE/i
    )
  })
})

test('contador de referidos: monótono ante valores menores', async () => {
  await withDb(async ({ db, lib }) => {
    await seedReferrer(db)
    await linkReferral(db)
    await db.execute({
      sql: `UPDATE users SET paying_referrals_count = 9 WHERE telegram_id = 'ref-1'`,
      args: [],
    })

    const result = await lib.applyGemPurchaseAtomic({
      telegram_id: 'u1',
      telegram_charge_id: 'ch-counter',
      is_first_purchase: false,
      plan: GEMS_PLAN,
      commission: { referrer_id: 'ref-1', base_gems: 315 },
    })
    assert.equal(result.status, 'applied')

    const counter = (await db.execute(
      `SELECT paying_referrals_count FROM users WHERE telegram_id = 'ref-1'`
    )).rows[0].paying_referrals_count
    assert.equal(counter, 9)
  })
})

test('commit aplicado con respuesta perdida: exactamente una acreditación', async () => {
  const calls = { writes: 0, commits: 0 }

  // El commit REAL se aplica y después se lanza, como si se perdiera la respuesta.
  const lostCommitDb = (client) => ({
    execute: (...args) => client.execute(...args),
    executeMultiple: (...args) => client.executeMultiple(...args),
    transaction: async (mode) => {
      if (mode === 'write') calls.writes += 1
      const tx = await client.transaction(mode)
      return {
        execute: (...args) => tx.execute(...args),
        rollback: (...args) => tx.rollback(...args),
        commit: async () => {
          await tx.commit()
          calls.commits += 1
          throw new Error('synthetic lost commit response')
        },
        close: () => {
          try {
            tx.close()
          } catch {}
        },
      }
    },
  })

  await withDb(
    async ({ db, lib }) => {
      await seedReferrer(db)
      await linkReferral(db)

      const result = await lib.applyGemPurchaseAtomic({
        telegram_id: 'u1',
        telegram_charge_id: 'ch-lost',
        is_first_purchase: false,
        plan: GEMS_PLAN,
        commission: { referrer_id: 'ref-1', base_gems: 315 },
      })

      // Resultado incierto resuelto por verificación: ya estaba aplicado.
      assert.equal(result.status, 'duplicate')

      // Acreditado EXACTAMENTE una vez (comprador y referidor).
      assert.equal((await userRow(db)).gems, 325)
      assert.equal(await gemsOf(db, 'ref-1'), 15)
      assert.equal(await count(db, 'star_purchases'), 1)
      assert.equal(await count(db, 'referral_commissions'), 1)
      assert.equal(
        (await db.execute(
          `SELECT COUNT(*) AS n FROM gem_transactions WHERE charge_id IN ('ch-lost','ch-lost:commission')`
        )).rows[0].n,
        2
      )

      // Sin reejecución: una sola transacción de escritura y un solo commit.
      assert.equal(calls.writes, 1)
      assert.equal(calls.commits, 1)
    },
    { wrapDb: lostCommitDb }
  )
})

test('REFERRAL_RULES coincide exactamente con lib/constants.ts', () => {
  const source = readFileSync(path.join(ROOT, 'lib/constants.ts'), 'utf8')
  const value = (name) => {
    const match = source.match(new RegExp(`export const ${name}\\s*=\\s*(\\d+)`))
    assert.ok(match, `no encontrado en constants.ts: ${name}`)
    return Number(match[1])
  }

  assert.deepEqual(
    {
      REFERRAL_PURCHASE_COMMISSION_PCT: value('REFERRAL_PURCHASE_COMMISSION_PCT'),
      REFERRAL_TOP_TIER_THRESHOLD: value('REFERRAL_TOP_TIER_THRESHOLD'),
      REFERRAL_TOP_TIER_PCT: value('REFERRAL_TOP_TIER_PCT'),
      REFERRAL_ELITE_TIER_THRESHOLD: value('REFERRAL_ELITE_TIER_THRESHOLD'),
      REFERRAL_ELITE_TIER_PCT: value('REFERRAL_ELITE_TIER_PCT'),
    },
    REFERRAL_RULES
  )
})

// ═══════════════ Resolución de comisión (Etapa 3A) ═══════════════

test('resolveCommissionTarget: comprador sin referidor ⇒ no_referrer', async () => {
  await withDb(async ({ lib }) => {
    assert.deepEqual(
      { ...(await lib.resolveCommissionTarget('u1', 315)) },
      { status: 'no_referrer' }
    )
  })
})

test('resolveCommissionTarget: referidor inexistente ⇒ referrer_missing', async () => {
  await withDb(async ({ db, lib }) => {
    await linkReferral(db, 'u1', 'ref-deleted') // no existe en users
    assert.deepEqual(
      { ...(await lib.resolveCommissionTarget('u1', 315)) },
      { status: 'referrer_missing' }
    )
    assert.equal(await count(db, 'referral_commissions'), 0)
  })
})

test('resolveCommissionTarget: resuelve desde BD y aplica floor a la base', async () => {
  await withDb(async ({ db, lib }) => {
    await seedReferrer(db)
    await linkReferral(db)

    const resolved = await lib.resolveCommissionTarget('u1', 315.9)
    assert.equal(resolved.status, 'resolved')
    // Objetos anidados creados en el contexto vm: se comparan por campos.
    assert.deepEqual(
      {
        referrer_id: resolved.target.referrer_id,
        base_gems: resolved.target.base_gems,
      },
      { referrer_id: 'ref-1', base_gems: 315 }
    )

    // Solo lecturas: no escribe comisión ni mueve saldos.
    assert.equal(await count(db, 'referral_commissions'), 0)
    assert.equal(await gemsOf(db, 'ref-1'), 0)
  })
})

test('resolveCommissionTarget: base no positiva ⇒ not_applicable', async () => {
  await withDb(async ({ db, lib }) => {
    await seedReferrer(db)
    await linkReferral(db)
    assert.deepEqual(
      { ...(await lib.resolveCommissionTarget('u1', 0)) },
      { status: 'not_applicable' }
    )
    assert.deepEqual(
      { ...(await lib.resolveCommissionTarget('u1', -5)) },
      { status: 'not_applicable' }
    )
  })
})

test('resolveCommissionTarget: error de lectura se propaga', async () => {
  await withDb(
    async ({ lib }) => {
      await assert.rejects(
        lib.resolveCommissionTarget('u1', 315),
        /synthetic evidence read failure/
      )
    },
    { failQueryOne: new Error('synthetic evidence read failure') }
  )
})

test('decisión persistida: el referidor original no se sustituye', async () => {
  await withDb(async ({ db, lib }) => {
    await seedReferrer(db)
    await seedReferrer(db, 'ref-2')
    await linkReferral(db)

    const first = await lib.applyGemPurchaseAtomic({
      telegram_id: 'u1',
      telegram_charge_id: 'ch-orig',
      is_first_purchase: false,
      plan: GEMS_PLAN,
      commission: { referrer_id: 'ref-1', base_gems: 315 },
    })
    assert.equal(first.status, 'applied')

    const again = await lib.applyGemPurchaseAtomic({
      telegram_id: 'u1',
      telegram_charge_id: 'ch-orig',
      is_first_purchase: false,
      plan: GEMS_PLAN,
      commission: { referrer_id: 'ref-2', base_gems: 315 },
    })
    assert.equal(again.status, 'duplicate')

    const stored = (await db.execute(
      `SELECT commission_referrer_id FROM star_purchases
        WHERE telegram_charge_id = 'ch-orig'`
    )).rows[0]

    assert.equal(stored.commission_referrer_id, 'ref-1')
    assert.equal(await gemsOf(db, 'ref-2'), 0)
    assert.equal(await gemsOf(db, 'ref-1'), 15)
    assert.equal(await count(db, 'referral_commissions'), 1)
  })
})


