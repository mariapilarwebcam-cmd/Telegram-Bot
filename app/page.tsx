"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  ARCHETYPES_MALE, ARCHETYPES_FEMALE,
  CHARACTER_NAMES_MALE, CHARACTER_NAMES_FEMALE,
  PERSONALITIES, getDisplayName, getCharacterImageUrl
} from '@/lib/constants'
import { getTranslations } from '@/lib/i18n'
import { useUser } from '@/lib/UserContext'

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
  const { user, loading: userLoading, lang, isTelegram } = useUser()

  const [activeChar, setActiveChar] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'all' | 'male' | 'female'>('all')

  useEffect(() => {
    if (!user?.telegram_id) return
    supabase
      .from('user_characters')
      .select('*')
      .eq('telegram_id', user.telegram_id)
      .eq('is_active', true)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setActiveChar(data)
      })
  }, [user?.telegram_id])

  const t = getTranslations(lang)

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

  const filtered = all
    .filter((c) => (tab === 'all' ? true : c.gender === tab))
    .filter(
      (c) =>
        !search ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.role.toLowerCase().includes(search.toLowerCase())
    )

  const openCharacter = () => {
    router.push('/characters')
  }

  if (userLoading && !user) {
    return (
      <div className="spinner-full">
        <div className="spinner" />
      </div>
    )
  }

  if (!isTelegram) {
    return (
      <div className="spinner-full" style={{ padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 340 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              margin: '0 auto 16px',
              background: 'linear-gradient(135deg, #7c5cff 0%, #a855f7 100%)',
            }}
          />
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
            {t.openFromTelegram}
          </h1>
          <p style={{ fontSize: 14, color: '#8b8b9e', marginBottom: 24 }}>
            {t.openFromTelegramDesc}
          </p>
          <a
            href="https://t.me/TabooRealmBot"
            style={{
              display: 'inline-block',
              background: 'linear-gradient(135deg, #7c5cff 0%, #a855f7 100%)',
              color: '#fff',
              padding: '12px 24px',
              borderRadius: 12,
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            Abrir en Telegram
          </a>
        </div>
      </div>
    )
  }

  const gems = user?.gems || 0
  const hookRemaining = user?.hook_messages_remaining || 0

  return (
    <div style={{ paddingBottom: 24 }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: 'rgba(10, 10, 15, 0.95)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          padding: '12px 16px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
            Taboo<span style={{ color: '#a78bfa' }}>Realm</span>
          </h1>
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
        </div>

        <div style={{ position: 'relative' }}>
          <svg
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
            }}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle cx="11" cy="11" r="7" stroke="#6b6b7e" strokeWidth="2" />
            <path d="m20 20-3.5-3.5" stroke="#6b6b7e" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.search}
            style={{
              width: '100%',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              borderRadius: 12,
              padding: '10px 12px 10px 36px',
              fontSize: 14,
              color: '#f0f0f5',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </div>
      </header>

      {hookRemaining > 0 && (
        <div
          style={{
            margin: '12px 16px 0',
            padding: '12px 16px',
            borderRadius: 12,
            background:
              'linear-gradient(135deg, rgba(124,92,255,0.2), rgba(168,85,247,0.1))',
            border: '1px solid rgba(124,92,255,0.3)',
          }}
        >
          <p style={{ fontSize: 12, fontWeight: 500, color: '#c4b5fd', margin: 0 }}>
            {hookRemaining} {t.specialMoments}
          </p>
        </div>
      )}

      {activeChar && (
        <section style={{ padding: '16px 16px 0' }}>
          <button
            onClick={() => router.push(`/chat/${activeChar.id}`)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: 12,
              borderRadius: 16,
              background:
                'linear-gradient(90deg, rgba(124,92,255,0.15), rgba(168,85,247,0.1))',
              border: '1px solid rgba(124,92,255,0.3)',
              textAlign: 'left',
              cursor: 'pointer',
              fontFamily: 'inherit',
              color: 'inherit',
            }}
          >
            {/* AVATAR — inline sizing bulletproof */}
            <div
              style={{
                width: 48,
                height: 48,
                minWidth: 48,
                minHeight: 48,
                maxWidth: 48,
                maxHeight: 48,
                borderRadius: '50%',
                overflow: 'hidden',
                position: 'relative',
                background: getGradient(activeChar.archetype),
                flexShrink: 0,
                border: '2px solid rgba(240, 171, 252, 0.3)',
                boxShadow: '0 0 20px rgba(168, 85, 247, 0.5)',
              }}
            >
              {(() => {
                const img = getCharacterImageUrl(activeChar.archetype, activeChar.gender)
                return img ? (
                  <img
                    src={img}
                    alt=""
                    style={{
                      display: 'block',
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      objectPosition: 'center 20%',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '100%',
                      height: '100%',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: 18,
                    }}
                  >
                    {getDisplayName(activeChar)?.[0]?.toUpperCase()}
                  </div>
                )
              })()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: '#a78bfa',
                  fontWeight: 600,
                  margin: 0,
                }}
              >
                {t.activeCharacter}
              </p>
              <p
                style={{
                  fontWeight: 600,
                  margin: '2px 0 0 0',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {getDisplayName(activeChar)}
              </p>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
              <path
                d="m9 6 6 6-6 6"
                stroke="#a78bfa"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </section>
      )}

      {user && (
        <section style={{ padding: '12px 16px 0' }}>
          <button
            onClick={() => router.push('/invite')}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: 12,
              borderRadius: 16,
              background:
                'linear-gradient(90deg, rgba(34,197,94,0.12), rgba(34,197,94,0.04))',
              border: '1px solid rgba(34,197,94,0.3)',
              textAlign: 'left',
              cursor: 'pointer',
              fontFamily: 'inherit',
              color: 'inherit',
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                minWidth: 40,
                borderRadius: 12,
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                flexShrink: 0,
              }}
            >
              🎁
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 700, margin: 0, color: '#fff' }}>
                {t.inviteTitle}
              </p>
              <p
                style={{
                  fontSize: 11,
                  color: '#8b8b9e',
                  margin: '2px 0 0 0',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.inviteSubtitle}
              </p>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: 'rgba(255,255,255,0.08)',
                padding: '4px 10px',
                borderRadius: 20,
                flexShrink: 0,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M12 3l3 5h5l-8 13L4 8h5l3-5z" fill="#22c55e" />
              </svg>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e' }}>+5</span>
            </div>
          </button>
        </section>
      )}

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
        {filtered.map((c) => {
          const imageUrl = getCharacterImageUrl(c.archetype, c.gender)
          return (
            <button
              key={`${c.gender}_${c.archetype}`}
              onClick={openCharacter}
              className="char-card"
            >
              <div className="char-card-img" style={{ background: c.gradient }}>
                {imageUrl && (
                  <img
                    src={imageUrl}
                    alt={c.name}
                    loading="lazy"
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                )}
                <div className="char-card-overlay" />
                <div className="char-card-text">
                  <p className="char-card-name">{c.name}</p>
                  <p className="char-card-role">{c.role}</p>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
