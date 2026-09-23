// app/api/debug/route.ts

import { NextResponse } from 'next/server'

export async function GET() {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_KEY: !!process.env.SUPABASE_KEY,
    TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
    OPENROUTER_API_KEY: !!process.env.OPENROUTER_API_KEY,
    DEEPINFRA_TOKEN: !!process.env.DEEPINFRA_TOKEN,
    WIRO_API_KEY: !!process.env.WIRO_API_KEY,
    NEXT_PUBLIC_R2_PUBLIC_URL: process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '❌ MISSING',
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || '❌ MISSING',
    MINI_APP_URL: process.env.MINI_APP_URL || '❌ MISSING',
    WEBHOOK_URL: process.env.WEBHOOK_URL || '❌ MISSING',
  }

  const critical = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_R2_PUBLIC_URL',
    'WIRO_API_KEY',
    'TELEGRAM_BOT_TOKEN',
    'OPENROUTER_API_KEY',
    'DEEPINFRA_TOKEN',
  ]

  const missing: string[] = []
  for (const key of critical) {
    if (!process.env[key]) missing.push(key)
  }

  return NextResponse.json({
    status: missing.length === 0 ? 'ok' : 'missing_vars',
    missing,
    env,
  })
}