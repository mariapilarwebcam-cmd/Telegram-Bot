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

// ── Catálogo real: 72 personajes sobre 62 arquetipos (10 compartidos) ──
const FEMALE_KEYS = Object.keys(constants.CHARACTER_NAMES_FEMALE)
const MALE_KEYS = Object.keys(constants.CHARACTER_NAMES_MALE)
const DUAL_KEYS = FEMALE_KEYS.filter((k) => MALE_KEYS.includes(k)).sort()
const ALL_ARCHETYPES = Array.from(new Set([...FEMALE_KEYS, ...MALE_KEYS])).sort()

// Formas de concordancia que, en un arquetipo COMPARTIDO, solo pueden referirse al
// personaje (postura/estado). Si aparecen sin token {co}, el texto fija su género.
const GRADED_STEMS = [
  'sentad', 'parado', 'apoyad', 'inclinad', 'arrodillad', 'recostad', 'cansad',
  'dispuest', 'sonrojad', 'enfadad', 'vestid', 'desnud', 'avergonzad',
  'entregad', 'rendid', 'emocionad',
]

function stripTokens(text) {
  return text.replace(/\{(name|co|uo)\}/g, '')
}

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

test('10. catálogo: 72 personajes sobre 62 arquetipos con cobertura completa', () => {
  assert.equal(FEMALE_KEYS.length, 36, 'personajes femeninos')
  assert.equal(MALE_KEYS.length, 36, 'personajes masculinos')
  assert.equal(FEMALE_KEYS.length + MALE_KEYS.length, 72, 'personajes totales')
  assert.deepEqual(DUAL_KEYS, [
    'actor', 'boss', 'chef', 'doctor', 'musician',
    'neighbor', 'psycho', 'schoolmate', 'teacher', 'trainer',
  ], 'arquetipos compartidos por ambos géneros')
  assert.equal(ALL_ARCHETYPES.length, 62, 'arquetipos únicos')
  assert.deepEqual(Object.keys(constants.OPENING_LINES).sort(), ALL_ARCHETYPES)
  assert.deepEqual(Object.keys(constants.PERSONALITIES).sort(), ALL_ARCHETYPES)
})

test('11. las 62 aperturas renderizan sin tokens ni barras en ambos idiomas', () => {
  const combos = [
    ['female', 'female'],
    ['female', 'male'],
    ['male', 'female'],
    ['male', 'male'],
    ['male', null],
  ]

  for (const archetype of ALL_ARCHETYPES) {
    for (const lang of ['es', 'en']) {
      const template = constants.OPENING_LINES[archetype][lang]
      for (const [charGender, userGender] of combos) {
        const out = constants.renderOpeningLine(template, 'Nombre', charGender, userGender)
        const label = `${archetype}.${lang} (${charGender}/${userGender})`
        assert.ok(out.includes('Nombre'), `nombre sin sustituir: ${label}`)
        assert.ok(!/\{(name|co|uo)\}/.test(out), `token sin resolver: ${label} → ${out}`)
        assert.ok(!GENDER_SLASH.test(stripTokens(out)), `barra de género: ${label} → ${out}`)
      }
    }
  }
})

test('12. el género del usuario solo altera sufijos -o/-a en las aperturas', () => {
  for (const archetype of ALL_ARCHETYPES) {
    for (const lang of ['es', 'en']) {
      const template = constants.OPENING_LINES[archetype][lang]
      for (const charGender of ['female', 'male']) {
        const asMale = constants.renderOpeningLine(template, 'N', charGender, 'male')
        const asFemale = constants.renderOpeningLine(template, 'N', charGender, 'female')
        assert.equal(asMale.length, asFemale.length, `${archetype}.${lang}: longitudes distintas`)
        for (let i = 0; i < asMale.length; i += 1) {
          if (asMale[i] === asFemale[i]) continue
          assert.equal(asMale[i], 'o', `${archetype}.${lang}: cambio ajeno a {uo} → ${asMale}`)
          assert.equal(asFemale[i], 'a', `${archetype}.${lang}: cambio ajeno a {uo} → ${asFemale}`)
        }
      }
    }
  }
})

