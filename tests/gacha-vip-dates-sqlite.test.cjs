// Caracterización local de fechas del historial VIP.
// Motor libSQL/SQLite real, exclusivamente en memoria.
// Sin importar el handler, lib/turso.ts, credenciales o configuración remota.
// Los resultados NO prueban el esquema ni los datos de producción.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createClient } = require('@libsql/client/sqlite3')

const USER_ID = 'synthetic-vip-user'
const OTHER_USER_ID = 'synthetic-other-user'
const FIXED_NOW = '2030-01-15 12:00:00'

// Esquema documentado en README.md.
const DOCUMENTED_SCHEMA = `
CREATE TABLE IF NOT EXISTS gacha_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    cost_gems INTEGER,
    reward_tier TEXT,
    reward_details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`

// Consulta del handler actual, conservada sin normalizar created_at,
// sin límite superior y sin sustituir su reloj.
const VIP_QUERY = `SELECT id FROM gacha_history 
         WHERE user_id = ? AND cost_gems = 0 AND created_at >= datetime('now', '-7 days') 
         LIMIT 1`

// Inserción del handler actual: created_at se omite deliberadamente.
const HANDLER_INSERT = `INSERT INTO gacha_history (user_id, cost_gems, reward_tier, reward_details) VALUES (?, ?, ?, ?)`

// AUXILIAR: misma condición con referencia fija, no consulta de producción.
const FIXED_REFERENCE_QUERY = `
  SELECT id FROM gacha_history
  WHERE user_id = ? AND cost_gems = 0
    AND created_at >= datetime(?, '-7 days')
  LIMIT 1
`

// DIAGNÓSTICO: no sustituye VIP_QUERY ni cambia código de producción.
const NORMALIZED_REAL_QUERY = `
  SELECT id FROM gacha_history
  WHERE user_id = ? AND cost_gems = 0
    AND datetime(created_at) >= datetime('now', '-7 days')
  LIMIT 1
`

const NORMALIZED_FIXED_QUERY = `
  SELECT id FROM gacha_history
  WHERE user_id = ? AND cost_gems = 0
    AND datetime(created_at) >= datetime(?, '-7 days')
  LIMIT 1
`

async function withDatabase(callback, withoutDefault = false) {
  // Importación explícita del adaptador local; sin token ni syncUrl.
  // No se abre ningún archivo de base de datos.
  const db = createClient({ url: 'file::memory:' })
  try {
    assert.equal(db.protocol, 'file')
    const schema = withoutDefault
      ? DOCUMENTED_SCHEMA.replace(
          'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
          'created_at TIMESTAMP'
        )
      : DOCUMENTED_SCHEMA
    await db.execute(schema)

    const columns = await db.execute('PRAGMA table_info(gacha_history)')
    assert.deepEqual(
      Array.from(columns.columns),
      ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk']
    )

    const createdAt = columns.rows.find(row => row.name === 'created_at')
    assert.ok(createdAt)
    assert.equal(createdAt.type, 'TIMESTAMP')
    assert.equal(
      createdAt.dflt_value,
      withoutDefault ? null : 'CURRENT_TIMESTAMP'
    )

    await callback(db)
  } finally {
    db.close()
    assert.equal(db.closed, true)
  }
}

async function insertOmittingDate(db, userId = USER_ID, cost = 0) {
  const result = await db.execute({
    sql: HANDLER_INSERT,
    args: [userId, cost, 'common', 'bonus_gems:synthetic reward'],
  })
  assert.equal(result.rowsAffected, 1)
  return Number(result.lastInsertRowid)
}

