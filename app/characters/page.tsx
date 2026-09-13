"use client"

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  ARCHETYPES_MALE, ARCHETYPES_FEMALE,
  CHARACTER_NAMES_MALE, CHARACTER_NAMES_FEMALE,
  PERSONALITIES, GEM_COSTS
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

function getGradient(key: string) {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return GRADIENTS[Math.abs(h) % GRADIENTS.length]
}

export default function CharactersPage() {
  const router = useRouter()
  const params = useSearchParams()
  const [user, setUser] = useState<any>(null)
  const [gems, setGems] = useState(0)
  const [loading, setLoading] = useState(true)
  const [lang, setLang] = useState<Language>('es')
  const [tab, setTab] = useState<'all' | 'male' | 'female'>('all')

  const [pendingChar, setPendingChar] = useState<Char | null>(null)
  const [customName, setCustomName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    import('@twa-dev/sdk').then((mod) => {
      const WebApp = mod.default
      WebApp.ready()
      WebApp.expand()
      const u = WebApp.initDataUnsafe?.user
      if (u?.id) {
        setLang(getLanguage(u.language_code))
        loadUser(u.id)
      } else setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const loadUser = async (telegramId: number) => {
    try {
      const { data } = await supabase
        .from('users').select('*').eq('telegram_id', telegramId.toString()).maybeSingle()
      if (data) { setUser(data); setGems(data.gems || 0) }
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

  const filtered = tab === 'all' ? all : all.filter(c => c.gender === tab)

  const pick = async (c: Char) => {
    if (!user) return
    const tid = user.telegram_id.toString()

    try {
      const { data: existing } = await supabase
        .from('user_characters')
        .select('*')
        .eq('telegram_id', tid)
        .eq('archetype', c.archetype)
        .eq('gender', c.gender)
        .maybeSingle()

      if (existing) {
        await supabase.from('user_characters').update({ is_active: false }).eq('telegram_id', tid)
        await supabase.from('user_characters').update({ is_active: true }).eq('id', existing.id)
        router.push(`/chat/${existing.id}`)
      } else {
        setCustomName(c.name)
        setPendingChar(c)
      }
    } catch (e) { console.error(e) }
  }

  const confirmCreate = async () => {
    if (!pendingChar || !user) return
    if (gems < GEM_COSTS.new_character) { alert(t.notEnoughGems); return }

    setCreating(true)
    try {
      const tid = user.telegram_id.toString()
      const newGems = gems - GEM_COSTS.new_character

      await supabase.from('users').update({ gems: newGems }).eq('telegram_id', tid)
      await supabase.from('gem_transactions').insert({
        telegram_id: tid,
        amount: -GEM_COSTS.new_character,
        transaction_type: 'new_character',
        description: 'Nuevo personaje',
      })

      await supabase.from('user_characters').update({ is_active: false }).eq('telegram_id', tid)

      const charName = customName.trim() || pendingChar.name
      const { data, error } = await supabase
        .from('user_characters')
        .insert({
          telegram_id: tid,
          character_name: charName,
          gender: pendingChar.gender,
          archetype: pendingChar.archetype,
          personality: PERSONALITIES[pendingChar.archetype] || '',
          is_active: true,
        })
        .select()
        .single()

      if (error) throw error
      setGems(newGems)
      setPendingChar(null)
      router.push(`/chat/${data.id}`)
    } catch (e: any) {
      alert('Error: ' + e.message)
    } finally { setCreating(false) }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-[#7c5cff] border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-20 bg-[#0a0a0f]/95 backdrop-blur px-4 py-4 border-b border-white/5 flex items-center justify-between">
        <h1 className="text-xl font-bold">{t.characters}</h1>
        <div className="flex items-center gap-1.5 bg-white/5 px-3 py-1.5 rounded-full border border-white/5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 3l3 5h5l-8 13L4 8h5l3-5z" fill="#a78bfa" />
          </svg>
          <span className="text-sm font-semibold">{gems}</span>
        </div>
      </header>

      <section className="px-4 mt-4 flex gap-2">
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
      </section>

      <section className="px-4 mt-4 grid grid-cols-2 gap-3">
        {filtered.map(c => (
          <button
            key={`${c.gender}_${c.archetype}`}
            onClick={() => pick(c)}
            disabled={creating}
            className="text-left disabled:opacity-50"
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
      </section>

      {/* Create modal */}
      {pendingChar && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-[#16161d] rounded-2xl p-6 max-w-md w-full border border-white/5">
            <h3 className="text-lg font-bold mb-1">{pendingChar.name}</h3>
            <p className="text-xs text-[#8b8b9e] mb-4">
              {pendingChar.role} · {t.createCharCost}: {GEM_COSTS.new_character} {t.gems}
            </p>
            <input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder={t.namePlaceholder}
              maxLength={30}
              className="w-full bg-black/30 border border-white/5 rounded-xl p-3 text-sm mb-4 outline-none focus:border-[#7c5cff]/50"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setPendingChar(null)}
                className="flex-1 py-2.5 rounded-xl bg-white/5 text-[#8b8b9e]"
              >
                {t.cancel}
              </button>
              <button
                onClick={confirmCreate}
                disabled={creating || !customName.trim() || gems < GEM_COSTS.new_character}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#7c5cff] to-[#a855f7] text-white font-medium disabled:opacity-40"
              >
                {creating ? t.creating : `${t.create} (${GEM_COSTS.new_character})`}
              </button>
            </div>
            {gems < GEM_COSTS.new_character && (
              <p className="text-xs text-[#ef4444] mt-3 text-center">{t.notEnoughGems}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
