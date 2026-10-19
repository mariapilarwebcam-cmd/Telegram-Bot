"use client"

import { ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { TonPayProvider } from '@ton-pay/ui-react'

const TonConnectUIProvider = dynamic(
  () => import('@tonconnect/ui-react').then((m) => m.TonConnectUIProvider),
  { ssr: false }
)

export function TonProviderClient({ children }: { children: ReactNode }) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://telegram-bot-five-beryl.vercel.app'

  return (
    <TonConnectUIProvider manifestUrl={`${appUrl}/api/tonconnect-manifest`}>
      <TonPayProvider>
        {children}
      </TonPayProvider>
    </TonConnectUIProvider>
  )
}
