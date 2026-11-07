// Focused local tests only: SQLite in memory, no .env, remote DB, providers or activation.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')

function load(file, dependencies = {}, env = {}) {
  const exports = {}
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText
  vm.runInNewContext(compiled, { exports, process: { env }, console: { error() {} },
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
  }, { filename: file })
  return exports
}
const outfits = load('lib/outfits.ts')
const core = load('lib/gift-events.ts', { 'node:crypto': require('node:crypto'), './outfits': outfits })
const female = ['outfit_school', 'outfit_maid_sexy', 'outfit_police', 'outfit_bunny', 'outfit_red_lace',
  'outfit_sheer_white', 'outfit_corset_red', 'outfit_black_leather', 'outfit_cyber_armor', 'outfit_latex_black', 'outfit_nurse']
const male = ['outfit_male_firefighter', 'outfit_male_dancer', 'outfit_male_pirate', 'outfit_male_gladiator', 'outfit_male_towel']

test('explicit catalog matches all 16 approved IDs, with 11 female, 5 male and no unisex', () => {
  assert.deepEqual(Object.keys(outfits.OUTFIT_GENDERS).sort(), [...female, ...male].sort())
  assert.ok(Object.isFrozen(outfits.OUTFIT_GENDERS))
  for (const [keys, gender, other] of [[female, 'female', 'male'], [male, 'male', 'female']]) {
    for (const key of keys) {
      assert.equal(outfits.getOutfitCompatibilityError(key, gender), null)
      assert.equal(outfits.getOutfitCompatibilityError(key, other), 'outfit_gender_incompatible')
      assert.equal(outfits.getOutfitCompatibilityError(key, undefined), 'outfit_gender_incompatible')
    }
  }
  for (const key of ['outfit_male_future', 'outfit_future', '__proto__', 'constructor', '', null, 7]) {
    assert.equal(outfits.getOutfitCompatibilityError(key, 'male'), 'outfit_unknown')
    assert.equal(outfits.getOutfitCompatibilityError(key, 'female'), 'outfit_unknown')
  }
})

// Repository-owned, data-free fixture; no local review reports or external exports.
const { open, initialize } = require('./helpers/outfit-sqlite.cjs')
async function fixture(t) {
  const db = open(':memory:')
  t.after(() => db.close())
  initialize(db)
  for (const key of [...female, ...male, 'outfit_male_future']) {
    await db.execute({ sql: 'INSERT INTO gacha_outfits(id,name,prompt_tag,rarity) VALUES (?,?,?,?)',
      args: [key, key, 'Synthetic clothing', 'rare'] })
    for (let i = 0; i < 2; i++) await db.execute({
      sql: "INSERT INTO user_inventory(user_id,item_type,item_key) VALUES ('u','outfit',?)", args: [key],
    })
  }
  // Only this isolated service receives a synthetic enable option. No process.env writes.
  const service = core.createGiftEventService(db, { env: { GIFT_EVENTS_ENABLED: 'true' },
    generate: async () => { throw new Error('Generation is forbidden in these tests') } })
  assert.equal((await core.checkGiftSchema(db)).compatible, true)
  const snapshot = async () => {
    const state = {}
    for (const table of ['user_inventory', 'user_characters', 'gift_events', 'conversation_history', 'generated_images']) {
      state[table] = (await db.execute(`SELECT * FROM ${table} ORDER BY id`)).rows
    }
    return state
  }
  return { db, service: service.public, snapshot }
}
const request = (characterId, outfitKey, idempotencyKey = 'stable') => ({ userId: 'u', characterId, outfitKey, idempotencyKey })
const isCode = code => error => error instanceof core.GiftError && error.code === code

for (const [gender, characterId, ownKey, wrongKey] of [
  ['female', 1, female[0], male[0]], ['male', 2, male[0], female[0]],
]) {
  test(`transaction: ${gender} delivery consumes exactly one; replay and alternation consume none`, async t => {
    const f = await fixture(t)
    const count = async () => (await f.db.execute({ sql: 'SELECT COUNT(*) AS n FROM user_inventory WHERE item_key=?', args: [ownKey] })).rows[0].n
    const created = await f.service.create(request(characterId, ownKey))
    assert.equal(created.kind, 'created')
    assert.equal(await count(), 1)
    const delivered = await f.snapshot()
    const replay = await f.service.create(request(characterId, ownKey))
    assert.equal(replay.kind, 'existing')
    assert.equal(replay.event.id, created.event.id)
    assert.deepEqual(await f.snapshot(), delivered)
    const alternated = await f.service.create(request(characterId, ownKey, 'alternate'))
    assert.equal(alternated.kind, 'alternated')
    assert.deepEqual(await f.snapshot(), delivered)
  })

  for (const owned of [false, true]) test(`transaction: ${gender} rejects incompatible ${owned ? 'alternation' : 'gift'} before all writes`, async t => {
    const f = await fixture(t)
    if (owned) await f.db.execute({ sql: 'UPDATE user_characters SET owned_outfits=? WHERE id=?', args: [JSON.stringify([wrongKey]), characterId] })
    const before = await f.snapshot()
    const start = f.db.trace.length
    await assert.rejects(f.service.create(request(characterId, wrongKey)), isCode('outfit_gender_incompatible'))
    const statements = f.db.trace.slice(start)
    assert.ok(statements.every(s => !/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(s.sql)))
    assert.deepEqual(await f.snapshot(), before)
  })
}