async function insertDate(db, value, userId = USER_ID, cost = 0) {
  const result = await db.execute({
    sql: `
      INSERT INTO gacha_history
        (user_id, cost_gems, reward_tier, reward_details, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    args: [userId, cost, 'common', 'bonus_gems:synthetic reward', value],
  })
  assert.equal(result.rowsAffected, 1)
  return Number(result.lastInsertRowid)
}

async function storedRow(db, id) {
  const result = await db.execute({
    sql: `
      SELECT id, user_id, cost_gems, created_at,
        typeof(created_at) AS storage_type,
        datetime(created_at) AS normalized
      FROM gacha_history WHERE id = ?
    `,
    args: [id],
  })
  assert.equal(result.rows.length, 1)
  return result.rows[0]
}

async function assertStored(db, id, value, normalized) {
  const row = await storedRow(db, id)
  assert.equal(row.created_at, value)
  assert.equal(row.storage_type, value === null ? 'null' : 'text')
  assert.equal(row.normalized, normalized)
  return row
}

async function assertQuery(db, sql, args, expectedId) {
  const result = await db.execute({ sql, args })
  assert.equal(result.rows.length, expectedId === null ? 0 : 1)
  if (expectedId !== null) {
    assert.equal(Number(result.rows[0].id), expectedId)
  }
}

async function clock(db) {
  const result = await db.execute(`
    SELECT CURRENT_TIMESTAMP AS current_time,
      datetime('now', '-7 days') AS cutoff
  `)
  return result.rows[0]
}

async function assertOriginalForStoredText(
  db,
  row,
  normalizedExpected = undefined
) {
  // Se consulta el reloj antes y después para no dar por supuesto
  // un instante fijo durante ejecuciones SQL separadas.
  const before = await clock(db)
  const original = await db.execute({
    sql: VIP_QUERY,
    args: [USER_ID],
  })
  const after = await clock(db)

  // Oráculo independiente para estas fixtures TEXT/NULL, no un parseo
  // de fechas: caracteriza la comparación textual del esquema documentado.
  const eligible = cutoff =>
    row.user_id === USER_ID &&
    row.cost_gems === 0 &&
    row.created_at !== null &&
    row.created_at >= cutoff

  const expectedBefore = eligible(before.cutoff)
  const expectedAfter = eligible(after.cutoff)
  assert.equal(
    expectedBefore,
    expectedAfter,
    'fixture crossed the live seven-day boundary; exact limits use fixed tests'
  )
  assert.equal(original.rows.length, expectedBefore ? 1 : 0)
  if (expectedBefore) {
    assert.equal(Number(original.rows[0].id), Number(row.id))
  }

  if (normalizedExpected !== undefined) {
    await assertQuery(
      db,
      NORMALIZED_REAL_QUERY,
      [USER_ID],
      normalizedExpected ? Number(row.id) : null
    )
  }
}

test('documented default: omitted created_at blocks another free spin', async () => {
  await withDatabase(async db => {
    const before = await clock(db)
    const id = await insertOmittingDate(db)
    const after = await clock(db)
    const row = await storedRow(db, id)

    assert.equal(row.storage_type, 'text')
    assert.match(row.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    assert.ok(row.created_at >= before.current_time)
    assert.ok(row.created_at <= after.current_time)
    assert.equal(row.normalized, row.created_at)
    await assertQuery(db, VIP_QUERY, [USER_ID], id)
    await assertOriginalForStoredText(db, row, true)
  })
})

test('explicit CURRENT_TIMESTAMP is stored as canonical text and blocks', async () => {
  await withDatabase(async db => {
    const before = await clock(db)
    const inserted = await db.execute({
      sql: `
        INSERT INTO gacha_history
          (user_id, cost_gems, reward_tier, reward_details, created_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      args: [USER_ID, 0, 'common', 'bonus_gems:synthetic reward'],
    })
    assert.equal(inserted.rowsAffected, 1)
    const id = Number(inserted.lastInsertRowid)
    const after = await clock(db)
    const row = await storedRow(db, id)

    assert.equal(row.storage_type, 'text')
    assert.match(row.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    assert.ok(row.created_at >= before.current_time)
    assert.ok(row.created_at <= after.current_time)
    assert.equal(row.normalized, row.created_at)
    await assertQuery(db, VIP_QUERY, [USER_ID], id)
    await assertOriginalForStoredText(db, row, true)
  })
})

test('explicit NULL does not invoke the default and does not block', async () => {
  await withDatabase(async db => {
    const id = await insertDate(db, null)
    const row = await assertStored(db, id, null, null)
    await assertQuery(db, VIP_QUERY, [USER_ID], null)
    await assertOriginalForStoredText(db, row, false)
  })
})

// Generar fechas lejos del límite con el reloj del propio motor.
// No se usa el reloj de JavaScript para decidir la ventana SQL.
for (const fixture of [
  { name: 'recent canonical timestamp', modifier: '-1 day', iso: false, match: true },
  { name: 'recent ISO T/Z/milliseconds', modifier: '-1 day', iso: true, match: true },
  { name: 'old canonical timestamp', modifier: '-8 days', iso: false, match: false },
  { name: 'old ISO T/Z/milliseconds', modifier: '-8 days', iso: true, match: false },
  { name: 'future canonical timestamp', modifier: '+8 days', iso: false, match: true },
  { name: 'future ISO T/Z/milliseconds', modifier: '+8 days', iso: true, match: true },
]) {
  test(`original live query: ${fixture.name}`, async () => {
    await withDatabase(async db => {
      const generated = await db.execute({
        sql: `SELECT datetime('now', ?) AS canonical`,
        args: [fixture.modifier],
      })
      const canonical = generated.rows[0].canonical
      const value = fixture.iso
        ? canonical.replace(' ', 'T') + '.123Z'
        : canonical
      const id = await insertDate(db, value)
      const row = await assertStored(db, id, value, canonical)

      await assertQuery(
        db, VIP_QUERY, [USER_ID], fixture.match ? id : null
      )
      await assertOriginalForStoredText(db, row, fixture.match)
    })
  })
}

