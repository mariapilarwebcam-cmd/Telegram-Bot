// Atomicidad de la recompensa por hitos de referido (R5).
// SQLite local en memoria via @libsql/client/sqlite3. Sin Turso, red ni credenciales.
// Las sentencias replican EXACTAMENTE el bloque de app/api/chat/route.ts.
const assert = require('node:assert/strict')
const { readFileSync, unlinkSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test, after } = require('node:test')
const { createClient } = require('@libsql/client/sqlite3')

const ROUTE = path.resolve(__dirname, '../app/api/chat/route.ts')
const REWARD = 15
const REFERRER = '456789'
const REFERRED = '123'

const SCHEMA = `
CREATE TABLE users (
  telegram_id TEXT PRIMARY KEY,
  bonus_gems INTEGER DEFAULT 0,
  total_referrals INTEGER DEFAULT 0,
  gems INTEGER DEFAULT 0,
  purchased_gems INTEGER DEFAULT 0,
  updated_at TEXT
);
CREATE TABLE referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id TEXT,
  referred_id TEXT,
  reward_paid INTEGER DEFAULT 0,
  reward_paid_at TEXT,
  referred_message_count INTEGER DEFAULT 0
);
CREATE TABLE gem_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT,
  amount INTEGER,
  transaction_type TEXT,
  description TEXT
);
`

let dbCounter = 0
const createdFiles = []

after(() => {
  for (const file of createdFiles) {
    try {
      unlinkSync(file)
    } catch {
      /* el archivo temporal ya no existe */
    }
  }
})

// Base de datos temporal unica por prueba: las transacciones abren conexiones
// nuevas al mismo archivo, por lo que el estado debe persistir en disco y no
// compartirse entre pruebas.
function uniqueUrl() {
  dbCounter += 1
  const file = path.join(
    os.tmpdir(),
    `referral-reward-${process.pid}-${dbCounter}.db`
  )
  createdFiles.push(file)
  return `file:${file}`
}

async function fixture(url = uniqueUrl()) {
  const db = createClient({ url })
  await db.executeMultiple(SCHEMA)
  await db.execute({
    sql: 'INSERT INTO users (telegram_id, bonus_gems) VALUES (?, 0)',
    args: [REFERRER],
  })
  await db.execute({
    sql: 'INSERT INTO referrals (referrer_id, referred_id, reward_paid) VALUES (?, ?, 0)',
    args: [REFERRER, REFERRED],
  })
  return db
}

// Replica del bloque del handler: claim + acreditacion + asiento en una tx.
async function rewardOnce(db) {
  const tx = await db.transaction('write')
  let rewarded = false
  try {
    const claim = await tx.execute({
      sql: `UPDATE referrals SET reward_paid = 1, reward_paid_at = datetime('now')
            WHERE id = ? AND reward_paid = 0`,
      args: [1],
    })
    if (claim.rowsAffected > 0) {
      const credit = await tx.execute({
        sql: `UPDATE users SET bonus_gems = COALESCE(bonus_gems, 0) + ? WHERE telegram_id = ?`,
        args: [REWARD, REFERRER],
      })
      if (credit.rowsAffected !== 1) {
        throw new Error('referrer_missing')
      }
      await tx.execute({
        sql: `INSERT INTO gem_transactions
                (telegram_id, amount, transaction_type, description)
              VALUES (?, ?, 'referral', ?)`,
        args: [REFERRER, REWARD, 'Referido verificado'],
      })
      await tx.commit()
      rewarded = true
    } else {
      await tx.rollback()
    }
  } catch (error) {
    await tx.rollback().catch(() => {})
    throw error
  }
  return rewarded
}

async function snapshot(db) {
  const user = await db.execute({
    sql: 'SELECT bonus_gems FROM users WHERE telegram_id = ?',
    args: [REFERRER],
  })
  const referral = await db.execute({
    sql: 'SELECT reward_paid FROM referrals WHERE id = 1',
  })
  const ledger = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM gem_transactions WHERE transaction_type = 'referral'",
  })
  return {
    bonus: Number(user.rows[0]?.bonus_gems ?? 0),
    paid: Number(referral.rows[0].reward_paid),
    ledger: Number(ledger.rows[0].n),
  }
}

test('1. recompensa acreditada exactamente una vez', async (t) => {
  const db = await fixture()
  t.after(() => db.close())

  assert.equal(await rewardOnce(db), true)
  assert.deepEqual(await snapshot(db), { bonus: REWARD, paid: 1, ledger: 1 })

  assert.equal(await rewardOnce(db), false)
  assert.deepEqual(await snapshot(db), { bonus: REWARD, paid: 1, ledger: 1 })
})

test('2. fallo en la acreditacion -> rollback completo', async (t) => {
  const db = await fixture()
  t.after(() => db.close())
  await db.executeMultiple(`
    CREATE TRIGGER fail_credit BEFORE UPDATE OF bonus_gems ON users
    BEGIN SELECT RAISE(ABORT, 'synthetic credit failure'); END;
  `)

  await assert.rejects(rewardOnce(db))
  assert.deepEqual(await snapshot(db), { bonus: 0, paid: 0, ledger: 0 })
})

