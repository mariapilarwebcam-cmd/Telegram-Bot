"use client"

import { ReactNode } from 'react'
import dynamic from 'next/dynamic'

// ✅ Forzamos que se cargue SOLO en el navegador, nunca en el servidor
const TonConnectUIProvider = dynamic(
  () => import('@tonconnect/ui-react').then((m) => m.TonConnectUIProvider),
  { ssr: false }
)

export function TonProviderClient({ children }: { children: ReactNode }) {
  return (
    <TonConnectUIProvider
      // ✅ Apuntamos a la nueva API route que crearemos en el paso 3
      manifestUrl="https://telegram-bot-five-beryl.vercel.app/api/tonconnect-manifest"
    >
      {children}
    </TonConnectUIProvider>
  )
}