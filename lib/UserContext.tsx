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

// Cache en memoria (persiste durante la sesión)
let memUserCache: UserData | null = null

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserData | null>(memUserCache)
  const [loading, setLoading] = useState(!memUserCache)
  const [lang, setLang] = useState<Language>('es')
  const [isTelegram, setIsTelegram] = useState(false)
  const [telegramId, setTelegramId] = useState<number | null>(null)
  const referralProcessed = useRef(false)
  const initStarted = useRef(false)

  // Hard timeout: libera loading en 6s máximo
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 6000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (initStarted.current) return
    initStarted.current = true

    const init = async () => {
      try {
        // SDK con timeout de 3s
        const mod: any = await Promise.race([
          import('@twa-dev/sdk'),
          new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
        ])

        if (!mod) {
          console.warn('[UserContext] SDK timeout')
          setLoading(false)
          return
        }

        const WebApp = mod.default
        try { WebApp.ready() } catch {}
        try { WebApp.expand() } catch {}

        const u = WebApp.initDataUnsafe?.user
        if (!u?.id) {
          console.warn('[UserContext] No Telegram user')
          setLoading(false)
          return
        }

        setIsTelegram(true)
        setTelegramId(u.id)
        setLang(getLanguage(u.language_code))

        // Cargar usuario (con auto-create si no existe)
        await loadUser(u.id, {
          first_name: u.first_name || '',
          username: u.username || null,
          language: getLanguage(u.language_code),
        })

        // Procesar referido en background
        const startParam = WebApp.initDataUnsafe?.start_param
        if (startParam && !referralProcessed.current) {
          const processedKey = `taboo_ref_${u.id}_${startParam}`
          try {
            if (!sessionStorage.getItem(processedKey)) {
              sessionStorage.setItem(processedKey, '1')
              fetch('/api/referral', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  new_user_id: u.id,
                  referral_code: startParam,
                }),
              }).catch((err) => console.warn('[UserContext] referral err:', err))
              referralProcessed.current = true
            }
          } catch {}
        }
      } catch (e) {
        console.error('[UserContext] init error:', e)
        setLoading(false)
      }
    }

    init()
  }, [])

  const loadUser = async (
    id: number,
    telegramData?: { first_name: string; username: string | null; language: Language }
  ): Promise<boolean> => {
    const tid = id.toString()
    try {
      // Query con timeout de 5s
      const result: any = await Promise.race([
        supabase
          .from('users')
          .select('telegram_id, first_name, username, gems, language, hook_messages_remaining, referral_code, total_referrals')
          .eq('telegram_id', tid)
          .maybeSingle(),
        new Promise((resolve) => setTimeout(() => resolve({ data: null, error: 'timeout' }), 5000)),
      ])

      if (result?.data) {
        const u = result.data as UserData
        memUserCache = u
        setUser(u)
        return true
      }

      // No existe → intentar crear via API
      if (telegramData) {
        console.log('[UserContext] User not found, creating...')
        try {
          const res = await fetch('/api/init-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              telegram_id: tid,
              first_name: telegramData.first_name,
              username: telegramData.username,
              language: telegramData.language,
            }),
          })
          const initData = await res.json()
          if (initData?.user) {
            const u = initData.user as UserData
            memUserCache = u
            setUser(u)
            console.log('[UserContext] User created:', initData.created)
            return true
          }
        } catch (e) {
          console.error('[UserContext] init-user error:', e)
        }
      }

      return false
    } catch (e) {
      console.error('[UserContext] loadUser error:', e)
      return false
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
      memUserCache = next
      return next
    })
  }

  const setHookRemaining = (n: number) => {
    setUser((prev) => {
      if (!prev) return prev
      const next = { ...prev, hook_messages_remaining: n }
      memUserCache = next
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