test('3. fallo en el asiento contable -> rollback completo', async (t) => {
  const db = await fixture()
  t.after(() => db.close())
  await db.executeMultiple(`
    CREATE TRIGGER fail_ledger BEFORE INSERT ON gem_transactions
    BEGIN SELECT RAISE(ABORT, 'synthetic ledger failure'); END;
  `)

  await assert.rejects(rewardOnce(db))
  assert.deepEqual(await snapshot(db), { bonus: 0, paid: 0, ledger: 0 })
})

test('4. dos solicitudes simultaneas -> una sola recompensa', async (t) => {
  const url = uniqueUrl()
  const setup = await fixture(url)
  const a = createClient({ url })
  const b = createClient({ url })
  t.after(() => {
    a.close()
    b.close()
    setup.close()
  })

  const settled = await Promise.allSettled([rewardOnce(a), rewardOnce(b)])
  const granted = settled.filter(
    (r) => r.status === 'fulfilled' && r.value === true
  ).length
  assert.equal(granted, 1)
  assert.deepEqual(await snapshot(setup), { bonus: REWARD, paid: 1, ledger: 1 })
})

test('5. reintento tras error -> sin duplicaciones', async (t) => {
  const db = await fixture()
  t.after(() => db.close())
  await db.executeMultiple(`
    CREATE TRIGGER fail_ledger BEFORE INSERT ON gem_transactions
    BEGIN SELECT RAISE(ABORT, 'synthetic ledger failure'); END;
  `)

  await assert.rejects(rewardOnce(db))
  assert.deepEqual(await snapshot(db), { bonus: 0, paid: 0, ledger: 0 })

  await db.executeMultiple('DROP TRIGGER fail_ledger')
  assert.equal(await rewardOnce(db), true)
  assert.deepEqual(await snapshot(db), { bonus: REWARD, paid: 1, ledger: 1 })

  assert.equal(await rewardOnce(db), false)
  assert.deepEqual(await snapshot(db), { bonus: REWARD, paid: 1, ledger: 1 })
})

test('6. fallo del contador tras el commit -> recompensa intacta', async (t) => {
  const db = await fixture()
  t.after(() => db.close())
  assert.equal(await rewardOnce(db), true)

  await db.executeMultiple(`
    CREATE TRIGGER fail_counter BEFORE UPDATE OF total_referrals ON users
    BEGIN SELECT RAISE(ABORT, 'synthetic counter failure'); END;
  `)
  await assert.rejects(
    db.execute({
      sql: 'UPDATE users SET total_referrals = COALESCE(total_referrals, 0) + 1 WHERE telegram_id = ?',
      args: [REFERRER],
    })
  )
  assert.deepEqual(await snapshot(db), { bonus: REWARD, paid: 1, ledger: 1 })
})

test('7. el handler envuelve claim y acreditacion en una transaccion', () => {
  const source = readFileSync(ROUTE, 'utf8')
  const txIndex = source.indexOf("db.transaction('write')")
  const claimIndex = source.indexOf('UPDATE referrals SET reward_paid = 1')
  const creditIndex = source.indexOf(
    'bonus_gems = COALESCE(bonus_gems, 0) + ?'
  )

  assert.ok(txIndex > 0, 'falta la transaccion de escritura')
  assert.ok(claimIndex > txIndex, 'el claim debe ocurrir dentro de la transaccion')
  assert.ok(creditIndex > claimIndex, 'la acreditacion debe seguir al claim')
  assert.ok(
    !/await execute\(\s*`UPDATE referrals SET reward_paid = 1/.test(source),
    'el claim no debe ejecutarse fuera de la transaccion'
  )
  assert.match(
    source,
    /INSERT INTO gem_transactions[\s\S]{0,160}transaction_type, description\)[\s\S]{0,60}VALUES \(\?, \?, 'referral', \?\)/,
    'el asiento debe conservar las cuatro columnas de insertGemTransaction'
  )
})

test('8. referente inexistente -> rollback completo', async (t) => {
  const db = await fixture()
  t.after(() => db.close())
  await db.execute({
    sql: 'DELETE FROM users WHERE telegram_id = ?',
    args: [REFERRER],
  })

  await assert.rejects(rewardOnce(db), /referrer_missing/)
  assert.deepEqual(await snapshot(db), { bonus: 0, paid: 0, ledger: 0 })

  const referral = await db.execute({
    sql: 'SELECT reward_paid FROM referrals WHERE id = 1',
  })
  assert.equal(Number(referral.rows[0].reward_paid), 0)

  const source = readFileSync(ROUTE, 'utf8')
  assert.match(
    source,
    /if \(credit\.rowsAffected !== 1\)/,
    'el handler debe verificar rowsAffected al acreditar'
  )
})

