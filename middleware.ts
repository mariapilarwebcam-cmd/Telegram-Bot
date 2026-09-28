// middleware.ts (raíz del proyecto)

import { NextResponse, NextRequest } from 'next/server'
import {
  validateTelegramInitData,
  extractInitData,
} from '@/lib/validate-telegram'

// ── Endpoints exentos de validación ──────────────────────────
// El webhook viene de Telegram (no del cliente), health es diagnóstico público.
const PUBLIC_ENDPOINTS = [
  '/api/health',
  '/api/webhook',
]

// ── Bypass opcional para desarrollo local ────────────────────
// Activa en .env.local: AUTH_BYPASS_DEV=true y DEV_TELEGRAM_ID=<tu_id>
const DEV_BYPASS =
  process.env.AUTH_BYPASS_DEV === 'true' &&
  process.env.NODE_ENV === 'development'
const DEV_TELEGRAM_ID = process.env.DEV_TELEGRAM_ID || '123456789'

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Solo aplica a /api/*
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Endpoints públicos
  if (PUBLIC_ENDPOINTS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // ── Modo dev bypass ──────────────────────────────────────
  if (DEV_BYPASS) {
    const requestHeaders = new Headers(req.headers)
    requestHeaders.set('x-telegram-id-validated', DEV_TELEGRAM_ID)
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  // ── Validación real ──────────────────────────────────────
  try {
    const initData = extractInitData(req)
    const validated = await validateTelegramInitData(initData)

    const requestHeaders = new Headers(req.headers)
    requestHeaders.set('x-telegram-id-validated', String(validated.user.id))
    requestHeaders.set('x-telegram-language', validated.user.language_code || 'en')

    return NextResponse.next({
      request: { headers: requestHeaders },
    })
  } catch (e: any) {
    console.warn('[middleware] Auth failed:', pathname, e.message)
    return NextResponse.json(
      { error: 'No autorizado', detail: e.message },
      { status: 401 }
    )
  }
}

export const config = {
  matcher: '/api/:path*',
}