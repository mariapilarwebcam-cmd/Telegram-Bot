import { Metadata, Viewport } from 'next'
import './globals.css'
import BottomNav from '@/components/BottomNav'
import { UserProvider } from '@/lib/UserContext'

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
    <html lang="es">
      <body className="antialiased">
        <UserProvider>
          <div className="app-shell">
            <div className="app-content">{children}</div>
            <BottomNav />
          </div>
        </UserProvider>
      </body>
    </html>
  )
}
