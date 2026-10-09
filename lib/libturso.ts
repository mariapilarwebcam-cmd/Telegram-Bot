// lib/turso.ts
// Cliente Turso (libSQL) compartido por todos los API routes

import { createClient, type Client } from '@libsql/client'

const tursoUrl = process.env.TURSO_DATABASE_URL?.trim()
const tursoToken = process.env.TURSO_AUTH_TOKEN?.trim()

if (!tursoUrl) {
  throw new Error('❌ FATAL: Falta TURSO_DATABASE_URL')
}
if (!tursoToken) {
  throw new Error('❌ FATAL: Falta TURSO_AUTH_TOKEN')
}

export const db: Client = createClient({
  url: tursoUrl,
  authToken: tursoToken,
  intMode: 'number',
})

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

/**
 * SELECT → array de objetos tipados.
 */
export async function query<T = any>(
  sql: string,
  args: any[] = []
): Promise<T[]> {
  const result = await db.execute({ sql, args: args as any })
  return result.rows as unknown as T[]
}

/**
 * SELECT → primera fila o null.
 */
export async function queryOne<T = any>(
  sql: string,
  args: any[] = []
): Promise<T | null> {
  const rows = await query<T>(sql, args)
  return rows[0] ?? null
}

/**
 * INSERT / UPDATE / DELETE → info sobre filas afectadas.
 */
export async function execute(
  sql: string,
  args: any[] = []
): Promise<{ rowsAffected: number; lastInsertRowid: number | bigint }> {
  const result = await db.execute({ sql, args: args as any })
  return {
    rowsAffected: result.rowsAffected,
    lastInsertRowid: result.lastInsertRowid ?? 0,
  }
}

/**
 * Batch atómico (transacción).
 */
export async function transaction(
  statements: Array<{ sql: string; args?: any[] }>
) {
  return db.batch(
    statements.map((s) => ({ sql: s.sql, args: (s.args || []) as any })),
    'write'
  )
}

/**
 * Convierte un TEXT ISO o NULL a Date | null.
 */
export function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Convierte 0/1 → boolean (SQLite no tiene booleans nativos).
 */
export function parseBool(v: any): boolean {
  return v === 1 || v === true || v === '1'
}