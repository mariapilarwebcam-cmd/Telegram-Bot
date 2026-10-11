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
//
// También bloquea el gesto nativo de Telegram que cierra la app.
// ═══════════════════════════════════════════════════════════════

const EDGE_ZONE_PX = 50          // Zona activa desde el borde izquierdo
const SWIPE_THRESHOLD_PX = 80    // Distancia mínima para activar
const FLICK_THRESHOLD_PX = 35    // Swipe rápido (flick)
const FLICK_MAX_MS = 300
const MAX_VERTICAL_DRIFT = 80
const MAX_VISUAL_OFFSET = 220

// Rutas donde NO se aplica
const DISABLED_ROUTES = ['/onboarding']

// ✅ Mapa de navegación — determina a dónde va el swipe
function getBackDestination(path: string): string | 'close' {
  if (path === '/' || path === '') return 'close'
  if (path.startsWith('/chat/')) return '/chats'
  if (path === '/chats') return '/'
  if (path.startsWith('/settings')) return '/'
  if (path.startsWith('/shop')) return '/'
  if (path.startsWith('/invite')) return '/'
  if (path.startsWith('/rewards')) return '/'
  // Default: home
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
  // ✅ Manejo del BackButton nativo de Telegram
  //    - En el home: oculto (no hay a dónde volver)
  //    - En páginas interiores: mostrar flecha nativa
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

    const path = window.location.pathname
    if (DISABLED_ROUTES.some((p) => path.startsWith(p))) return

    const reset = () => {
      isActive.current = false
      offsetRef.current = 0
      setDragging(false)
      setOffset(0)
    }

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      if (touch.clientX > EDGE_ZONE_PX) return

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
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!isActive.current) return

      const touch = e.touches[0]
      if (!touch) return

      const dx = touch.clientX - startX.current
      const dy = Math.abs(touch.clientY - startY.current)

      // ✅ CRÍTICO: bloquear el gesto nativo de Telegram
      //    Si el swipe es hacia la derecha y empezó cerca del borde,
      //    bloqueamos el default para que Telegram NO minimice la app.
      if (dx > 5 && dy < MAX_VERTICAL_DRIFT) {
        if (e.cancelable) e.preventDefault()
      }

      // Cancelar si el movimiento es más vertical
      if (dy > MAX_VERTICAL_DRIFT && Math.abs(dx) < dy * 1.2) {
        reset()
        return
      }

      // Solo hacia la derecha
      if (dx < 0) {
        offsetRef.current = 0
        setOffset(0)
        return
      }

      const visual = Math.min(dx, MAX_VISUAL_OFFSET)
      offsetRef.current = visual
      setOffset(visual)
    }

    const handleTouchEnd = () => {
      if (!isActive.current) return

      const elapsed = Date.now() - startTime.current
      const finalOffset = offsetRef.current
      const wasFlick = elapsed < FLICK_MAX_MS && finalOffset > FLICK_THRESHOLD_PX

      reset()

      if (finalOffset > SWIPE_THRESHOLD_PX || wasFlick) {
        const currentPath = window.location.pathname
        const dest = getBackDestination(currentPath)

        if (dest === 'close') {
          try { tg.close() } catch (err) {
            console.warn('[SwipeBack] close failed:', err)
          }
        } else {
          router.push(dest)
        }
      }
    }

    // ✅ passive: false en touchmove para poder usar preventDefault()
    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd, { passive: true })
    document.addEventListener('touchcancel', handleTouchEnd, { passive: true })

    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
      document.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [router])

  if (!dragging) return null

  const progress = Math.min(offset / SWIPE_THRESHOLD_PX, 1)
  const iconOpacity = Math.min(offset / 60, 1)

  return (
    <>
      {/* Tinte lateral que sigue el dedo */}
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

      {/* Indicador circular con flecha */}
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
