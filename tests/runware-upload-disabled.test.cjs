// Pruebas sin .env, servicios externos ni archivos de compilación.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const { NextResponse } = require('next/server')

const routePath = path.resolve(
  __dirname, '../app/api/runware/upload-lora/route.ts'
)
const source = readFileSync(routePath, 'utf8')

function loadRoute() {
  const calls = { network: 0, environment: 0 }
  const forbidden = () => {
    calls.network += 1
    throw new Error('External operations are forbidden in this test')
  }
  const environment = new Proxy({}, {
    get() {
      calls.environment += 1
      throw new Error('Environment access is forbidden in this test')
    },
  })
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText
  const exports = {}
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      assert.equal(name, 'next/server', 'Unexpected route dependency')
      return { NextResponse }
    },
    process: { env: environment },
    fetch: forbidden,
    XMLHttpRequest: forbidden,
    WebSocket: forbidden,
  }, { filename: routePath, timeout: 1000 })
  return { handlers: exports, calls }
}

async function assertGone(response) {
  assert.equal(response.status, 410)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.match(response.headers.get('content-type'), /application\/json/)
  assert.deepEqual(await response.json(), { error: 'Endpoint no disponible' })
}

test('GET returns a generic 410 response with no-store', async () => {
  const { handlers, calls } = loadRoute()
  await assertGone(await handlers.GET())
  assert.deepEqual(calls, { network: 0, environment: 0 })
})

test('parameters and synthetic credentials cannot reactivate the endpoint', async () => {
  const { handlers, calls } = loadRoute()
  const requests = [
    new Request('https://example.invalid/api/runware/upload-lora'),
    new Request('https://example.invalid/api/runware/upload-lora?enabled=true&force=1', {
      headers: {
        authorization: 'Bearer synthetic-not-a-real-credential',
        'x-admin-secret': 'synthetic-not-a-real-credential',
        'x-telegram-id-validated': '123456789',
        'x-middleware-subrequest': 'middleware:middleware:middleware',
      },
    }),
  ]
  for (const request of requests) {
    await assertGone(await handlers.GET(request))
  }
  assert.deepEqual(calls, { network: 0, environment: 0 })
})

test('GET does not inspect the request, headers or body', async () => {
  const { handlers, calls } = loadRoute()
  const request = new Proxy({}, {
    get() {
      throw new Error('The disabled route must not inspect the request')
    },
  })
  await assertGone(await handlers.GET(request))
  assert.deepEqual(calls, { network: 0, environment: 0 })
})

test('the module implements only GET, with no operations for other methods', () => {
  const { handlers, calls } = loadRoute()
  assert.deepEqual(Object.keys(handlers), ['GET'])
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    assert.equal(handlers[method], undefined)
  }
  assert.deepEqual(calls, { network: 0, environment: 0 })
})

test('the source contains only the NextResponse import and a static return', () => {
  const file = ts.createSourceFile(
    routePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS
  )
  assert.equal(file.statements.length, 2)
  const [dependency, handler] = file.statements
  assert.ok(ts.isImportDeclaration(dependency))
  assert.equal(dependency.moduleSpecifier.text, 'next/server')
  assert.ok(ts.isFunctionDeclaration(handler))
  assert.equal(handler.name.text, 'GET')
  assert.equal(handler.parameters.length, 0)
  assert.equal(handler.body.statements.length, 1)
  const statement = handler.body.statements[0]
  assert.ok(ts.isReturnStatement(statement))
  assert.ok(ts.isCallExpression(statement.expression))
  assert.equal(statement.expression.expression.getText(file), 'NextResponse.json')
  function assertStatic(node) {
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        assert.ok(
          ts.isPropertyAssignment(property),
          'Only explicit property assignments are allowed'
        )
        assert.ok(
          ts.isIdentifier(property.name)
          || ts.isStringLiteral(property.name)
          || ts.isNumericLiteral(property.name),
          'Computed property names are not allowed'
        )
        assertStatic(property.initializer)
      }
      return
    }

    assert.ok(
      ts.isStringLiteral(node)
      || ts.isNumericLiteral(node)
      || node.kind === ts.SyntaxKind.TrueKeyword
      || node.kind === ts.SyntaxKind.FalseKeyword
      || node.kind === ts.SyntaxKind.NullKeyword,
      'Response values must be static literals'
    )
  }
  statement.expression.arguments.forEach(assertStatic)
})