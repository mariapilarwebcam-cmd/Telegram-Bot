"use client"

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { PERSONALITIES } from '@/lib/constants'
import { getTranslations, getLanguage, Language } from '@/lib/i18n'
import Link from 'next/link'

interface Character {
  id: number
  character_name: string
  archetype: string
  gender: string
  is_active: boolean
  personality: string
}

export default function Home() {
  const [user, setUser] = useState<any>(null)
  const [activeCharacter, setActiveCharacter] = useState<Character | null>(null)
  const [gems, setGems] = useState(0)
  const [hookRemaining, setHookRemaining] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tgUser, setTgUser] = useState<any>(null)
  const [lang, setLang] = useState<Language>('es')
  const [isTelegram, setIsTelegram] = useState(false)
  const [referralProcessed, setReferralProcessed] = useState(false)

  useEffect(() => {
    import('@twa-dev/sdk').then(async (mod) => {
      const WebApp = mod.default
      WebApp.ready()
      WebApp.expand()

      setIsTelegram(true)

      const u = WebApp.initDataUnsafe?.user
      setTgUser(u)

      const detectedLang = getLanguage(u?.language_code)
      setLang(detectedLang)

      const startParam = WebApp.initDataUnsafe?.start_param

      if (u && u.id) {
        await loadUserData(u.id, detectedLang, startParam)
      } else {
        setLoading(false)
        setError('No se pudo cargar tu usuario')
      }
    }).catch((err) => {
      console.error('Error cargando Telegram SDK:', err)
      setLoading(false)
      setError('Error al cargar Telegram')
    })
  }, [])

  const loadUserData = async (telegramId: number, language: Language, startParam?: string) => {
    const tid = telegramId.toString()
    try {
      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', tid)
        .maybeSingle()

      if (userData) {
        setUser(userData)
        setGems(userData.gems || 0)
        setHookRemaining(userData.hook_messages_remaining || 0)

        const { data: activeChar } = await supabase
          .from('user_characters')
          .select('*')
          .eq('telegram_id', tid)
          .eq('is_active', true)
          .maybeSingle()

        if (activeChar) setActiveCharacter(activeChar)
      } else {
        const referralCode = Math.random().toString(36).substring(2, 10).toUpperCase()
        const newUser = {
          telegram_id: tid,
          username: tgUser?.username || '',
          first_name: tgUser?.first_name || '',
          language: language,
          gems: 10,
          referral_code: referralCode,
          hook_messages_remaining: 0
        }

        const { data: created, error: createErr } = await supabase
          .from('users')
          .insert(newUser)
          .select()
          .single()

        if (createErr) throw createErr

        setUser(created)
        setGems(10)

        if (startParam && !referralProcessed) {
          setReferralProcessed(true)
          await fetch('/api/referral', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              new_user_id: tid,
              referral_code: startParam
            })
          }).catch(() => {})
        }
      }
    } catch (e: any) {
      console.error('Error:', e)
      setError('Error al cargar datos')
    } finally {
      setLoading(false)
    }
  }

  const claimDaily = async () => {
    if (!user) return
    try {
      const res = await fetch('/api/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegram_id: user.telegram_id })
      })
      const data = await res.json()
      if (res.ok) {
        setGems(data.gems)
        setHookRemaining(0)
        alert(`+${data.claimed} 💎 (base ${data.base} + bonus ${data.bonus})`)
      } else {
        alert(data.error || t.errorGeneric)
      }
    } catch {
      alert(t.errorConnection)
    }
  }

  const t = getTranslations(lang)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-textMuted">{t.loading}</p>
        </div>
      </div>
    )
  }

  if (error && isTelegram) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="text-center py-12">
          <div className="text-6xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold mb-4 text-white">{error}</h1>
          <button
            onClick={() => window.location.reload()}
            className="bg-gradient-primary text-white px-6 py-3 rounded-xl font-bold"
          >
            {t.back}
          </button>
        </div>
      </div>
    )
  }

  if (!isTelegram) {
    return (
      <div className="flex items-center justify-center h-screen bg-background p-4">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold mb-4 text-white">
            {t.openFromTelegram}
          </h1>
          <p className="text-textMuted mb-6">
            {t.openFromTelegramDesc}
          </p>
          <a
            href="https://t.me/TabooRealmBot"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-gradient-primary text-white px-8 py-4 rounded-xl font-bold text-lg"
          >
            🤖 Abrir TabooRealmBot
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-20">
      <header className="flex justify-between items-center mb-6 sticky top-0 bg-background/95 backdrop-blur z-10 py-4">
        <div>
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-primary">
            Taboo Realm
          </h1>
          <p className="text-sm text-textMuted">
            {t.welcome}, {user?.first_name || 'User'} 👋
          </p>
        </div>
        <div className="flex items-center gap-2 bg-surface px-4 py-2 rounded-full border border-white/10">
          <span className="text-primary">💎</span>
          <span className="font-bold">{gems || 0}</span>
        </div>
      </header>

      {hookRemaining > 0 && (
        <div className="mb-4 bg-gradient-to-r from-primary/30 to-secondary/30 p-3 rounded-xl border border-primary/40">
          <p className="text-sm font-bold text-white">
            ✨ {hookRemaining} {t.specialMoments}
          </p>
        </div>
      )}

      {/* Personaje activo */}
      {activeCharacter ? (
        <section className="mb-8">
          <div className="bg-gradient-to-br from-primary/20 to-primary/5 p-6 rounded-2xl border border-primary/30">
            <h2 className="text-lg font-bold mb-2 text-white">{t.activeCharacter}</h2>
            <div className="flex items-center gap-4">
              <div className="text-5xl">
                {activeCharacter.gender === 'male' ? '👨' : '👩'}
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">{activeCharacter.character_name}</h3>
                <p className="text-sm text-textMuted line-clamp-2">
                  {PERSONALITIES[activeCharacter.archetype]}
                </p>
              </div>
            </div>
            <Link
              href={`/chat/${activeCharacter.id}`}
              className="mt-4 inline-block bg-gradient-primary text-white px-6 py-3 rounded-xl font-bold"
            >
              {t.continueChat}
            </Link>
          </div>
        </section>
      ) : (
        <section className="mb-8">
          <div className="bg-surface p-6 rounded-2xl border border-white/10 text-center">
            <div className="text-6xl mb-4">🎭</div>
            <h2 className="text-xl font-bold mb-2 text-white">{t.selectCharacter}</h2>
            <p className="text-textMuted mb-4">{t.selectCharacterDesc}</p>
            <Link
              href="/characters"
              className="inline-block bg-gradient-primary text-white px-8 py-4 rounded-xl font-bold text-lg"
            >
              {t.viewCharacters}
            </Link>
          </div>
        </section>
      )}

      {/* Acciones rápidas */}
      <section className="grid grid-cols-2 gap-4">
        <Link
          href="/characters"
          className="group bg-gradient-to-br from-surface to-surfaceHighlight p-6 rounded-2xl border border-white/10 hover:border-primary/50 transition-all hover:scale-105"
        >
          <div className="text-4xl mb-3">🎭</div>
          <h3 className="font-bold mb-1 text-white">{t.characters}</h3>
          <p className="text-xs text-textMuted">{t.explore}</p>
        </Link>

        <Link
          href="/shop"
          className="group bg-gradient-to-br from-surface to-surfaceHighlight p-6 rounded-2xl border border-white/10 hover:border-primary/50 transition-all hover:scale-105"
        >
          <div className="text-4xl mb-3">🛒</div>
          <h3 className="font-bold mb-1 text-white">{t.shop}</h3>
          <p className="text-xs text-textMuted">{t.buyGems}</p>
        </Link>
      </section>

      {/* Daily */}
      <section className="mt-6 bg-surface p-4 rounded-2xl border border-white/10">
        <h3 className="font-bold mb-2 text-white">{t.dailyReward}</h3>
        <p className="text-xs text-textMuted mb-3">
          {t.dailyRewardDesc}
        </p>
        <button
          onClick={claimDaily}
          className="w-full bg-gradient-primary text-white py-3 rounded-xl font-bold"
        >
          {t.claimDaily}
        </button>
      </section>

      {/* Referidos */}
      {user?.referral_code && (
        <section className="mt-4 bg-surface p-4 rounded-2xl border border-white/10">
          <h3 className="font-bold mb-2 text-white">{t.inviteFriends}</h3>
          <div className="flex gap-2">
            <input
              readOnly
              value={`https://t.me/TabooRealmBot?startapp=${user.referral_code}`}
              className="flex-1 bg-background border border-white/10 rounded-xl px-3 py-2 text-xs text-textMain"
            />
            <button
              onClick={() => {
                navigator.clipboard.writeText(`https://t.me/TabooRealmBot?startapp=${user.referral_code}`)
                alert(t.copied)
              }}
              className="bg-gradient-primary text-white px-4 py-2 rounded-xl text-sm font-bold"
            >
              {t.copy}
            </button>
          </div>
          <p className="text-xs text-textMuted mt-2">
            {t.inviteDesc}
          </p>
        </section>
      )}

      {/* Info */}
      <section className="mt-6 bg-gradient-to-br from-surface/50 to-surfaceHighlight/50 p-6 rounded-2xl border border-white/10">
        <h3 className="font-bold mb-3 text-white">{t.howItWorks}</h3>
        <ul className="text-sm text-textMuted space-y-2">
          <li>• {t.chatCost}</li>
          <li>• {t.imageCost}</li>
          <li>• {t.audioCost}</li>
          <li>• {t.createCharCost}</li>
        </ul>
      </section>
    </div>
  )
}
