"use client"

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { tgFetch } from '@/lib/telegram-fetch'
import {
  ARCHETYPES_MALE, ARCHETYPES_FEMALE,
  CHARACTER_NAMES_MALE, CHARACTER_NAMES_FEMALE,
  PERSONALITIES, getDisplayName, getCharacterImageUrl,
  FANTASY_ARCHETYPES,
  isVipArchetype,
  VIP_PLANS,
  GACHA_ARCHETYPES,
  sortByPopularity,
} from '@/lib/constants'
import { getTranslations } from '@/lib/i18n'
import { useUser } from '@/lib/UserContext'
import { Analytics } from '@/lib/posthog'

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

const LS_KEY_VIP_DISMISSED = 'taboo_banner_vip_dismissed'
const LS_KEY_INVITE_DISMISSED = 'taboo_banner_invite_dismissed'

export default function HomePage() {
  const router = useRouter()
  const { user, loading: userLoading, lang, isTelegram } = useUser()

  const [activeChar, setActiveChar] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'all' | 'male' | 'female' | 'vip' | 'gacha'>('all')
  const [creating, setCreating] = useState<string | null>(null)
  const tabInitialized = useRef(false)

  const [isVip, setIsVip] = useState(false)
  const [vipChecked, setVipChecked] = useState(false)
  const [showVipModal, setShowVipModal] = useState(false)
  const [vipBlockedChar, setVipBlockedChar] = useState<Char | null>(null)

  const [showGachaModal, setShowGachaModal] = useState(false)
  const [gachaBlockedChar, setGachaBlockedChar] = useState<Char | null>(null)

  const [vipBannerVisible, setVipBannerVisible] = useState(false)
  const [inviteBannerVisible, setInviteBannerVisible] = useState(false)

  // ✅ FIX 1: Estado para guardar los personajes de ruleta que el usuario ya posee
  const [ownedGacha, setOwnedGacha] = useState<string[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const vipDismissed = localStorage.getItem(LS_KEY_VIP_DISMISSED)
      const inviteDismissed = localStorage.getItem(LS_KEY_INVITE_DISMISSED)
      setVipBannerVisible(vipDismissed !== '1')
      setInviteBannerVisible(inviteDismissed !== '1')
    } catch {
      setVipBannerVisible(true)
      setInviteBannerVisible(true)
    }
  }, [])

  const dismissVipBanner = () => {
    setVipBannerVisible(false)
    try { localStorage.setItem(LS_KEY_VIP_DISMISSED, '1') } catch {}
  }

  const dismissInviteBanner = () => {
    setInviteBannerVisible(false)
    try { localStorage.setItem(LS_KEY_INVITE_DISMISSED, '1') } catch {}
  }

  useEffect(() => {
    if (tabInitialized.current || !user) return
    tabInitialized.current = true

    const interest = user.interested_in
    if (interest === 'male') setTab('male')
    else if (interest === 'female') setTab('female')
    else setTab('all')
  }, [user])

  useEffect(() => {
    if (!user?.telegram_id) {
      if (!userLoading) setVipChecked(true)
      return
    }
    tgFetch('/api/subscription')
      .then(async (res) => {
        if (!res.ok) {
          setVipChecked(true)
          return
        }
        const data = await res.json()
        setIsVip(!!data.active)
        setVipChecked(true)
      })
      .catch((e) => {
        console.warn('[home] vip check error:', e)
        setVipChecked(true)
      })
  }, [user?.telegram_id, userLoading])

  useEffect(() => {
    if (!user?.telegram_id) return
    tgFetch('/api/characters?active=1')
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json()
        if (data?.character) setActiveChar(data.character)
      })
      .catch((e) => console.warn('[home] active char error:', e))
  }, [user?.telegram_id])

  // ✅ FIX 2: Cargar los personajes de ruleta que el usuario ya posee
  useEffect(() => {
    if (!user?.telegram_id) return
    tgFetch('/api/characters')
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json()
        const owned = (data?.characters || [])
          .map((c: any) => c.archetype)
          .filter((a: string) => GACHA_ARCHETYPES.includes(a))
        setOwnedGacha(owned)
      })
      .catch((e) => console.warn('[home] owned gacha error:', e))
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
    .filter((c) => {
      const isVipChar = isVipArchetype(c.archetype)
      const isGachaChar = GACHA_ARCHETYPES.includes(c.archetype)

      if (tab === 'vip') return isVipChar && !isGachaChar
      if (tab === 'gacha') return isGachaChar
      
      // ✅ FIX 3: Si es un personaje de la ruleta y NO lo tiene, ocultarlo de las pestañas normales
      if (isGachaChar && !ownedGacha.includes(c.archetype)) return false

      if (tab === 'all') return true
      return c.gender === tab
    })
    .filter(
      (c) =>
        !search ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.role.toLowerCase().includes(search.toLowerCase())
    )
    .sort(sortByPopularity)

  const pick = async (c: Char) => {
    if (!user) {
      alert('Usuario no cargado. Cierra y vuelve a abrir la Mini App.')
      return
    }
    if (creating !== null) return

    const isVipChar = isVipArchetype(c.archetype)
    const isGachaChar = GACHA_ARCHETYPES.includes(c.archetype)

    // ✅ FIX 4: Bloquear solo si es de la ruleta Y NO lo tiene
    if (isGachaChar && !ownedGacha.includes(c.archetype)) {
      setGachaBlockedChar(c)
      setShowGachaModal(true)
      return
    }

    if (isVipChar && !isVip) {
      setVipBlockedChar(c)
      setShowVipModal(true)
      return
    }

    const key = `${c.gender}_${c.archetype}`
    setCreating(key)

    Analytics.characterSelected({
      archetype: c.archetype,
      gender: c.gender,
      is_vip_archetype: isVipChar,
    })

    try {
      const res = await tgFetch('/api/select-character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archetype: c.archetype,
          gender: c.gender,
          character_name: c.name,
        }),
      })

      let data: any = null
      try {
        data = await res.json()
      } catch {
        data = { error: `HTTP ${res.status}` }
      }

      if (res.ok && data.character_id) {
        router.push(`/chat/${data.character_id}`)
      } else if (data.error === 'vip_required') {
        setVipBlockedChar(c)
        setShowVipModal(true)
        setCreating(null)
      } else {
        const msg = data.detail
          ? `${data.error}: ${data.detail}`
          : (data.error || `Error HTTP ${res.status}`)
        alert(msg)
        setCreating(null)
      }
    } catch (err: any) {
      alert('Error de conexión: ' + (err?.message || 'desconocido'))
      setCreating(null)
    }
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
  const messages = (user as any)?.bonus_gems || 0
  const hookRemaining = user?.hook_messages_remaining || 0

  const shouldShowVipBanner = vipChecked && !isVip && vipBannerVisible
  const shouldShowInviteBanner = !!user && inviteBannerVisible

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
            gap: 8,
          }}
        >
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: '-0.02em', flex: 1 }}>
            Taboo<span style={{ color: '#a78bfa' }}>Realm</span>
          </h1>

          <button
            onClick={() => router.push('/settings')}
            aria-label="Settings"
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              borderRadius: 12,
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#a395c9',
              flexShrink: 0,
              transition: 'all 0.2s ease',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                background: 'rgba(255, 255, 255, 0.05)',
                padding: '6px 10px',
                borderRadius: 20,
                border: '1px solid rgba(255, 255, 255, 0.06)',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 13 }}>💎</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{gems}</span>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                background: 'rgba(34, 197, 94, 0.1)',
                padding: '6px 10px',
                borderRadius: 20,
                border: '1px solid rgba(34, 197, 94, 0.25)',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 12 }}>💌</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#22c55e' }}>{messages}</span>
            </div>
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

      {shouldShowVipBanner && (
        <section style={{ padding: '12px 16px 0', position: 'relative' }}>
          <button
            onClick={() => router.push('/shop')}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: 14,
              paddingRight: 44,
              borderRadius: 16,
              background:
                'linear-gradient(135deg, rgba(251,191,36,0.15) 0%, rgba(217,119,6,0.08) 100%)',
              border: '1px solid rgba(251, 191, 36, 0.4)',
              textAlign: 'left',
              cursor: 'pointer',
              fontFamily: 'inherit',
              color: 'inherit',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: -30,
                right: -20,
                fontSize: 100,
                opacity: 0.1,
                pointerEvents: 'none',
              }}
            >
              👑
            </div>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                background:
                  'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                flexShrink: 0,
                boxShadow: '0 4px 16px rgba(251, 191, 36, 0.4)',
              }}
            >
              👑
            </div>
            <div style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>
              <p
                style={{
                  fontSize: 13,
                  fontWeight: 800,
                  margin: 0,
                  color: '#fbbf24',
                }}
              >
                {lang === 'es' ? 'Hazte VIP' : 'Go VIP'}
              </p>
              <p
                style={{
                  fontSize: 11,
                  color: '#a395c9',
                  margin: '2px 0 0 0',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {lang === 'es'
                  ? 'Mensajes ilimitados · Imágenes gratis · 12 personajes exclusivos'
                  : 'Unlimited messages · Free images · 12 exclusive characters'}
              </p>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
              <path d="m9 6 6 6-6 6" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <button
            onClick={dismissVipBanner}
            aria-label="Cerrar"
            style={{
              position: 'absolute',
              top: 20,
              right: 26,
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(251, 191, 36, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              zIndex: 2,
              color: '#fbbf24',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path
                d="M18 6 6 18M6 6l12 12"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </section>
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

      {shouldShowInviteBanner && (
        <section style={{ padding: '12px 16px 0', position: 'relative' }}>
          <button
            onClick={() => router.push('/invite')}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: 12,
              paddingRight: 44,
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
              <span style={{ fontSize: 12 }}>💎</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e' }}>+10</span>
            </div>
          </button>

          <button
            onClick={dismissInviteBanner}
            aria-label="Cerrar"
            style={{
              position: 'absolute',
              top: 18,
              right: 26,
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              zIndex: 2,
              color: '#22c55e',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path
                d="M18 6 6 18M6 6l12 12"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </section>
      )}

      <div className="tabs">
        {[
          { id: 'all', label: t.all },
          { id: 'female', label: t.female },
          { id: 'male', label: t.male },
          { id: 'vip', label: `👑 ${lang === 'es' ? 'VIP' : 'VIP'}` },
          { id: 'gacha', label: `🎰 ${lang === 'es' ? 'Ruleta' : 'Gacha'}` },
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
          const key = `${c.gender}_${c.archetype}`
          const imageUrl = getCharacterImageUrl(c.archetype, c.gender)
          const isCreating = creating === key
          const isVipChar = isVipArchetype(c.archetype)
          const isGachaChar = GACHA_ARCHETYPES.includes(c.archetype)
          
          const isLockedVip = isVipChar && !isVip && !isGachaChar
          
          // ✅ FIX 5: Solo bloquear si es de la ruleta Y NO lo tiene
          const isLockedGacha = isGachaChar && !ownedGacha.includes(c.archetype)

          return (
            <button
              key={key}
              onClick={() => pick(c)}
              disabled={creating !== null}
              className="char-card"
              style={{ opacity: isCreating ? 0.5 : 1 }}
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

                {isLockedVip && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(10, 5, 16, 0.55)',
                      backdropFilter: 'blur(8px)',
                      WebkitBackdropFilter: 'blur(8px)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      zIndex: 3,
                    }}
                  >
                    <span style={{ fontSize: 32, filter: 'drop-shadow(0 0 12px rgba(251, 191, 36, 0.9))' }}>🔒</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 900,
                        letterSpacing: '0.08em',
                        color: '#fbbf24',
                        background: 'rgba(251, 191, 36, 0.15)',
                        border: '1px solid rgba(251, 191, 36, 0.5)',
                        padding: '3px 8px',
                        borderRadius: 6,
                        textShadow: '0 0 6px rgba(251, 191, 36, 0.5)',
                      }}
                    >
                      👑 VIP
                    </span>
                  </div>
                )}

                {isLockedGacha && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(10, 5, 16, 0.65)',
                      backdropFilter: 'blur(8px)',
                      WebkitBackdropFilter: 'blur(8px)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      zIndex: 3,
                    }}
                  >
                    <span style={{ fontSize: 32, filter: 'drop-shadow(0 0 12px rgba(236, 72, 153, 0.9))' }}>🎰</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 900,
                        letterSpacing: '0.08em',
                        color: '#ec4899',
                        background: 'rgba(236, 72, 153, 0.15)',
                        border: '1px solid rgba(236, 72, 153, 0.5)',
                        padding: '3px 8px',
                        borderRadius: 6,
                        textShadow: '0 0 6px rgba(236, 72, 153, 0.5)',
                      }}
                    >
                      🎰 RULETA
                    </span>
                  </div>
                )}

                {isVipChar && isVip && !isGachaChar && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      background: 'rgba(0, 0, 0, 0.5)',
                      backdropFilter: 'blur(8px)',
                      WebkitBackdropFilter: 'blur(8px)',
                      padding: '4px 6px',
                      borderRadius: 8,
                      fontSize: 12,
                      zIndex: 3,
                      border: '1px solid rgba(251, 191, 36, 0.4)',
                    }}
                  >
                    👑
                  </div>
                )}

                {isCreating && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(0,0,0,0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 5,
                    }}
                  >
                    <div className="spinner" />
                  </div>
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

      {showVipModal && vipBlockedChar && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowVipModal(false)
            setVipBlockedChar(null)
          }}
        >
          <div
            className="modal-box level-up-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'relative' }}
          >
            <div
              style={{
                position: 'absolute',
                top: -20,
                right: -20,
                fontSize: 140,
                opacity: 0.08,
                pointerEvents: 'none',
                zIndex: 0,
              }}
            >
              👑
            </div>

            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ textAlign: 'center', marginBottom: 12 }}>
                <span
                  style={{
                    fontSize: 56,
                    filter: 'drop-shadow(0 0 20px rgba(251, 191, 36, 0.9))',
                  }}
                >
                  👑
                </span>
              </div>

              <p
                style={{
                  fontSize: 10,
                  fontWeight: 900,
                  letterSpacing: '0.18em',
                  color: '#fbbf24',
                  textAlign: 'center',
                  margin: 0,
                  textShadow: '0 0 12px rgba(251, 191, 36, 0.5)',
                }}
              >
                {lang === 'es' ? 'PERSONAJE VIP EXCLUSIVO' : 'EXCLUSIVE VIP CHARACTER'}
              </p>

              <h2
                className="modal-title"
                style={{
                  textAlign: 'center',
                  fontSize: 24,
                  marginTop: 6,
                  marginBottom: 0,
                  background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                {vipBlockedChar.name}
              </h2>

              <div
                style={{
                  marginTop: 20,
                  padding: 16,
                  borderRadius: 14,
                  background: 'rgba(251, 191, 36, 0.1)',
                  border: '1px solid rgba(251, 191, 36, 0.3)',
                }}
              >
                <p
                  style={{
                    fontSize: 14,
                    color: '#f5f0ff',
                    margin: 0,
                    textAlign: 'center',
                    lineHeight: 1.6,
                  }}
                >
                  {lang === 'es'
                    ? `${vipBlockedChar.name} es parte de nuestra colección VIP exclusiva. Hazte VIP para desbloquear este y otros 11 personajes únicos.`
                    : `${vipBlockedChar.name} is part of our exclusive VIP collection. Go VIP to unlock this and 11 other unique characters.`}
                </p>
              </div>

              <div className="modal-btn-row" style={{ marginTop: 18 }}>
                <button
                  onClick={() => {
                    setShowVipModal(false)
                    setVipBlockedChar(null)
                  }}
                  className="modal-btn secondary"
                >
                  {lang === 'es' ? 'Ahora no' : 'Not now'}
                </button>
                <button
                  onClick={() => {
                    setShowVipModal(false)
                    setVipBlockedChar(null)
                    router.push('/shop')
                  }}
                  className="modal-btn primary"
                  style={{
                    background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
                    boxShadow: '0 4px 24px rgba(251, 191, 36, 0.6)',
                  }}
                >
                  👑 {lang === 'es' ? 'Ver planes' : 'See plans'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showGachaModal && gachaBlockedChar && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowGachaModal(false)
            setGachaBlockedChar(null)
          }}
        >
          <div
            className="modal-box level-up-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'relative' }}
          >
            <div
              style={{
                position: 'absolute',
                top: -20,
                right: -20,
                fontSize: 140,
                opacity: 0.08,
                pointerEvents: 'none',
                zIndex: 0,
              }}
            >
              🎰
            </div>

            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ textAlign: 'center', marginBottom: 12 }}>
                <span
                  style={{
                    fontSize: 56,
                    filter: 'drop-shadow(0 0 20px rgba(236, 72, 153, 0.9))',
                  }}
                >
                  🎰
                </span>
              </div>

              <p
                style={{
                  fontSize: 10,
                  fontWeight: 900,
                  letterSpacing: '0.18em',
                  color: '#ec4899',
                  textAlign: 'center',
                  margin: 0,
                  textShadow: '0 0 12px rgba(236, 72, 153, 0.5)',
                }}
              >
                {lang === 'es' ? 'PREMIO LEGENDARIO' : 'LEGENDARY PRIZE'}
              </p>

              <h2
                className="modal-title"
                style={{
                  textAlign: 'center',
                  fontSize: 24,
                  marginTop: 6,
                  marginBottom: 0,
                  background: 'linear-gradient(135deg, #ec4899, #a855f7)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                {gachaBlockedChar.name}
              </h2>

              <div
                style={{
                  marginTop: 20,
                  padding: 16,
                  borderRadius: 14,
                  background: 'rgba(236, 72, 153, 0.1)',
                  border: '1px solid rgba(236, 72, 153, 0.3)',
                }}
              >
                <p
                  style={{
                    fontSize: 14,
                    color: '#f5f0ff',
                    margin: 0,
                    textAlign: 'center',
                    lineHeight: 1.6,
                  }}
                >
                  {lang === 'es'
                    ? `${gachaBlockedChar.name} es un personaje ultra-exclusivo de la Ruleta de lo Prohibido. ¡Gira la ruleta para ver si tienes suerte!`
                    : `${gachaBlockedChar.name} is an ultra-exclusive character from the Roulette of the Forbidden. Spin the roulette and see if you get lucky!`}
                </p>
              </div>

              <div className="modal-btn-row" style={{ marginTop: 18 }}>
                <button
                  onClick={() => {
                    setShowGachaModal(false)
                    setGachaBlockedChar(null)
                  }}
                  className="modal-btn secondary"
                >
                  {lang === 'es' ? 'Cerrar' : 'Close'}
                </button>
                <button
                  onClick={() => {
                    setShowGachaModal(false)
                    setGachaBlockedChar(null)
                    router.push('/gacha')
                  }}
                  className="modal-btn primary"
                  style={{
                    background: 'linear-gradient(135deg, #ec4899 0%, #a855f7 100%)',
                    boxShadow: '0 4px 24px rgba(236, 72, 153, 0.6)',
                  }}
                >
                  🎰 {lang === 'es' ? 'Ir a la Ruleta' : 'Go to Roulette'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