test('13. las 10 aperturas compartidas no fijan el género del personaje', () => {
  // Alcance acotado a los arquetipos cuyo personaje puede ser hombre o mujer:
  // ninguno de estos textos menciona terceros, así que un pronombre o un
  // participio sin token {co} sería siempre concordancia del personaje.
  const enPronouns = /\b(he|him|his|she|her|hers)\b/i

  for (const archetype of DUAL_KEYS) {
    const { es, en } = constants.OPENING_LINES[archetype]
    assert.ok(!enPronouns.test(en), `${archetype}.en fija el género del personaje: ${en}`)

    const clean = stripTokens(es)
    for (const stem of GRADED_STEMS) {
      assert.ok(
        !new RegExp(`\\b${stem}(o|a)\\b`).test(clean),
        `${archetype}.es usa "${stem}-" siendo arquetipo compartido: ${clean}`
      )
    }

    // "a solas" es invariante; "estamos solos/solas" o "juntos/juntas" no lo son.
    const withoutIdiom = clean.replace(/\ba solas\b/g, '')
    assert.ok(
      !/\b(solos|solas|juntos|juntas)\b/.test(withoutIdiom),
      `${archetype}.es concuerda el plural con el usuario: ${clean}`
    )
  }
})

test('14. regresión: las personalidades ya no llaman "él" al usuario', () => {
  // Comprobaciones específicas de las frases confirmadas, sin prohibir pronombres
  // en general (pueden referirse a otros personajes).
  const expectations = [
    ['cyborg_assassin', 'a ti o a él'],
    ['best_friends_gf', 'a solas con él'],
    ['best_friends_sister', 'enamorada de él'],
    ['best_friends_sister', 'cerca de él'],
    ['best_friends_sister', 'están solos'],
    ['foot_fetish_girl', 'cómo él'],
    ['best_friends_bf', 'si él cae'],
    ['best_friends_brother', 'fascinación por él'],
  ]

  for (const [archetype, wrong] of expectations) {
    const text = constants.PERSONALITIES[archetype]
    assert.ok(typeof text === 'string' && text.length > 0, archetype)
    assert.ok(!text.includes(wrong), `${archetype}: conserva "${wrong}" → ${text}`)
    assert.ok(text.includes('usuario'), `${archetype}: debe usar "el usuario" → ${text}`)
  }
  assert.ok(
    constants.PERSONALITIES.best_friends_sister.includes('están a solas'),
    constants.PERSONALITIES.best_friends_sister
  )
})

test('15. los 72 personajes renderizan su apertura desde sus 62 arquetipos', () => {
  const characters = [
    ...Object.entries(constants.CHARACTER_NAMES_FEMALE).map(([a, n]) => [a, n, 'female']),
    ...Object.entries(constants.CHARACTER_NAMES_MALE).map(([a, n]) => [a, n, 'male']),
  ]
  assert.equal(characters.length, 72)

  for (const [archetype, name, charGender] of characters) {
    for (const userGender of ['female', 'male']) {
      const out = constants.renderOpeningLine(
        constants.OPENING_LINES[archetype].es,
        name,
        charGender,
        userGender
      )
      assert.ok(out.includes(name), `${archetype}/${name}: nombre sin sustituir → ${out}`)
      assert.ok(!/\{(name|co|uo)\}/.test(out), `${archetype}/${name}: token sin resolver → ${out}`)
    }
  }
})

