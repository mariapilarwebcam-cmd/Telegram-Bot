// app/api/health/route.ts

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const result: any = {
    timestamp: new Date().toISOString(),
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL
        ? `✅ ${process.env.NEXT_PUBLIC_SUPABASE_URL.substring(0, 30)}...`
        : '❌ MISSING',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
        ? `✅ len=${process.env.SUPABASE_SERVICE_ROLE_KEY.length} start=${process.env.SUPABASE_SERVICE_ROLE_KEY.substring(0, 12)}...`
        : '❌ MISSING',
      NEXT_PUBLIC_R2_PUBLIC_URL: process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '❌ MISSING',
    },
  }

  try {
    // Test 1: SELECT
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('telegram_id')
      .limit(1)

    if (error) {
      result.select_test = {
        status: 'error',
        message: error.message,
        code: error.code,
        hint: error.hint,
      }
    } else {
      result.select_test = { status: 'ok', rowCount: data?.length ?? 0 }
    }

    // Test 2: INSERT + DELETE en user_characters
    const testId = `test_${Date.now()}`
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('user_characters')
      .insert({
        telegram_id: testId,
        character_name: 'TEST_DELETE_ME',
        gender: 'female',
        archetype: 'stepmom',
        personality: 'test',
        is_active: false,
      })
      .select('id')
      .single()

    if (insertError) {
      result.write_test = {
        status: 'error',
        message: insertError.message,
        code: insertError.code,
        hint: insertError.hint,
      }
    } else {
      result.write_test = { status: 'ok', insertedId: inserted?.id }
      if (inserted?.id) {
        await supabaseAdmin.from('user_characters').delete().eq('id', inserted.id)
        result.write_test.cleaned = true
      }
    }

    const allOk =
      result.select_test?.status === 'ok' && result.write_test?.status === 'ok'
    result.overall = allOk ? 'ok' : 'has_errors'
  } catch (e: any) {
    result.fatal = e?.message || String(e)
    result.overall = 'fatal'
  }

  return NextResponse.json(result, { status: 200 })
}