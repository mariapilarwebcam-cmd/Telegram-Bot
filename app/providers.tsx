"use client"

import { ReactNode, useEffect } from 'react'
import { usePathname } from 'next/navigation'
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
