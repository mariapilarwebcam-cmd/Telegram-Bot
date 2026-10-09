// app/api/health/route.ts

import { NextResponse } from 'next/server'
import { query } from '@/lib/turso'

export const dynamic = 'force-dynamic'

function isAuthorized(request: Request): boolean {
  const secret = process.env.ADMIN_API_SECRET
  if (!secret) {
    return process.env.NODE_ENV !== 'production'
  }

  const headerSecret = request.headers.get('x-admin-secret')
  const url = new URL(request.url)
  const querySecret = url.searchParams.get('x-admin-secret')

  return headerSecret === secret || querySecret === secret
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const result: any = {
    timestamp: new Date().toISOString(),
    env: {
      TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL ? '✅' : '❌',
      TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN ? '✅' : '❌',
      TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ? '✅' : '❌',
      TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET ? '✅' : '❌',
      ADMIN_API_SECRET: process.env.ADMIN_API_SECRET ? '✅' : '❌',
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ? '✅' : '❌',
      DEEPINFRA_TOKEN: process.env.DEEPINFRA_TOKEN ? '✅' : '❌',
      WIRO_API_KEY: process.env.WIRO_API_KEY ? '✅' : '❌',
      NEXT_PUBLIC_R2_PUBLIC_URL: process.env.NEXT_PUBLIC_R2_PUBLIC_URL ? '✅' : '❌',
    },
  }

  try {
    const users = await query<{ telegram_id: string }>(
      'SELECT telegram_id FROM users LIMIT 1'
    )
    result.select_test = { status: 'ok', rowCount: users.length }

    const testId = `test_${Date.now()}`
    try {
      const insertResult = await query<{ id: number }>(
        `INSERT INTO user_characters
          (telegram_id, character_name, gender, archetype, personality, is_active)
         VALUES (?, ?, ?, ?, ?, 0)
         RETURNING id`,
        [testId, 'TEST_DELETE_ME', 'female', 'stepmom', 'test']
      )

      const insertedId = insertResult[0]?.id

      if (insertedId) {
        await query('DELETE FROM user_characters WHERE id = ?', [insertedId])
        result.write_test = { status: 'ok', insertedId, cleaned: true }
      } else {
        result.write_test = { status: 'error', message: 'No id returned' }
      }
    } catch (writeErr: any) {
      result.write_test = {
        status: 'error',
        message: writeErr?.message || String(writeErr),
      }
    }

    const allOk =
      result.select_test?.status === 'ok' &&
      result.write_test?.status === 'ok'

    result.overall = allOk ? 'ok' : 'has_errors'
  } catch (e: any) {
    result.fatal = e?.message || String(e)
    result.overall = 'fatal'
  }

  return NextResponse.json(result, { status: 200 })
}
