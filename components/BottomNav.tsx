"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { getTranslations, getLanguage, Language } from '@/lib/i18n'

export default function BottomNav() {
  const pathname = usePathname()
  const [lang, setLang] = useState<Language>('es')
  const [hide, setHide] = useState(false)

  useEffect(() => {
    import('@twa-dev/sdk').then((mod) => {
      const WebApp = mod.default
      const tgUser = WebApp.initDataUnsafe?.user
      if (tgUser) setLang(getLanguage(tgUser.language_code))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    // Ocultar en chat individual (ya tiene su propio header)
    setHide(pathname?.startsWith('/chat/') ?? false)
  }, [pathname])

  if (hide) return null

  const t = getTranslations(lang)

  // Solo 3 items: Inicio, Chats, Tienda
  const items = [
    { href: '/', label: t.home, icon: HomeIcon },
    { href: '/chats', label: t.chats, icon: ChatIcon },
    { href: '/shop', label: t.shop, icon: DiamondIcon },
  ]

  return (
    <nav className="bottom-nav">
      <div className="bottom-nav-inner">
        {items.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== '/' && pathname?.startsWith(item.href))
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`bottom-nav-item ${active ? 'active' : ''}`}
            >
              <Icon active={active} />
              <span className="bottom-nav-label">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 10.5L12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V10.5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={active ? 'currentColor' : 'none'}
        fillOpacity={active ? 0.15 : 0}
      />
    </svg>
  )
}

function ChatIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 0 1 3 12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={active ? 'currentColor' : 'none'}
        fillOpacity={active ? 0.15 : 0}
      />
    </svg>
  )
}

function DiamondIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3l3 5h5l-8 13L4 8h5l3-5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        fill={active ? 'currentColor' : 'none'}
        fillOpacity={active ? 0.15 : 0}
      />
    </svg>
  )
}
