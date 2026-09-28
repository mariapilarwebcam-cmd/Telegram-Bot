"use client"

import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { getLanguage, Language } from '@/lib/i18n'
import { setInitDataRaw } from '@/lib/telegram-fetch'

interface UserData {
  telegram_id: string
  first_name: string
  username: string | null
  gems: number
  language: string
  hook_messages_remaining: number
  referral_code: string
  total_referrals: number
  streak_count: number
  longest_streak: number
  last_daily_claim: string | null
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

let memUserCache: UserData | null = null

function getTelegramWebApp(): any {
  if (typeof window === 'undefined') return null
  return (window as any).Telegram?.WebApp || null
}

const USER_SELECT =
  'telegram_id, first_name, username, gems, language, hook_messages_remaining, referral_code, total_referrals, streak_count, longest_streak, last_daily_claim'

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserData | null>(memUserCache)
  const [loading, setLoading] = useState(!memUserCache)
  const [lang, setLang] = useState<Language>('es')
  const [isTelegram, setIsTelegram] = useState(false)
  const [telegramId, setTelegramId] = useState<number | null>(null)
  const referralProcessed = useRef(false)
  const initStarted = useRef(false)

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 8000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (initStarted.current) return
    initStarted.current = true

    const init = async () => {
      try {
        const mod: any = await Promise.race([
          import('@twa-dev/sdk'),
          new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
        ])

        const sdk = mod?.default
        try { sdk?.ready?.() } catch {}
        try { sdk?.expand?.() } catch {}

        let initDataUnsafe = sdk?.initDataUnsafe
        let initDataRaw = sdk?.initData || ''

        if (!initDataUnsafe?.user?.id) {
          const tg = getTelegramWebApp()
          if (tg?.initDataUnsafe?.user?.id) {
            initDataUnsafe = tg.initDataUnsafe
            initDataRaw = tg.initData || initDataRaw
            try { tg.ready?.() } catch {}
            try { tg.expand?.() } catch {}
          }
        }

        if (!initDataUnsafe?.user?.id) {
          await new Promise((r) => setTimeout(r, 500))
          const tg = getTelegramWebApp()
          if (tg?.initDataUnsafe?.user?.id) {
            initDataUnsafe = tg.initDataUnsafe
            initDataRaw = tg.initData || initDataRaw
          }
        }

        const u = initDataUnsafe?.user
        if (!u?.id) {
          console.warn('[UserContext] No Telegram user found after all retries')
          setLoading(false)
          return
        }

        // ✅ Registrar initData para tgFetch
        if (initDataRaw) {
          setInitDataRaw(initDataRaw)
          console.log('[UserContext] initData registrado, length:', initDataRaw.length)
        } else {
          console.warn('[UserContext] No initData raw disponible')
        }

        setIsTelegram(true)
        setTelegramId(u.id)
        setLang(getLanguage(u.language_code))

        await loadUser(u.id, {
          first_name: u.first_name || '',
          username: u.username || null,
          language: getLanguage(u.language_code),
        })

        const startParam = initDataUnsafe?.start_param
        if (startParam && !referralProcessed.current) {
          const processedKey = `taboo_ref_${u.id}_${startParam}`
          try {
            if (!sessionStorage.getItem(processedKey)) {
              sessionStorage.setItem(processedKey, '1')
              // Import dinámico para usar tgFetch
              const { tgFetch } = await import('@/lib/telegram-fetch')
              tgFetch('/api/referral', {
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

  useEffect(() => {
    if (!telegramId) return

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadUser(telegramId)
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleVisibility)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleVisibility)
    }
  }, [telegramId])

  const loadUser = async (
    id: number,
    telegramData?: { first_name: string; username: string | null; language: Language }
  ): Promise<boolean> => {
    const tid = id.toString()
    try {
      const result: any = await Promise.race([
        supabase.from('users').select(USER_SELECT).eq('telegram_id', tid).maybeSingle(),
        new Promise((resolve) => setTimeout(() => resolve({ data: null, error: 'timeout' }), 6000)),
      ])

      if (result?.data) {
        const u = result.data as UserData
        memUserCache = u
        setUser(u)
        return true
      }

      if (telegramData) {
        try {
          const { tgFetch } = await import('@/lib/telegram-fetch')
          const res = await tgFetch('/api/init-user', {
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
