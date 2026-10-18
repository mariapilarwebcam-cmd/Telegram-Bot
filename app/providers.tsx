"use client"

import { ReactNode, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { TonConnectUIProvider } from '@tonconnect/ui-react'
import { TonPayProvider } from '@ton-pay/ui-react' // ✅ NUEVO: Importamos el provider
import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { initPostHog, capturePageView } from '@/lib/posthog'

function PageViewTracker() {
  const pathname = usePathname()
  useEffect(() => {
    if (pathname) capturePageView()
  }, [pathname])
  return null
}

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

export function TonConnectProvider({ children }: { children: ReactNode }) {
  return (
    <TonConnectUIProvider
      manifestUrl="https://telegram-bot-five-beryl.vercel.app/tonconnect-manifest.json"
    >
      {/* ✅ NUEVO: TonPayProvider va DENTRO de TonConnectUIProvider */}
      <TonPayProvider>
        {children}
      </TonPayProvider>
    </TonConnectUIProvider>
  )
}
