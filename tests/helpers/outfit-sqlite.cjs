// Test-only SQLite adapter. Uses a single in-memory connection, never lib/turso or .env.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const sqlite = require('node:sqlite')
const Database = sqlite.Database || sqlite.DatabaseSync

function open(filename) {
  assert.equal(filename, ':memory:', 'Only in-memory fixtures are permitted')
  assert.equal(typeof Database, 'function', 'This test requires the Node SQLite API')
  const native = new Database(filename)
  native.exec('PRAGMA foreign_keys=ON')
  const trace = []
  let statements = 0
  let transactions = 0

  async function execute(input) {
    const sql = typeof input === 'string' ? input : input.sql
    const args = typeof input === 'string' ? [] : input.args || []
    trace.push({ sql, args })
    const stmt = native.prepare(sql)
    statements++
    try {
      if (stmt.columns().length) return { rows: stmt.all(...args).map(row => ({ ...row })) }
      const result = stmt.run(...args)
      return { rows: [], rowsAffected: result.changes, lastInsertRowid: result.lastInsertRowid }
    } finally {
      try { if (typeof stmt.close === 'function') stmt.close() } finally { statements-- }
    }
  }

  return {
    execute, trace, native,
    async transaction(mode) {
      assert.equal(transactions, 0, 'Unexpected nested transaction')
      native.exec(mode === 'write' ? 'BEGIN IMMEDIATE' : 'BEGIN')
      transactions++
      return {
        execute,
        async commit() { native.exec('COMMIT'); transactions-- },
        async rollback() { native.exec('ROLLBACK'); transactions-- },
        close() {
          if (native.isTransaction) { native.exec('ROLLBACK'); transactions-- }
        },
      }
    },
    close() {
      try {
        assert.equal(statements, 0, 'Statement leak')
        assert.equal(transactions, 0, 'Transaction leak')
        assert.equal(native.isTransaction, false)
      } finally { native.close() }
    },
  }
}

function initialize(db) {
  // DDL only. The production checkGiftSchema gate remains enabled and validates
  // these definitions against its reviewed hashes in every focused fixture.
  db.native.exec(readFileSync(path.join(__dirname, '../fixtures/outfit-legacy-schema.sql'), 'utf8'))
  db.native.exec(readFileSync(path.join(__dirname, '../../migrations/007_inventory_gift_ledger.sql'), 'utf8'))
  db.native.exec(`INSERT INTO users (telegram_id,first_name) VALUES ('u','Alex'),('other','Other');
    INSERT INTO user_characters (id,telegram_id,character_name,gender,archetype)
    VALUES (1,'u','Luna','female','model'),(2,'u','Sol','male','actor'),(3,'other','Other','male','actor');`)
}

module.exports = { open, initialize }