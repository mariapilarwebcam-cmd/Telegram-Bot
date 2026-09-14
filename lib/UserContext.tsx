"use client"

import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { getLanguage, Language } from '@/lib/i18n'

interface UserData {
  telegram_id: string
  first_name: string
  username: string | null
  gems: number
  language: string
  hook_messages_remaining: number
  referral_code: string
  total_referrals: number
}

interface UserContextType {
  user: UserData | null
  loading: boolean
  lang: Language
  isTelegram: boolean
  setGems: (n: number) => void
  setHookRemaining: (n: number) => void
  refresh: () => Promise<void>
}

const UserContext = createContext<UserContextType>({
  user: null,
  loading: true,
  lang: 'es',
  isTelegram: false,
  setGems: () => {},
  setHookRemaining: () => {},
  refresh: async () => {},
})

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserData | null>(null)
  const [loading, setLoading] = useState(true)
  const [lang, setLang] = useState<Language>('es')
  const [isTelegram, setIsTelegram] = useState(false)
  const [telegramId, setTelegramId] = useState<number | null>(null)
  const referralProcessed = useRef(false)

  useEffect(() => {
    import('@twa-dev/sdk')
      .then(async (mod) => {
        const WebApp = mod.default
        WebApp.ready()
        WebApp.expand()
        const u = WebApp.initDataUnsafe?.user
        if (!u?.id) {
          setLoading(false)
          return
        }

        setIsTelegram(true)
        setTelegramId(u.id)
        setLang(getLanguage(u.language_code))

        try {
          const cached = sessionStorage.getItem(`taboo_user_${u.id}`)
          if (cached) {
            const parsed = JSON.parse(cached)
            setUser(parsed)
            setLoading(false)
          }
        } catch {}

        await loadUser(u.id)

        const startParam = WebApp.initDataUnsafe?.start_param
        if (startParam && !referralProcessed.current) {
          const processedKey = `taboo_ref_processed_${u.id}_${startParam}`
          if (!sessionStorage.getItem(processedKey)) {
            referralProcessed.current = true
            sessionStorage.setItem(processedKey, '1')
            try {
              await fetch('/api/referral', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  new_user_id: u.id,
                  referral_code: startParam,
                }),
              })
            } catch (e) {
              console.error('Error procesando referido:', e)
            }
          }
        }
      })
      .catch(() => setLoading(false))
  }, [])

  const loadUser = async (id: number) => {
    const tid = id.toString()
    try {
      const { data } = await supabase
        .from('users')
        .select('telegram_id, first_name, username, gems, language, hook_messages_remaining, referral_code, total_referrals')
        .eq('telegram_id', tid)
        .maybeSingle()

      if (data) {
        setUser(data as UserData)
        try {
          sessionStorage.setItem(`taboo_user_${id}`, JSON.stringify(data))
        } catch {}
      }
    } catch (e) {
      console.error('Error cargando usuario:', e)
    } finally {
      setLoading(false)
    }
  }

  const refresh = async () => {
    if (telegramId) await loadUser(telegramId)
  }

  const setGems = (n: number) => {
    setUser((prev) => {
      if (!prev) return prev
      const next = { ...prev, gems: n }
      try {
        sessionStorage.setItem(`taboo_user_${telegramId}`, JSON.stringify(next))
      } catch {}
      return next
    })
  }

  const setHookRemaining = (n: number) => {
    setUser((prev) => {
      if (!prev) return prev
      const next = { ...prev, hook_messages_remaining: n }
      try {
        sessionStorage.setItem(`taboo_user_${telegramId}`, JSON.stringify(next))
      } catch {}
      return next
    })
  }

  return (
    <UserContext.Provider
      value={{ user, loading, lang, isTelegram, setGems, setHookRemaining, refresh }}
    >
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  return useContext(UserContext)
}
