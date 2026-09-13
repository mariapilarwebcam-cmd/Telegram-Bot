"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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
      if (data) {
        setUser(data)
        setGems(data.gems || 0)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const t = getTranslations(lang)

  // FEMENINAS PRIMERO
  const all: Char[] = []
  const femaleMap = ARCHETYPES_FEMALE[lang] as Record<string, string>
  const maleMap = ARCHETYPES_MALE[lang] as Record<string, string>

  Object.entries(femaleMap).forEach(([k, role]) => {
    all.push({
      archetype: k,
      name: CHARACTER_NAMES_FEMALE[k] || role,
      role,
      gender: 'female',
      personality: PERSONALITIES[k] || '',
      gradient: getGradient('f_' + k),
    })
  })
  Object.entries(maleMap).forEach(([k, role]) => {
    all.push({
      archetype: k,
      name: CHARACTER_NAMES_MALE[k] || role,
      role,
      gender: 'male',
      personality: PERSONALITIES[k] || '',
      gradient: getGradient('m_' + k),
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
    } catch (e) {
      console.error(e)
    }
  }

  const confirmCreate = async () => {
    if (!pendingChar || !user) return
    if (gems < GEM_COSTS.new_character) {
      alert(t.notEnoughGems)
      return
    }

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
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <div className="spinner-full">
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">{t.characters}</h1>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(255, 255, 255, 0.05)',
            padding: '6px 12px',
            borderRadius: 20,
            border: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 3l3 5h5l-8 13L4 8h5l3-5z" fill="#a78bfa" />
          </svg>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{gems}</span>
        </div>
      </header>

      <div className="tabs">
        {[
          { id: 'all', label: t.all },
          { id: 'female', label: t.female },
          { id: 'male', label: t.male },
        ].map((x) => (
          <button
            key={x.id}
            onClick={() => setTab(x.id as any)}
            className={`tab ${tab === x.id ? 'active' : ''}`}
          >
            {x.label}
          </button>
        ))}
      </div>

      <div className="char-grid">
        {filtered.map((c) => (
          <button
            key={`${c.gender}_${c.archetype}`}
            onClick={() => pick(c)}
            disabled={creating}
            className="char-card"
          >
            <div className="char-card-img" style={{ background: c.gradient }}>
              <div className="char-card-overlay" />
              <div className="char-card-text">
                <p className="char-card-name">{c.name}</p>
                <p className="char-card-role">{c.role}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Create modal */}
      {pendingChar && (
        <div className="modal-backdrop">
          <div className="modal-box">
            <h3 className="modal-title">{pendingChar.name}</h3>
            <p className="modal-desc">
              {pendingChar.role} · {t.createCharCost}: {GEM_COSTS.new_character} {t.gems}
            </p>
            <input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder={t.namePlaceholder}
              maxLength={30}
              className="modal-input"
            />
            <div className="modal-btn-row">
              <button
                onClick={() => setPendingChar(null)}
                className="modal-btn secondary"
              >
                {t.cancel}
              </button>
              <button
                onClick={confirmCreate}
                disabled={creating || !customName.trim() || gems < GEM_COSTS.new_character}
                className="modal-btn primary"
              >
                {creating ? t.creating : `${t.create} (${GEM_COSTS.new_character})`}
              </button>
            </div>
            {gems < GEM_COSTS.new_character && (
              <p
                style={{
                  fontSize: 12,
                  color: '#ef4444',
                  marginTop: 12,
                  textAlign: 'center',
                }}
              >
                {t.notEnoughGems}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
