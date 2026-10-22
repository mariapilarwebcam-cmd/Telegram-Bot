import { Metadata, Viewport } from 'next'
import Script from 'next/script' // ✅ IMPORTACIÓN AÑADIDA
import './globals.css'
import BottomNav from '@/components/BottomNav'
import SwipeBack from '@/components/SwipeBack'
import { UserProvider } from '@/lib/UserContext'
import { PostHogProvider } from './providers'
import { TonProviderClient } from './TonProviderClient'

export const metadata: Metadata = {
  title: 'Taboo Realm',
  description: 'Experiencia de chat con personajes de IA',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0a0a0f',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="antialiased">
        {/* ✅ ERUDA: Consola de desarrollo en pantalla para móviles */}
        <Script 
          src="https://cdn.jsdelivr.net/npm/eruda" 
          strategy="beforeInteractive"
        />
        <Script id="eruda-init" strategy="afterInteractive">
          {`if (typeof window !== 'undefined' && !window.Eruda) { window.eruda.init(); }`}
        </Script>

        <PostHogProvider>
          <UserProvider>
            <TonProviderClient>
              <SwipeBack />
              <div className="app-shell">
                <div className="app-content">{children}</div>
                <BottomNav />
              </div>
            </TonProviderClient>
          </UserProvider>
        </PostHogProvider>
      </body>
    </html>
  )
}
