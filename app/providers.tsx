"use client"

import { ReactNode } from 'react'
import { TonConnectUIProvider } from '@tonconnect/ui-react'

export function TonConnectProvider({ children }: { children: ReactNode }) {
  return (
    <TonConnectUIProvider
      manifestUrl="https://telegram-bot-five-beryl.vercel.app/tonconnect-manifest.json"
    >
      {children}
    </TonConnectUIProvider>
  )
}