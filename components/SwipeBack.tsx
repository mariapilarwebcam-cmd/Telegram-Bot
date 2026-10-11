"use client"

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// ═══════════════════════════════════════════════════════════════
// ✅ Swipe-back nativo estilo iOS/Android
// - Detecta el gesto desde el borde izquierdo de la pantalla
// - Si hay historial → retrocede (router.back())
// - Si estamos en la raíz → cierra la Mini App
// - Se desactiva si el gesto empieza en input/textarea
// - Se desactiva si el movimiento es más vertical que horizontal
// ═══════════════════════════════════════════════════════════════

const EDGE_ZONE_PX = 40          // Zona activa desde el borde izquierdo
const SWIPE_THRESHOLD_PX = 90    // Distancia mínima para activar el back
const FLICK_THRESHOLD_PX = 40    // Swipe rápido (flick)
const FLICK_MAX_MS = 300         // Duración máxima de un flick
const MAX_VERTICAL_DRIFT = 60    // Movimiento vertical máximo permitido
const MAX_VISUAL_OFFSET = 200    // Máximo desplazamiento visual

// Rutas donde NO se aplica el gesto (críticas o con UX específica)
const DISABLED_ROUTES = ['/onboarding']

export default function SwipeBack() {
  const router = useRouter()
  const [dragging, setDragging] = useState(false)
  const [offset, setOffset] = useState(0)

  const startX = useRef(0)
  const startY = useRef(0)
  const startTime = useRef(0)
  const isActive = useRef(false)
  const offsetRef = useRef(0)

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Solo en Telegram Mini App
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

      // Ignorar si empieza fuera del borde izquierdo
      if (touch.clientX > EDGE_ZONE_PX) return

      // Ignorar si empieza en un input/textarea (para no bloquear escribir)
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

      // Cancelar si el movimiento es más vertical que horizontal
      // (así no interfiere con scroll)
      if (dy > MAX_VERTICAL_DRIFT && Math.abs(dx) < dy * 1.2) {
        reset()
        return
      }

      // Solo hacia la derecha (swipe-back)
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
        const isRoot = currentPath === '/'

        if (isRoot) {
          // En el home → cierra la Mini App
          try {
            tg.close()
          } catch (err) {
            console.warn('[SwipeBack] close failed:', err)
          }
        } else {
          // En cualquier otra página → retrocede
          router.back()
        }
      }
    }

    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchmove', handleTouchMove, { passive: true })
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
            stroke="#f0afc"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ stroke: '#f0abfc' }}
          />
        </svg>
      </div>
    </>
  )
}