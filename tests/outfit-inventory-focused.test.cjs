// Local-only: transpiled modules with explicit mocks; no .env, DB or image providers.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const root = path.resolve(__dirname, '..')

function load(relative, dependencies = {}, environment = {}) {
  const source = readFileSync(path.join(root, relative), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  const exports = {}
  vm.runInNewContext(compiled, {
    exports, process: { env: environment }, URL,
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`)
      return dependencies[name]
    },
  }, { filename: relative })
  return exports
}
const outfits = load('lib/outfits.ts')
const plain = value => JSON.parse(JSON.stringify(value))

test('image URLs preserve the working gacha convention, including existing folder bases', () => {
  assert.equal(outfits.getItemImageUrl('dress', undefined), '')
  for (const [base, expected] of [
    ['https://images.invalid', 'https://images.invalid/item/dress.jpg'],
    ['https://images.invalid/', 'https://images.invalid/item/dress.jpg'],
    ['https://images.invalid/item', 'https://images.invalid/item/dress.jpg'],
    ['https://images.invalid/items/', 'https://images.invalid/items/dress.jpg'],
  ]) assert.equal(outfits.getItemImageUrl('dress', base), expected)
})

test('quantities count actual rows by item_key and reflect consumption without counting ownership', () => {
  const rows = [{ id: 1, item_key: 'dress' }, { id: 2, item_key: 'suit' }, { id: 3, item_key: 'dress' }]
  assert.deepEqual(plain(outfits.groupOutfitInventory(rows)), [
    { item_key: 'dress', quantity: 2 }, { item_key: 'suit', quantity: 1 },
  ])
  assert.equal(outfits.groupOutfitInventory(rows.slice(1)).find(x => x.item_key === 'dress').quantity, 1)
  assert.equal(rows.length, 3)
  assert.deepEqual(plain(outfits.groupOutfitInventory([])), [])
  assert.equal(outfits.groupOutfitInventory([{ id: 4, item_key: '__proto__' }])[0].quantity, 1)
})

test('names come from catalog; unknown obtained outfits remain visible with readable names', () => {
  assert.equal(outfits.getOutfitName('dress', [{ id: 'dress', name: 'Catalog name' }]), 'Catalog name')
  assert.equal(outfits.getOutfitName('outfit_new_long_name', []), 'new long name')
})

function cardModule(base) {
  let failed = null
  return load('components/OutfitCard.tsx', {
    react: { useState: () => [failed, value => { failed = value }] },
    'react/jsx-runtime': require('react/jsx-runtime'),
    '@/lib/outfits': { getItemImageUrl: key => outfits.getItemImageUrl(key, base) },
  })
}
function findElement(element, type) {
  if (!element || typeof element !== 'object') return undefined
  if (element.type === type) return element
  for (const child of React.Children.toArray(element.props?.children)) {
    const found = findElement(child, type)
    if (found) return found
  }
}

test('shared card shows quantity and image, falls back on failure, and retries for a different URL', () => {
  const { OutfitCard } = cardModule('https://images.invalid')
  const props = { itemKey: 'dress', name: 'Dress', quantity: 2 }
  let tree = OutfitCard(props)
  assert.equal(tree.type, 'div') // General inventory has no delivery action.
  assert.match(renderToStaticMarkup(tree), /×2/)
  const img = findElement(tree, 'img')
  assert.equal(img.props.src, 'https://images.invalid/item/dress.jpg')
  img.props.onError()
  tree = OutfitCard(props)
  assert.equal(findElement(tree, 'img'), undefined)
  assert.match(renderToStaticMarkup(tree), /👗/)
  assert.ok(findElement(OutfitCard({ ...props, itemKey: 'suit' }), 'img'))
  assert.equal(findElement(cardModule(undefined).OutfitCard(props), 'img'), undefined)
})

test('shared card preserves action, disabled state, and distinguishes ownership without a consumable count', () => {
  const { OutfitCard } = cardModule(undefined)
  let called = 0
  const tree = OutfitCard({ itemKey: 'dress', name: 'Dress', label: 'ALTERNAR · NO CONSUME',
    selected: true, disabled: true, onClick: () => called++ })
  assert.equal(tree.type, 'button')
  assert.equal(tree.props.disabled, true)
  assert.match(renderToStaticMarkup(tree), /ALTERNAR · NO CONSUME/)
  assert.doesNotMatch(renderToStaticMarkup(tree), /×/)
  tree.props.onClick()
  assert.equal(called, 1)
})

function routeFixture({ authorized = true, character = null, fail = false } = {}) {
  const calls = []
  const units = [{ id: 1, item_key: 'dress' }, { id: 2, item_key: 'dress' }, { id: 3, item_key: 'unknown' }]
  const catalog = [{ id: 'dress', name: 'Dress' }]
  const route = load('app/api/outfits/available/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200, headers: init?.headers }) } },
    '@/lib/outfits': outfits,
    '@/lib/turso': {
      query: async (sql, args) => {
        calls.push({ sql, args })
        assert.match(sql, /^SELECT /)
        if (fail) throw new Error('Synthetic read failure')
        return sql.includes('user_inventory') ? units : catalog
      },
      queryOne: async (sql, args) => { calls.push({ sql, args }); return character },
    },
  })
  const request = suffix => ({ url: `https://example.invalid/api/outfits/available${suffix}`,
    headers: { get: key => authorized && key === 'x-telegram-id-validated' ? 'verified-user' : null } })
  return { route, calls, units, catalog, request }
}

test('global inventory reuses authenticated endpoint, preserves legacy fields and counts all available keys', async () => {
  const f = routeFixture()
  const result = await f.route.GET(f.request('?user_id=forged'))
  assert.equal(result.status, 200)
  assert.equal(f.route.dynamic, 'force-dynamic')
  assert.equal(result.headers['Cache-Control'], 'no-store')
  assert.deepEqual(result.body.inventory_items, f.units)
  assert.deepEqual(result.body.outfit_catalog, f.catalog)
  assert.deepEqual(plain(result.body.inventory_stacks), [{ item_key: 'dress', quantity: 2 }, { item_key: 'unknown', quantity: 1 }])
  assert.deepEqual(plain(result.body.character_owned), [])
  assert.equal(result.body.character_equipped, null)
  assert.deepEqual(plain(f.calls[0].args), ['verified-user'])
  assert.match(f.calls[0].sql, /item_type = 'outfit'/)
  assert.equal(f.calls.length, 2)
})

test('character wardrobe ownership stays separate from consumable copies and is user-scoped', async () => {
  const f = routeFixture({ character: { owned_outfits: '["dress"]', equipped_outfit: 'dress' } })
  const result = await f.route.GET(f.request('?character_id=7'))
  assert.deepEqual(plain(result.body.character_owned), ['dress'])
  assert.equal(result.body.character_equipped, 'dress')
  assert.equal(result.body.inventory_stacks[0].quantity, 2)
  assert.deepEqual(plain(f.calls[2].args), ['7', 'verified-user'])
  assert.match(f.calls[2].sql, /telegram_id = \?/)
})

test('unauthorized requests do not read inventory; read failures are controlled', async () => {
  const f = routeFixture({ authorized: false })
  assert.equal((await f.route.GET(f.request(''))).status, 401)
  assert.equal(f.calls.length, 0)
  const failure = routeFixture({ fail: true })
  assert.equal((await failure.route.GET(failure.request(''))).status, 500)
})

test('UI wiring retains explicit gift vs alternate and a read-only general inventory', () => {
  const chat = readFileSync(path.join(root, 'app/chat/[id]/page.tsx'), 'utf8')
  const gacha = readFileSync(path.join(root, 'app/gacha/page.tsx'), 'utf8')
  assert.match(chat, /groupOutfitInventory\(wardrobeData.inventory\)/)
  assert.match(chat, /owned.includes\(item.item_key\) \? 'alternate' : 'gift'/)
  assert.match(chat, /handleEquipOutfit\(key, 'alternate'\)/)
  assert.doesNotMatch(chat, /backgroundImage:.*getItemImageUrl/)
  assert.match(gacha, /tgFetch\('\/api\/outfits\/available'\)/)
  assert.match(gacha, /⋮ → Armario \/ Regalos/)
  const modal = gacha.slice(gacha.indexOf('{showInventory && ('), gacha.indexOf('<style jsx>'))
  assert.doesNotMatch(modal, /onClick=.*handleEquip|\/api\/outfits\/equip|\/api\/gacha\/spin/)
})