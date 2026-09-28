// middleware.ts (raíz del proyecto)

import { NextResponse, NextRequest } from 'next/server'
import { Ratelimit } from '@upstash/ratelimit'
// ✅ Import Edge-compatible (usa solo fetch, no Node APIs)
import { Redis } from '@upstash/redis/cloudflare'

import {
  validateTelegramInitData,
  extractInitData,
} from '@/lib/validate-telegram'

// ── Upstash Redis client ─────────────────────────────────────
let redis: Redis | null = null
let ratelimiters: {
  chat: Ratelimit
  image: Ratelimit
  audio: Ratelimit
  auth: Ratelimit
  generic: Ratelimit
} | null = null

try {
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()

  if (upstashUrl && upstashToken) {
    // ✅ Constructor explícito — lee las env vars en runtime (no en build)
    redis = new Redis({
      url: upstashUrl,
      token: upstashToken,
    })

    ratelimiters = {
      chat: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(60, '1 m'),
        prefix: 'rl:chat',
        analytics: false,
      }),
      image: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(5, '1 m'),
        prefix: 'rl:image',
        analytics: false,
      }),
      audio: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(10, '1 m'),
        prefix: 'rl:audio',
        analytics: false,
      }),
      auth: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(20, '1 m'),
        prefix: 'rl:auth',
        analytics: false,
      }),
      generic: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(150, '1 m'),
        prefix: 'rl:generic',
        analytics: false,
      }),
    }

    console.log('[middleware] ✅ Upstash Redis inicializado correctamente')
  } else {
    console.warn(
      '[middleware] ⚠️ Upstash no configurado — rate limiting deshabilitado. ' +
      `URL: ${upstashUrl ? 'OK' : 'MISSING'}, TOKEN: ${upstashToken ? 'OK' : 'MISSING'}`
    )
  }
} catch (e: any) {
  console.error('[middleware] ❌ Error inicializando Upstash:', e?.message)
}

// ── Endpoints públicos ───────────────────────────────────────
const PUBLIC_ENDPOINTS = [
  '/api/health',
  '/api/webhook',
  '/api/bot',
  '/api/bot/',
]

// ── Dev bypass ───────────────────────────────────────────────
const DEV_BYPASS =
  process.env.AUTH_BYPASS_DEV === 'true' &&
  process.env.NODE_ENV === 'development'
const DEV_TELEGRAM_ID = process.env.DEV_TELEGRAM_ID || '123456789'

// ── Helpers ──────────────────────────────────────────────────
function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    '127.0.0.1'
  )
}

function pickLimiter(pathname: string): Ratelimit | null {
  if (!ratelimiters) return null
  if (pathname.startsWith('/api/chat')) return ratelimiters.chat
  if (pathname.startsWith('/api/generate-image')) return ratelimiters.image
  if (pathname.startsWith('/api/generate-audio')) return ratelimiters.audio
  if (pathname.startsWith('/api/init-user')) return ratelimiters.auth
  if (pathname.startsWith('/api/referral')) return ratelimiters.auth
  if (pathname.startsWith('/api/')) return ratelimiters.generic
  return null
}

// ── Middleware principal ─────────────────────────────────────
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (!pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  if (PUBLIC_ENDPOINTS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // ══════════ RATE LIMITING ══════════
  const ip = getClientIp(req)
  const limiter = pickLimiter(pathname)

  if (limiter) {
    try {
      const { success, limit, remaining, reset } = await limiter.limit(ip)

      if (!success) {
        const retryAfter = Math.ceil((reset - Date.now()) / 1000)
        console.warn('[middleware] rate limit blocked', { pathname, ip, retryAfter })

        return NextResponse.json(
          {
            error: 'Demasiadas solicitudes. Espera un momento e intenta de nuevo.',
            retry_after: retryAfter,
          },
          {
            status: 429,
            headers: {
              'X-RateLimit-Limit': String(limit),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(reset),
              'Retry-After': String(retryAfter),
            },
          }
        )
      }
    } catch (e: any) {
      console.error('[middleware] rate limit error (fail-open):', e?.message)
    }
  }

  // ══════════ AUTH ══════════
  if (DEV_BYPASS) {
    const requestHeaders = new Headers(req.headers)
    requestHeaders.set('x-telegram-id-validated', DEV_TELEGRAM_ID)
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  try {
    const initData = extractInitData(req)
    const validated = await validateTelegramInitData(initData)

    const requestHeaders = new Headers(req.headers)
    requestHeaders.set('x-telegram-id-validated', String(validated.user.id))
    requestHeaders.set(
      'x-telegram-language',
      validated.user.language_code || 'en'
    )

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
