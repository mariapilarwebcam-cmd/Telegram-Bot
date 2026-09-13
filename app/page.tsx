"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  ARCHETYPES_MALE,
  ARCHETYPES_FEMALE,
  CHARACTER_NAMES_MALE,
  CHARACTER_NAMES_FEMALE,
  PERSONALITIES
} from '@/lib/constants'
import { getTranslations, getLanguage, Language } from '@/lib/i18n'

interface Char {
  archetype: string
  name: string
  role: string
  gender: 'male' | 'female'
  personality: string
  gradient: string
}

const GRADIENTS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  'linear-gradient(135deg, #ff9a9e 0%, #fad0c4 100%)',
  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
  'linear-gradient(135deg, #ff6a88 0%, #ff99ac 100%)',
  'linear-gradient(135deg, #5ee7df 0%, #b490ca 100%)',
  'linear-gradient(135deg, #c79081 0%, #dfa579 100%)',
  'linear-gradient(135deg, #8e2de2 0%, #4a00e0 100%)',
]

function getGradient(key: string): string {
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length]
}

export default function HomePage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [gems, setGems] = useState(0)
  const [hookRemaining, setHookRemaining] = useState(0)
  const [loading, setLoading] = useState(true)
  const [lang, setLang] = useState<Language>('es')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'all' | 'male' | 'female'>('all')
  const [activeChar, setActiveChar] = useState<any>(null)
  const [isTelegram, setIsTelegram] = useState(false)

  useEffect(() => {
    import('@twa-dev/sdk').then(async (mod) => {
      const WebApp = mod.default
      WebApp.ready()
      WebApp.expand()
      setIsTelegram(true)
      const u = WebApp.initDataUnsafe?.user
      const detectedLang = getLanguage(u?.language_code)
      setLang(detectedLang)
      if (u?.id) await loadUser(u.id, detectedLang)
      else setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const loadUser = async (telegramId: number, language: Language) => {
    const tid = telegramId.toString()
    try {
      const { data } = await supabase.from('users').select('*').eq('telegram_id', tid).maybeSingle()
      if (data) {
        setUser(data)
        setGems(data.gems || 0)
        setHookRemaining(data.hook_messages_remaining || 0)
        const { data: ac } = await supabase
          .from('user_characters')
          .select('*')
          .eq('telegram_id', tid)
          .eq('is_active', true)
          .maybeSingle()
        if (ac) setActiveChar(ac)
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const t = getTranslations(lang)

  const all: Char[] = []
  const maleMap = ARCHETYPES_MALE[lang] as Record<string, string>
  const femaleMap = ARCHETYPES_FEMALE[lang] as Record<string, string>

  Object.entries(maleMap).forEach(([k, role]) => {
    all.push({
      archetype: k,
      name: CHARACTER_NAMES_MALE[k] || role,
      role,
      gender: 'male',
      personality: PERSONALITIES[k] || '',
      gradient: getGradient('m_' + k)
    })
  })
  Object.entries(femaleMap).forEach(([k, role]) => {
    all.push({
      archetype: k,
      name: CHARACTER_NAMES_FEMALE[k] || role,
      role,
      gender: 'female',
      personality: PERSONALITIES[k] || '',
      gradient: getGradient('f_' + k)
    })
  })

  const filtered = all
    .filter(c => tab === 'all' ? true : c.gender === tab)
    .filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.role.toLowerCase().includes(search.toLowerCase()))

  const featured = filtered.slice(0, 8)

  const openCharacter = (c: Char) => {
    router.push(`/characters?archetype=${c.archetype}&gender=${c.gender}`)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-[#7c5cff] border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!isTelegram) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#7c5cff] to-[#a855f7]" />
          <h1 className="text-xl font-semibold mb-2">{t.openFromTelegram}</h1>
          <p className="text-sm text-[#8b8b9e] mb-6">{t.openFromTelegramDesc}</p>
          <a href="https://t.me/TabooRealmBot" className="inline-block bg-gradient-to-r from-[#7c5cff] to-[#a855f7] text-white px-6 py-3 rounded-xl font-medium">
            Abrir en Telegram
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-20 bg-[#0a0a0f]/95 backdrop-blur px-4 py-3 border-b border-white/5">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold tracking-tight">
            Taboo<span className="text-[#a78bfa]">Realm</span>
          </h1>
          <div className="flex items-center gap-1.5 bg-white/5 px-3 py-1.5 rounded-full border border-white/5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 3l3 5h5l-8 13L4 8h5l3-5z" fill="#a78bfa" />
            </svg>
            <span className="text-sm font-semibold">{gems}</span>
          </div>
        </div>

        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="7" stroke="#6b6b7e" strokeWidth="2" />
            <path d="m20 20-3.5-3.5" stroke="#6b6b7e" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.search}
            className="w-full bg-white/5 border border-white/5 rounded-xl pl-9 pr-3 py-2.5 text-sm outline-none focus:border-[#7c5cff]/50"
          />
        </div>
      </header>

      {hookRemaining > 0 && (
        <div className="mx-4 mt-3 px-4 py-3 rounded-xl bg-gradient-to-r from-[#7c5cff]/20 to-[#a855f7]/20 border border-[#7c5cff]/30">
          <p className="text-xs font-medium text-[#c4b5fd]">
            {hookRemaining} {t.specialMoments}
          </p>
        </div>
      )}

      {activeChar && (
        <section className="px-4 mt-4">
          <button
            onClick={() => router.push(`/chat/${activeChar.id}`)}
            className="w-full flex items-center gap-3 p-3 rounded-2xl bg-gradient-to-r from-[#7c5cff]/15 to-[#a855f7]/10 border border-[#7c5cff]/30 text-left"
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg"
              style={{ background: getGradient(activeChar.archetype) }}
            >
              {activeChar.character_name?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-[#a78bfa] font-semibold">
                {t.activeCharacter}
              </p>
              <p className="font-semibold truncate">{activeChar.character_name}</p>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="m9 6 6 6-6 6" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </section>
      )}

      <section className="px-4 mt-5">
        <div className="flex gap-2">
          {[
            { id: 'all', label: t.all },
            { id: 'female', label: t.female },
            { id: 'male', label: t.male },
          ].map((x) => (
            <button
              key={x.id}
              onClick={() => setTab(x.id as any)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                tab === x.id
                  ? 'bg-gradient-to-r from-[#7c5cff] to-[#a855f7] text-white'
                  : 'bg-white/5 text-[#8b8b9e] border border-white/5'
              }`}
            >
              {x.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <div className="flex items-center justify-between px-4 mb-3">
          <h2 className="text-base font-semibold">{t.featured}</h2>
        </div>
        <div className="scroll-x flex gap-3 px-4">
          {featured.map((c) => (
            <button
              key={`f_${c.gender}_${c.archetype}`}
              onClick={() => openCharacter(c)}
              className="shrink-0 w-[140px] text-left"
            >
              <div
                className="w-[140px] h-[200px] rounded-2xl relative overflow-hidden"
                style={{ background: c.gradient }}
              >
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
                <div className="absolute top-2 left-2 bg-white/15 backdrop-blur text-[9px] font-semibold px-2 py-0.5 rounded-full text-white/90 uppercase tracking-wide">
                  {t.newCharacters}
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-3">
                  <p className="text-white font-bold text-base leading-tight truncate">
                    {c.name}
                  </p>
                  <p className="text-white/70 text-[11px] truncate mt-0.5">
                    {c.role}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-6 px-4">
        <h2 className="text-base font-semibold mb-3">{t.characters}</h2>
        <div className="grid grid-cols-2 gap-3">
          {filtered.map((c) => (
            <button
              key={`g_${c.gender}_${c.archetype}`}
              onClick={() => openCharacter(c)}
              className="text-left"
            >
              <div
                className="w-full aspect-[3/4] rounded-2xl relative overflow-hidden"
                style={{ background: c.gradient }}
              >
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-3">
                  <p className="text-white font-bold text-base truncate">{c.name}</p>
                  <p className="text-white/70 text-[11px] truncate mt-0.5">{c.role}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
