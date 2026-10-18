"use client"

import { ReactNode, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { TonConnectUIProvider } from '@tonconnect/ui-react'
import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { initPostHog, capturePageView } from '@/lib/posthog'

// ═══════════════════════════════════════════════════════════════
// PageView tracker — captura cada cambio de ruta
// ═══════════════════════════════════════════════════════════════
function PageViewTracker() {
  const pathname = usePathname()

  useEffect(() => {
    if (pathname) capturePageView()
  }, [pathname])

  return null
}

// ═══════════════════════════════════════════════════════════════
// PostHog Provider
// ═══════════════════════════════════════════════════════════════
export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    initPostHog()
  }, [])

  return (
    <PHProvider client={posthog}>
      <PageViewTracker />
      {children}
    </PHProvider>
  )
}

// ═══════════════════════════════════════════════════════════════
// TON Connect Provider (corregido)
// ═══════════════════════════════════════════════════════════════
export function TonConnectProvider({ children }: { children: ReactNode }) {
  return (
    <TonConnectUIProvider
      manifestUrl="https://telegram-bot-five-beryl.vercel.app/tonconnect-manifest.json"
      // ✅ 'restoreConnection' sí es válido en las props del proveedor
      restoreConnection={false} 
    >
      {children}
    </TonConnectUIProvider>
  )
}
