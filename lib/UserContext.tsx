"use client"

import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { getLanguage, Language } from '@/lib/i18n'
import { setInitDataRaw } from '@/lib/telegram-fetch'
import { identifyUser } from '@/lib/posthog'

export interface UserData {
  telegram_id: string
  first_name: string
  username: string | null
  gems: number
  purchased_gems?: number
  bonus_gems?: number
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
  is_vip?: boolean
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
  const [loading, setLoading] = useState(true)
  const [lang, setLang] = useState<Language>('es')
  const [isTelegram, setIsTelegram] = useState(false)
  const [telegramId, setTelegramId] = useState<number | null>(null)
  const referralProcessed = useRef(false)
  const initStarted = useRef(false)
  const router = useRouter()

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

    if (!(ageOk && hasGender && hasInterest && onboardingOk)) {
      router.replace('/onboarding')
    }
  }, [user, loading, router])

  useEffect(() => {
    if (initStarted.current) return
    initStarted.current = true
    let cancelled = false

    const init = async () => {
      try {
        // La API oficial puede tardar en aparecer al iniciar el WebView.
        // No dependemos de un import dinamico que podria expirar antes.
        let tg: any = null
        for (let attempt = 0; attempt < 40 && !cancelled; attempt++) {
          const candidate = getTelegramWebApp()
          if (candidate?.initData && candidate?.initDataUnsafe?.user?.id) {
            tg = candidate
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 250))
        }

        if (cancelled) return
        if (!tg) {
          console.warn('[UserContext] Telegram initData no disponible')
          setLoading(false)
          return
        }

        const initDataRaw: string = tg.initData
        const initDataUnsafe = tg.initDataUnsafe
        const u = initDataUnsafe.user
        if (!initDataRaw || !u?.id) {
          setLoading(false)
          return
        }

        try { tg.ready?.() } catch {}
        try { tg.expand?.() } catch {}

        // El backend verifica la firma HMAC; initDataUnsafe NO es autenticacion.
        setInitDataRaw(initDataRaw)
        setTelegramId(u.id)
        setLang(getLanguage(u.language_code))

        const authenticated = await loadUserWithRetry(u.id, {
          first_name: u.first_name || '',
          username: u.username || null,
          language: getLanguage(u.language_code),
        })
        if (cancelled) return
        if (!authenticated) {
          console.error('[UserContext] No se pudo validar/inicializar usuario')
          setLoading(false)
          return
        }
        setIsTelegram(true)
        setLoading(false)

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
        if (!cancelled) setLoading(false)
      }
    }

    void init()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!telegramId) return

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadUser(telegramId)
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
    console.error('[UserContext] loadUser fallo despues de 3 intentos')
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
