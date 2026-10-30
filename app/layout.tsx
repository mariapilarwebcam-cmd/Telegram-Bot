import { Metadata, Viewport } from 'next'
import Script from 'next/script'
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
      <head>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      </head>
      <body className="antialiased">
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
