"use client"

import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { getLanguage, Language } from '@/lib/i18n'
import { loadTelegramSdk, getWebApp } from '@/lib/telegram'

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

// Cache en memoria (persiste entre navegaciones durante la sesión)
let memUserCache: UserData | null = null

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserData | null>(memUserCache)
  const [loading, setLoading] = useState(!memUserCache)
  const [lang, setLang] = useState<Language>('es')
  const [isTelegram, setIsTelegram] = useState(false)
  const [telegramId, setTelegramId] = useState<number | null>(null)
  const referralProcessed = useRef(false)
  const initStarted = useRef(false)

  // Hard timeout: si en 5 segundos no hay respuesta, liberar la UI
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 5000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (initStarted.current) return
    initStarted.current = true

    const init = async () => {
      try {
        // Timeout de 2.5s para el SDK de Telegram
        const WebApp: any = await Promise.race([
          loadTelegramSdk(),
          new Promise((resolve) => setTimeout(() => resolve(null), 2500)),
        ])

        if (!WebApp) {
          setLoading(false)
          return
        }

        const u = WebApp.initDataUnsafe?.user
        if (!u?.id) {
          setLoading(false)
          return
        }

        setIsTelegram(true)
        setTelegramId(u.id)
        setLang(getLanguage(u.language_code))

        // Cargar usuario con timeout de 4s
        const loaded = await loadUser(u.id)
        if (!loaded) {
          setLoading(false)
        }

        // Procesar referido en background (NO bloquea)
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
              }).catch(() => {})
              referralProcessed.current = true
            }
          } catch {}
        }
      } catch (e) {
        console.error('Init error:', e)
        setLoading(false)
      }
    }

    init()
  }, [])

  const loadUser = async (id: number): Promise<boolean> => {
    const tid = id.toString()
    try {
      // Query con timeout de 4s
      const result: any = await Promise.race([
        supabase
          .from('users')
          .select('telegram_id, first_name, username, gems, language, hook_messages_remaining, referral_code, total_referrals')
          .eq('telegram_id', tid)
          .maybeSingle(),
        new Promise((resolve) => setTimeout(() => resolve({ data: null }), 4000)),
      ])

      if (result?.data) {
        const u = result.data as UserData
        memUserCache = u
        setUser(u)
        return true
      }
      return false
    } catch (e) {
      console.error('Error cargando usuario:', e)
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
