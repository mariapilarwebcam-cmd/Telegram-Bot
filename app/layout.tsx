import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AI Roleplay Mini App',
  description: 'Experiencia de chat con personajes de IA',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body className="bg-background text-textMain antialiased">
        {children}
      </body>
    </html>
  )
}