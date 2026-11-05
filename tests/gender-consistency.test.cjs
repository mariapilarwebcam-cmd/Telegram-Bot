// Pruebas de coherencia de género en aperturas y prompts.
// Carga lib/constants.ts y lib/gender.ts con transpile + vm. Sin red ni BD.
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFileSync } = require('node:fs')
const { test } = require('node:test')
const ts = require('typescript')
const vm = require('node:vm')

function loadTs(relativePath, mocks = {}) {
  const file = path.resolve(__dirname, '..', relativePath)
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText

  const module = { exports: {} }
  const sandbox = {
    module,
    exports: module.exports,
    console,
    process: { env: {} },
    require: (id) => {
      if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id]
      throw new Error(`require inesperado: ${id}`)
    },
  }
  vm.runInNewContext(
    `(function(require, module, exports){${compiled}\n})`,
    sandbox
  )(sandbox.require, module, module.exports)
  return module.exports
}

const constants = loadTs('lib/constants.ts', { './levels': {} })
const gender = loadTs('lib/gender.ts')

const GENDER_SLASH = /[a-záéíóúñ]+\/[a-záéíóúñ]+/i

test('1. sin barras de género en aperturas, personalidades y niveles', () => {
  const offenders = []
  const scan = (label, value) => {
    if (typeof value === 'string' && GENDER_SLASH.test(value)) {
      offenders.push(`${label} → ${value.slice(0, 70)}`)
    }
  }

  for (const [key, value] of Object.entries(constants.OPENING_LINES)) {
    scan(`OPENING_LINES.${key}.es`, value.es)
    scan(`OPENING_LINES.${key}.en`, value.en)
  }
  for (const [key, value] of Object.entries(constants.PERSONALITIES)) {
    scan(`PERSONALITIES.${key}`, value)
  }
  for (const [key, levels] of Object.entries(constants.LEVEL_PERSONALITIES)) {
    for (const [level, value] of Object.entries(levels)) {
      scan(`LEVEL_PERSONALITIES.${key}.${level}.es`, value.es)
      scan(`LEVEL_PERSONALITIES.${key}.${level}.en`, value.en)
    }
  }

  assert.deepEqual(offenders, [])
})

test('2. la apertura no deja tokens sin resolver', () => {
  const template = constants.OPENING_LINES.psycho.es
  const combos = [
    ['male', 'male'],
    ['male', 'female'],
    ['female', 'male'],
    ['female', 'female'],
    ['male', null],
  ]
  for (const [charGender, userGender] of combos) {
    const out = constants.renderOpeningLine(template, 'Silas', charGender, userGender)
    assert.ok(!/\{(name|co|uo)\}/.test(out), out)
  }
})

test('3. apertura coherente en las cuatro combinaciones usuario/personaje', () => {
  const template = constants.OPENING_LINES.psycho.es
  const cases = [
    ['male', 'male', 'sentado', 'enfadado', 'Eres mío'],
    ['female', 'female', 'sentada', 'enfadada', 'Eres mía'],
    ['male', 'female', 'sentado', 'enfadado', 'Eres mía'],
    ['female', 'male', 'sentada', 'enfadada', 'Eres mío'],
  ]

  for (const [charGender, userGender, seated, angry, possessive] of cases) {
    const out = constants.renderOpeningLine(template, 'X', charGender, userGender)
    assert.ok(out.includes(`está ${seated} `), `${charGender}/${userGender}: ${out}`)
    assert.ok(out.includes(`no estoy ${angry}`), `${charGender}/${userGender}: ${out}`)
    assert.ok(out.includes(possessive), `${charGender}/${userGender}: ${out}`)
    // El posesivo de lo poseído no depende del género del usuario.
    assert.ok(out.includes('lo que es mío, lo cuido'), out)
  }
})

test('4. género desconocido del usuario usa la forma por defecto sin romper', () => {
  const template = constants.OPENING_LINES.psycho.es
  for (const unknown of [null, undefined, 'other']) {
    const out = constants.renderOpeningLine(template, 'X', 'male', unknown)
    assert.ok(out.includes('Eres mío'), out)
    assert.ok(!/\{uo\}/.test(out), out)
  }
})

test('5. contexto romántico correcto en las cuatro combinaciones', () => {
  const expectations = [
    ['male', 'female', /heterosexual/, /Romantic context: straight/],
    ['female', 'male', /heterosexual/, /Romantic context: straight/],
    ['male', 'male', /dos hombres/, /Romantic context: two men/],
    ['female', 'female', /dos mujeres/, /Romantic context: two women/],
  ]

  for (const [userGender, charGender, esPattern, enPattern] of expectations) {
    const es = gender.buildGenderRules(userGender, charGender, 'es')
    const en = gender.buildGenderRules(userGender, charGender, 'en')

    assert.match(es, esPattern)
    assert.match(en, enPattern)

    // Contexto interno: nunca tema recurrente ni etiqueta espontánea.
    assert.match(es, /NO anuncies, expliques, recuerdes ni menciones espontáneamente/)
    assert.match(en, /Do NOT announce, explain, remind or spontaneously mention/)

    // Las reglas gramaticales siguen intactas.
    assert.ok(es.includes('"cansado"') && es.includes('"cansada"'), es)
    assert.ok(en.includes('I/me/my'), en)
  }
})

test('6. concordancia explícita del personaje en ambos idiomas', () => {
  const es = gender.buildGenderRules('female', 'male', 'es')
  assert.ok(es.includes('"cansado"') && es.includes('"cansada"'), es)
  assert.ok(es.includes('soy tuyo') && es.includes('soy tuya'), es)

  const en = gender.buildGenderRules('male', 'female', 'en')
  assert.ok(en.includes('I/me/my'), en)
  assert.ok(en.includes('third person'), en)
})

test('7. usuario sin género definido no recibe suposiciones', () => {
  for (const unknown of [null, undefined, 'other']) {
    const es = gender.buildGenderRules(unknown, 'female', 'es')
    assert.ok(es.includes('sin especificar'), es)
    assert.ok(es.includes('no especificó su género'), es)
    assert.ok(!/heterosexual/i.test(es), es)
    assert.ok(!/Contexto romántico/i.test(es), es)

    const en = gender.buildGenderRules(unknown, 'male', 'en')
    assert.ok(en.includes('unspecified'), en)
    assert.ok(en.includes("didn't specify"), en)
    assert.ok(!/Romantic context/i.test(en), en)
  }
})

test('8. los niveles del personaje no reintroducen barras', () => {
  for (const level of [1, 2, 3, 4, 5]) {
    for (const lang of ['es', 'en']) {
      const text = constants.getLevelPersonality('psycho', level, lang)
      assert.ok(typeof text === 'string' && text.length > 0, `nivel ${level}/${lang}`)
      assert.ok(!GENDER_SLASH.test(text), `nivel ${level}/${lang}: ${text}`)
    }
  }
})

test('9. integración estática en las rutas', () => {
  const startChat = readFileSync(
    path.resolve(__dirname, '../app/api/start-chat/route.ts'),
    'utf8'
  )
  assert.match(startChat, /renderOpeningLine\(/)
  assert.ok(
    !startChat.includes('.replace(/{name}/g, character.character_name)'),
    'start-chat debe delegar la sustitución de nombres y sufijos'
  )

  const chat = readFileSync(
    path.resolve(__dirname, '../app/api/chat/route.ts'),
    'utf8'
  )
  assert.match(chat, /from '@\/lib\/gender'/)
  assert.ok(
    !chat.includes('function buildGenderRules('),
    'la implementación duplicada debe haberse eliminado'
  )
})

