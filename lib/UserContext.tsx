"use client"

import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { getLanguage, Language } from '@/lib/i18n'
import { setInitDataRaw } from '@/lib/telegram-fetch'
import { identifyUser } from '@/lib/posthog'                    // ✅ PostHog

export interface UserData {
  telegram_id: string
  first_name: string
  username: string | null
  gems: number
  purchased_gems?: number
  language: string
  hook_messages_remaining: number
  hook_used?: boolean
  referral_code: string
  total_referrals: number
  paying_referrals_count?: number
  streak_count: number
  longest_streak: number
  last_daily_claim: string | null
  age_verified?: boolean
  gender?: string | null
  interested_in?: string | null
  onboarding_complete?: boolean
}

interface UserContextType {
  user: UserData | null
  loading: boolean
  lang: Language
  isTelegram: boolean
  setGems: (n: number) => void
  setHookRemaining: (n: number) => void
  setUser: (u: UserData) => void
  refresh: () => Promise<void>
}

const UserContext = createContext<UserContextType>({
  user: null,
  loading: true,
  lang: 'es',
  isTelegram: false,
  setGems: () => {},
  setHookRemaining: () => {},
  setUser: () => {},
  refresh: async () => {},
})

let memUserCache: UserData | null = null

function getTelegramWebApp(): any {
  if (typeof window === 'undefined') return null
  return (window as any).Telegram?.WebApp || null
}

const ONBOARDING_WHITELIST = ['/onboarding']

function isTrue(v: any): boolean {
  return v === true || v === 1 || v === '1'
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<UserData | null>(memUserCache)
  const [loading, setLoading] = useState(!memUserCache)
  const [lang, setLang] = useState<Language>('es')
  const [isTelegram, setIsTelegram] = useState(false)
  const [telegramId, setTelegramId] = useState<number | null>(null)
  const referralProcessed = useRef(false)
  const initStarted = useRef(false)
  const router = useRouter()

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 8000)
    return () => clearTimeout(t)
  }, [])

  // Gate de onboarding
  useEffect(() => {
    if (loading || !user) return
    if (typeof window === 'undefined') return

    const path = window.location.pathname
    if (ONBOARDING_WHITELIST.some((p) => path.startsWith(p))) return

    const ageOk = isTrue(user.age_verified)
    const hasGender = !!user.gender
    const hasInterest = !!user.interested_in
    const onboardingOk = isTrue(user.onboarding_complete)

    const isComplete = ageOk && hasGender && hasInterest && onboardingOk

    if (!isComplete) {
      console.log('[UserContext] onboarding incompleto → /onboarding', {
        ageOk,
        hasGender,
        hasInterest,
        onboardingOk,
      })
      router.replace('/onboarding')
    }
  }, [user, loading, router])

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

        if (initDataRaw) {
          setInitDataRaw(initDataRaw)
          console.log('[UserContext] initData registrado, length:', initDataRaw.length)
        } else {
          console.warn('[UserContext] No initData raw disponible')
        }

        setIsTelegram(true)
        setTelegramId(u.id)
        setLang(getLanguage(u.language_code))

        await loadUserWithRetry(u.id, {
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
              const { tgFetch } = await import('@/lib/telegram-fetch')
              tgFetch('/api/referral', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ referral_code: startParam }),
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

  const loadUserWithRetry = async (
    id: number,
    telegramData?: { first_name: string; username: string | null; language: Language }
  ): Promise<boolean> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const ok = await loadUser(id, telegramData)
      if (ok) return true
      await new Promise((r) => setTimeout(r, 500 + attempt * 1000))
    }
    console.error('[UserContext] loadUser falló después de 3 intentos')
    return false
  }

  const loadUser = async (
    id: number,
    telegramData?: { first_name: string; username: string | null; language: Language }
  ): Promise<boolean> => {
    try {
      const { tgFetch } = await import('@/lib/telegram-fetch')

      try {
        const res = await tgFetch('/api/me')
        if (res.ok) {
          const data = await res.json()
          if (data?.user) {
            const u = data.user as UserData
            memUserCache = u
            setUserState(u)

            // ✅ PostHog: identificar al usuario
            identifyUser(u.telegram_id, {
              language: u.language,
              gender: u.gender || 'unknown',
              interested_in: u.interested_in || 'unknown',
              is_vip: (u as any).is_vip || false,
            })

            return true
          }
        } else {
          console.warn('[UserContext] /api/me HTTP', res.status)
        }
      } catch (e) {
        console.warn('[UserContext] /api/me error:', e)
      }

      try {
        const res = await tgFetch('/api/init-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            first_name: telegramData?.first_name || '',
            username: telegramData?.username || null,
            language: telegramData?.language || 'es',
          }),
        })

        if (!res.ok) {
          console.warn('[UserContext] init-user HTTP', res.status)
          return false
        }

        const initData = await res.json()
        if (initData?.user) {
          const u = initData.user as UserData
          memUserCache = u
          setUserState(u)

          // ✅ PostHog: identificar al usuario
          identifyUser(u.telegram_id, {
            language: u.language,
            gender: u.gender || 'unknown',
            interested_in: u.interested_in || 'unknown',
            is_vip: (u as any).is_vip || false,
          })

          return true
        }
      } catch (e) {
        console.error('[UserContext] init-user error:', e)
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
    setUserState((prev) => {
      if (!prev) return prev
      const next = { ...prev, gems: n }
      memUserCache = next
      return next
    })
  }

  const setHookRemaining = (n: number) => {
    setUserState((prev) => {
      if (!prev) return prev
      const next = { ...prev, hook_messages_remaining: n }
      memUserCache = next
      return next
    })
  }

  const setUser = (u: UserData) => {
    memUserCache = u
    setUserState(u)
  }

  return (
    <UserContext.Provider
      value={{
        user,
        loading,
        lang,
        isTelegram,
        setGems,
        setHookRemaining,
        setUser,
        refresh,
      }}
    >
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  return useContext(UserContext)
}
