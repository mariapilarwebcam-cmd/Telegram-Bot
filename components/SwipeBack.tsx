"use client"

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'

// ═══════════════════════════════════════════════════════════════
// ✅ Swipe-back estilo iOS/Android con navegación determinista
//
// REGLA DE NAVEGACIÓN (no depende del historial):
//   /chat/*     → /chats
//   /chats      → /
//   /settings   → /
//   /shop       → /
//   /invite     → /
//   /           → cerrar Mini App
// ═══════════════════════════════════════════════════════════════

const EDGE_ZONE_PX = 50
const SWIPE_THRESHOLD_PX = 80
const FLICK_THRESHOLD_PX = 35
const FLICK_MAX_MS = 300
const MAX_VERTICAL_DRIFT = 80
const MAX_VISUAL_OFFSET = 220

const DISABLED_ROUTES = ['/onboarding']

function getBackDestination(path: string): string | 'close' {
  if (path === '/' || path === '') return 'close'
  if (path.startsWith('/chat/')) return '/chats'
  if (path === '/chats') return '/'
  if (path.startsWith('/settings')) return '/'
  if (path.startsWith('/shop')) return '/'
  if (path.startsWith('/invite')) return '/'
  if (path.startsWith('/rewards')) return '/'
  return '/'
}

export default function SwipeBack() {
  const router = useRouter()
  const pathname = usePathname()
  const [dragging, setDragging] = useState(false)
  const [offset, setOffset] = useState(0)

  const startX = useRef(0)
  const startY = useRef(0)
  const startTime = useRef(0)
  const isActive = useRef(false)
  const offsetRef = useRef(0)

  // ═══════════════════════════════════════════════════════════════
  // BackButton nativo de Telegram
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (typeof window === 'undefined') return
    const tg = (window as any).Telegram?.WebApp
    if (!tg?.BackButton) return

    const dest = getBackDestination(pathname || '/')

    if (dest === 'close') {
      try { tg.BackButton.hide() } catch {}
      return
    }

    try {
      tg.BackButton.show()
      const handler = () => {
        try {
          if (dest === 'close') {
            tg.close()
          } else {
            router.push(dest)
          }
        } catch {}
      }
      tg.BackButton.onClick(handler)
      return () => {
        try { tg.BackButton.offClick(handler) } catch {}
      }
    } catch {}
  }, [pathname, router])

  // ═══════════════════════════════════════════════════════════════
  // ✅ Gesture handling
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (typeof window === 'undefined') return

    const tg = (window as any).Telegram?.WebApp
    if (!tg) return

    let moveHandler: ((e: TouchEvent) => void) | null = null
    let endHandler: ((e: TouchEvent) => void) | null = null

    const cleanupActiveHandlers = () => {
      if (moveHandler) {
        document.removeEventListener('touchmove', moveHandler)
        moveHandler = null
      }
      if (endHandler) {
        document.removeEventListener('touchend', endHandler)
        document.removeEventListener('touchcancel', endHandler)
        endHandler = null
      }
    }

    const reset = () => {
      isActive.current = false
      offsetRef.current = 0
      setDragging(false)
      setOffset(0)
      cleanupActiveHandlers()
    }

    const handleTouchStart = (e: TouchEvent) => {
      // ✅ FIX CRÍTICO: Evaluamos la ruta en el momento exacto del toque
      const currentPath = window.location.pathname
      if (DISABLED_ROUTES.some((p) => currentPath.startsWith(p))) return

      const touch = e.touches[0]
      if (!touch) return

      // Ignorar si empieza fuera del borde izquierdo
      if (touch.clientX > EDGE_ZONE_PX) return

      // Ignorar si empieza en input/textarea
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      startX.current = touch.clientX
      startY.current = touch.clientY
      startTime.current = Date.now()
      offsetRef.current = 0
      isActive.current = true
      setDragging(true)
      setOffset(0)

      moveHandler = (ev: TouchEvent) => {
        if (!isActive.current) return

        const t = ev.touches[0]
        if (!t) return

        const dx = t.clientX - startX.current
        const dy = Math.abs(t.clientY - startY.current)

        if (dx > 5 && dy < MAX_VERTICAL_DRIFT) {
          if (ev.cancelable) ev.preventDefault()
        }

        if (dy > MAX_VERTICAL_DRIFT && Math.abs(dx) < dy * 1.2) {
          reset()
          return
        }

        if (dx < 0) {
          offsetRef.current = 0
          setOffset(0)
          return
        }

        const visual = Math.min(dx, MAX_VISUAL_OFFSET)
        offsetRef.current = visual
        setOffset(visual)
      }

      endHandler = () => {
        if (!isActive.current) {
          reset()
          return
        }

        const elapsed = Date.now() - startTime.current
        const finalOffset = offsetRef.current
        const wasFlick = elapsed < FLICK_MAX_MS && finalOffset > FLICK_THRESHOLD_PX

        reset()

        if (finalOffset > SWIPE_THRESHOLD_PX || wasFlick) {
          const currentDest = getBackDestination(window.location.pathname)

          if (currentDest === 'close') {
            try {
              tg.close()
            } catch (err) {
              console.warn('[SwipeBack] close failed:', err)
            }
          } else {
            router.push(currentDest)
          }
        }
      }

      document.addEventListener('touchmove', moveHandler, { passive: false })
      document.addEventListener('touchend', endHandler, { passive: true })
      document.addEventListener('touchcancel', endHandler, { passive: true })
    }

    document.addEventListener('touchstart', handleTouchStart, { passive: true })

    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      cleanupActiveHandlers()
    }
  }, [router])

  if (!dragging) return null

  const progress = Math.min(offset / SWIPE_THRESHOLD_PX, 1)
  const iconOpacity = Math.min(offset / 60, 1)

  return (
    <>
      <div
        aria-hidden
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          width: offset,
          background:
            'linear-gradient(90deg, rgba(168,85,247,0.22) 0%, rgba(236,72,153,0.12) 50%, transparent 100%)',
          pointerEvents: 'none',
          zIndex: 9998,
          willChange: 'width',
        }}
      />

      <div
        aria-hidden
        style={{
          position: 'fixed',
          left: Math.min(offset - 22, 44),
          top: '50%',
          transform: `translateY(-50%) scale(${0.85 + progress * 0.25})`,
          width: 44,
          height: 44,
          borderRadius: '50%',
          background:
            progress >= 1
              ? 'linear-gradient(135deg, #a855f7, #ec4899)'
              : 'rgba(168,85,247,0.35)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(240,171,252,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          zIndex: 9999,
          opacity: iconOpacity,
          boxShadow:
            progress >= 1
              ? '0 0 24px rgba(236,72,153,0.8)'
              : '0 0 12px rgba(168,85,247,0.4)',
          transition: 'background 0.15s ease, box-shadow 0.15s ease',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path
            d="m15 18-6-6 6-6"
            stroke="#f0abfc"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </>
  )
}