// AUXILIAR CON REFERENCIA FIJA:
// umbral = 2030-01-08 12:00:00.
// Se ejecuta además VIP_QUERY intacta, pero no se confunden sus resultados
// con los de esta referencia fija. La columna normalized es diagnóstica.
const FIXED_CASES = [
  {
    name: 'canonical one second before boundary',
    value: '2030-01-08 11:59:59',
    normalized: '2030-01-08 11:59:59',
    originalMatch: false,
    normalizedMatch: false,
  },
  {
    name: 'canonical exactly at boundary',
    value: '2030-01-08 12:00:00',
    normalized: '2030-01-08 12:00:00',
    originalMatch: true,
    normalizedMatch: true,
  },
  {
    name: 'canonical one second after boundary',
    value: '2030-01-08 12:00:01',
    normalized: '2030-01-08 12:00:01',
    originalMatch: true,
    normalizedMatch: true,
  },
  {
    name: 'ISO T without zone before boundary: textual false positive',
    value: '2030-01-08T11:59:59',
    normalized: '2030-01-08 11:59:59',
    originalMatch: true,
    normalizedMatch: false,
  },
  {
    name: 'ISO T/Z before boundary: textual false positive',
    value: '2030-01-08T11:59:59Z',
    normalized: '2030-01-08 11:59:59',
    originalMatch: true,
    normalizedMatch: false,
  },
  {
    name: 'ISO milliseconds before boundary: textual false positive',
    value: '2030-01-08T11:59:59.500Z',
    normalized: '2030-01-08 11:59:59',
    originalMatch: true,
    normalizedMatch: false,
  },
  {
    name: 'ISO T/Z exactly at boundary',
    value: '2030-01-08T12:00:00Z',
    normalized: '2030-01-08 12:00:00',
    originalMatch: true,
    normalizedMatch: true,
  },
  {
    name: 'positive offset represents an instant before boundary',
    value: '2030-01-08T13:00:00+02:00',
    normalized: '2030-01-08 11:00:00',
    originalMatch: true,
    normalizedMatch: false,
  },
  {
    name: 'negative offset represents an instant after boundary',
    value: '2030-01-08T08:00:00-05:00',
    normalized: '2030-01-08 13:00:00',
    originalMatch: true,
    normalizedMatch: true,
  },
  {
    name: 'space with negative offset: textual false negative',
    value: '2030-01-08 08:00:00-05:00',
    normalized: '2030-01-08 13:00:00',
    originalMatch: false,
    normalizedMatch: true,
  },
]

for (const fixture of FIXED_CASES) {
  test(`AUXILIARY FIXED CLOCK: ${fixture.name}`, async () => {
    await withDatabase(async db => {
      const id = await insertDate(db, fixture.value)
      const row = await assertStored(
        db, id, fixture.value, fixture.normalized
      )

      // Consulta original con reloj real, sin sustituir ni congelar now.
      await assertOriginalForStoredText(db, row)

      // Condición original y diagnóstico normalizado con el mismo
      // instante fijo. Solo estas dos comparaciones usan FIXED_NOW.
      await assertQuery(
        db,
        FIXED_REFERENCE_QUERY,
        [USER_ID, FIXED_NOW],
        fixture.originalMatch ? id : null
      )
      await assertQuery(
        db,
        NORMALIZED_FIXED_QUERY,
        [USER_ID, FIXED_NOW],
        fixture.normalizedMatch ? id : null
      )
    })
  })
}

test('SYNTHETIC SCHEMA DIFFERENCE: omitted date without default stays NULL', async () => {
  await withDatabase(async db => {
    // Tres inserciones secuenciales sintéticas, no tiradas del handler.
    // Cada consulta continúa sin encontrar una gratuita reciente.
    for (let index = 0; index < 3; index++) {
      const id = await insertOmittingDate(db)
      const row = await assertStored(db, id, null, null)
      await assertQuery(db, VIP_QUERY, [USER_ID], null)
      await assertOriginalForStoredText(db, row, false)
    }
    const count = await db.execute('SELECT COUNT(*) AS count FROM gacha_history')
    assert.equal(Number(count.rows[0].count), 3)
  }, true)
})

test('another user recent free history does not block the target user', async () => {
  await withDatabase(async db => {
    const id = await insertOmittingDate(db, OTHER_USER_ID)
    const row = await storedRow(db, id)
    assert.equal(row.user_id, OTHER_USER_ID)
    assert.equal(row.cost_gems, 0)
    assert.equal(row.storage_type, 'text')
    assert.match(row.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    assert.equal(row.normalized, row.created_at)

    await assertQuery(db, VIP_QUERY, [USER_ID], null)
    await assertQuery(db, VIP_QUERY, [OTHER_USER_ID], id)
    await assertOriginalForStoredText(db, row, false)
  })
})

test('target user recent paid history does not consume free eligibility', async () => {
  await withDatabase(async db => {
    const id = await insertOmittingDate(db, USER_ID, 50)
    const row = await storedRow(db, id)
    assert.equal(row.user_id, USER_ID)
    assert.equal(row.cost_gems, 50)
    assert.equal(row.storage_type, 'text')
    assert.match(row.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    assert.equal(row.normalized, row.created_at)

    await assertQuery(db, VIP_QUERY, [USER_ID], null)
    await assertOriginalForStoredText(db, row, false)
  })
})