test('transaction: unknown ID rejects gift and owned alternation, even when it exists in SQL catalog', async t => {
  const f = await fixture(t)
  for (const owned of [false, true]) {
    await f.db.execute({ sql: 'UPDATE user_characters SET owned_outfits=? WHERE id=2', args: [JSON.stringify(owned ? ['outfit_male_future'] : [])] })
    const before = await f.snapshot()
    const start = f.db.trace.length
    await assert.rejects(f.service.create(request(2, 'outfit_male_future')), isCode('outfit_unknown'))
    assert.ok(f.db.trace.slice(start).every(s => !/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(s.sql)))
    assert.deepEqual(await f.snapshot(), before)
  }
})

test('B1 recovery remains read-only after gender changes, while new alternation fails and key conflicts stay conflicts', async t => {
  const f = await fixture(t)
  const created = await f.service.create(request(1, female[0]))
  await f.db.execute("UPDATE user_characters SET gender='male' WHERE id=1")
  const before = await f.snapshot()
  const replay = await f.service.create(request(1, female[0]))
  assert.equal(replay.kind, 'existing')
  assert.equal(replay.event.id, created.event.id)
  assert.equal((await f.service.get({ userId: 'u', characterId: 1, eventId: created.event.id })).id, created.event.id)
  await assert.rejects(f.service.create(request(1, female[0], 'new-key')), isCode('outfit_gender_incompatible'))
  await assert.rejects(f.service.create(request(1, 'outfit_male_future')), isCode('idempotency_conflict'))
  assert.deepEqual(await f.snapshot(), before)
})

function routeFixture({ gender = 'female', owned = [], enabled = false, keyedKind, error } = {}) {
  const calls = []; let writes = 0; let services = 0; let active = false
  const tx = {
    async execute({ sql, args }) {
      assert.ok(active); calls.push(sql)
      if (sql.startsWith('SELECT')) {
        assert.match(sql, /gender FROM user_characters/)
        assert.deepEqual(Array.from(args), [1, 'u'])
        return { rows: [{ gender, owned_outfits: JSON.stringify(owned) }] }
      }
      assert.match(sql, /^UPDATE user_characters/); writes++; return { rowsAffected: 1 }
    },
    async commit() { active = false; calls.push('commit') },
    async rollback() { active = false; calls.push('rollback') },
    close() { assert.equal(active, false); calls.push('close') },
  }
  const route = load('app/api/outfits/equip/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } },
    '@/lib/turso': { db: { async transaction() { active = true; return tx } } },
    '@/lib/outfits': outfits,
    '@/lib/gift-events': { GiftError: core.GiftError, createGiftEventService: () => {
      assert.equal(active, false); assert.equal(calls.at(-1), 'close')
      return { public: { async create() {
        services++
        if (error) throw new core.GiftError(error)
        return { kind: keyedKind || 'existing', event: { id: 9 } }
      } } }
    } },
  }, enabled ? { GIFT_EVENTS_ENABLED: 'true' } : {})
  return { calls, stats: () => ({ writes, services }),
    post: (key, keyed = false) => route.POST({ headers: { get: () => 'u' },
      json: async () => ({ character_id: 1, outfit_key: key, ...(keyed ? { idempotency_key: 'stable' } : {}) }) }),
  }
}

test('HTTP legacy alternation accepts both compatible genders and rejects incompatible/unknown IDs without writes', async () => {
  for (const [gender, good, bad] of [['female', female[0], male[0]], ['male', male[0], female[0]]]) {
    for (const key of [good, bad, 'outfit_male_future']) {
      const f = routeFixture({ gender, owned: [key] })
      const response = await f.post(key)
      assert.equal(response.status, key === good ? 200 : 409)
      assert.equal(f.stats().writes, key === good ? 1 : 0)
      assert.equal(f.stats().services, 0)
      assert.equal(f.calls.at(-1), 'close')
      if (key !== good) assert.equal(response.body.error, key === bad ? 'outfit_gender_incompatible' : 'outfit_unknown')
    }
  }
})

test('HTTP new gifts reject incompatible and unknown IDs without writes, even while gifting is disabled', async () => {
  for (const key of [male[0], 'outfit_male_future']) {
    const f = routeFixture()
    assert.equal((await f.post(key)).status, 409)
    assert.deepEqual(f.stats(), { writes: 0, services: 0 })
  }
  const f = routeFixture()
  assert.equal((await f.post(female[0])).status, 403) // No activation.
})

test('HTTP keyed B1 replay reaches core first; compatibility failures map to controlled 409 responses', async () => {
  const replay = routeFixture({ gender: 'male', owned: [female[0]], enabled: true })
  assert.equal((await replay.post(female[0], true)).body.gift_result, 'existing')
  assert.deepEqual(replay.stats(), { writes: 0, services: 1 })
  for (const error of ['outfit_unknown', 'outfit_gender_incompatible', 'idempotency_conflict']) {
    const f = routeFixture({ enabled: true, error })
    const result = await f.post(female[0], true)
    assert.equal(result.status, 409); assert.equal(result.body.error, error)
    assert.deepEqual(f.stats(), { writes: 0, services: 1 })
  }
})

test('chat guards handler and both gift/alternate cards with the shared compatibility rule', () => {
  const chat = fs.readFileSync(path.join(root, 'app/chat/[id]/page.tsx'), 'utf8')
  const start = chat.indexOf('  const handleEquipOutfit')
  const handler = chat.slice(start, chat.indexOf('    const scope = outfitScopeRef.current', start))
  assert.ok(handler.indexOf('getOutfitCompatibilityError(outfitKey, character.gender)') < handler.indexOf('outfitRequestInFlight.current = true'))
  assert.match(chat, /disabled=\{equippingOutfit \|\| !!getOutfitCompatibilityError\(item.item_key, character\?\.gender\)\}/)
  assert.match(chat, /disabled=\{equippingOutfit \|\| !!getOutfitCompatibilityError\(key, character\?\.gender\)\}/)
  assert.equal((chat.match(/NO COMPATIBLE \/ SIN CLASIFICAR/g) || []).length, 2)
})