test('16. {co} sigue al personaje y {uo} al usuario en cualquier arquetipo', () => {
  const template = '*{name}: {co} {uo}*'
  assert.equal(constants.renderOpeningLine(template, 'A', 'female', 'male'), '*A: a o*')
  assert.equal(constants.renderOpeningLine(template, 'A', 'male', 'female'), '*A: o a*')
  assert.equal(constants.renderOpeningLine(template, 'A', 'male', null), '*A: o o*')
  assert.equal(constants.renderOpeningLine(template, 'A', 'female', 'other'), '*A: a o*')

  // psycho es el único arquetipo compartido que necesita ambos tokens.
  const psycho = constants.renderOpeningLine(
    constants.OPENING_LINES.psycho.es,
    'Evelyn',
    'female',
    'male'
  )
  assert.ok(psycho.includes('sentada') && psycho.includes('enfadada'), psycho)
  assert.ok(psycho.includes('Eres mío'), psycho)
})

test('17. regresión: la concordancia dirigida al usuario usa {uo}', () => {
  const render = (archetype, charGender = 'female', userGender = 'female') =>
    constants.renderOpeningLine(constants.OPENING_LINES[archetype].es, 'X', charGender, userGender)

  assert.ok(render('maid').includes('Bienvenida a casa'), render('maid'))
  assert.ok(render('knight', 'male').includes('dispuesta a escucharlo'), render('knight', 'male'))
  assert.ok(render('oni_male', 'male').includes('muy tonta'), render('oni_male', 'male'))
  assert.ok(render('kitsune').includes('veo que tienes curiosidad'), render('kitsune'))
  assert.ok(render('doctor').includes('estamos a solas'), render('doctor'))
  assert.ok(render('nun_fantasy').includes('Reza conmigo'), render('nun_fantasy'))
  assert.ok(!render('nun_fantasy').includes('juntos'), render('nun_fantasy'))

  // Con usuario masculino se mantiene la forma en -o.
  assert.ok(render('maid', 'female', 'male').includes('Bienvenido a casa'))
  assert.ok(render('knight', 'male', 'male').includes('dispuesto a escucharlo'))
  assert.ok(render('oni_male', 'male', 'male').includes('muy tonto'))
  assert.ok(render('kitsune', 'female', 'male').includes('veo que tienes curiosidad'))
})

test('18. las reglas globales piden no llamar "usuario" a la persona', () => {
  const ruleEs = "Las expresiones 'el usuario', 'la usuaria', 'user' y similares son referencias internas"
  const ruleEn = "Expressions such as 'the user', 'user', and similar terms are internal references"
  const count = (text, needle) => text.split(needle).length - 1

  const scenarios = [
    ['female', 'female'],
    ['female', 'male'],
    ['male', 'female'],
    ['male', 'male'],
    [null, 'female'],
    ['female', null],
  ]

  for (const [userGender, charGender] of scenarios) {
    const es = gender.buildGenderRules(userGender, charGender, 'es')
    const en = gender.buildGenderRules(userGender, charGender, 'en')

    assert.equal(count(es, ruleEs), 1, `regla ES ausente o duplicada (${userGender}/${charGender})`)
    assert.equal(count(en, ruleEn), 1, `regla EN ausente o duplicada (${userGender}/${charGender})`)
    assert.ok(es.includes('Háblale directamente en segunda persona'), es)
    assert.ok(en.includes('Speak directly to them in the second person'), en)
    assert.ok(!es.includes(ruleEn), 'la regla inglesa no debe mezclarse en el prompt ES')
    assert.ok(!en.includes(ruleEs), 'la regla española no debe mezclarse en el prompt EN')
  }
})

test('19. los prompts de escena no concuerdan con el usuario', () => {
  const ai = readFileSync(path.resolve(__dirname, '../lib/ai.ts'), 'utf8')

  assert.ok(!ai.includes('recuperándose juntos'), 'plural concordado con el usuario')
  assert.ok(!ai.includes('para él/ella'), 'barra de género en el prompt de escena')

  // Las dos apariciones (nivel normal y nivel 5) usan la forma neutra.
  const neutral = ai.match(/Respiración calmándose lentamente, al unísono/g) || []
  assert.equal(neutral.length, 2, 'se esperaban dos apariciones neutras')
  assert.ok(
    ai.includes('Confiesa que esto ya no es solo un juego'),
    'la confesión debe ser neutra'
  )
})

