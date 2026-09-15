"use client"

import { useState, useEffect } from 'react'
import { useUser } from '@/lib/UserContext'
import { getTranslations } from '@/lib/i18n'

export default function InvitePage() {
  const { user, loading: userLoading, lang, refresh, isTelegram } = useUser()
  const [copied, setCopied] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const t = getTranslations(lang)

  useEffect(() => {
    if (user) return
    const to = setTimeout(() => setTimedOut(true), 5000)
    return () => clearTimeout(to)
  }, [user])

  const handleRetry = async () => {
    setRetrying(true)
    setTimedOut(false)
    try {
      await refresh()
    } catch (e) {
      console.error(e)
    } finally {
      setRetrying(false)
      setTimeout(() => setTimedOut(true), 5000)
    }
  }

  const handleCopy = async () => {
    if (!user) return
    const refCode = user.username || user.referral_code
    const link = `https://t.me/TabooRealmBot?startapp=${refCode}`
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert(t.errorConnection)
    }
  }

  const handleShare = () => {
    if (!user) return
    const refCode = user.username || user.referral_code
    const referralLink = `https://t.me/TabooRealmBot?startapp=${refCode}`
    const shareText = lang === 'es'
      ? '¡Mira esta app! Chatea con personajes IA 🔥'
      : 'Check this app out! Chat with AI characters 🔥'

    import('@twa-dev/sdk').then((mod) => {
      const WebApp = mod.default
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareText)}`
      try {
        WebApp.openTelegramLink(shareUrl)
      } catch {
        window.open(shareUrl, '_blank')
      }
    }).catch(() => {
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareText)}`
      window.open(shareUrl, '_blank')
    })
  }

  // Spinner solo si aún carga Y no ha pasado el timeout
  if (userLoading && !timedOut && !user) {
    return (
      <div className="spinner-full">
        <div className="spinner" />
      </div>
    )
  }

  // Fallback si no hay user tras el timeout
  if (!user) {
    const noTelegram = !isTelegram
    return (
      <div className="page">
        <header className="page-header">
          <h1 className="page-title">{t.inviteTitle}</h1>
        </header>
        <div
          style={{
            padding: '40px 24px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <div style={{ fontSize: 48 }}>⚠️</div>

          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: 0 }}>
            {noTelegram
              ? (lang === 'es' ? 'Abre esta app desde Telegram' : 'Open this app from Telegram')
              : (lang === 'es' ? 'No se pudo cargar tu cuenta' : 'Could not load your account')
            }
          </h2>

          <p style={{ color: '#8b8b9e', margin: 0, fontSize: 14, maxWidth: 300, lineHeight: 1.5 }}>
            {noTelegram
              ? (lang === 'es'
                  ? 'Necesitas abrir esta Mini App desde el bot de Telegram, no desde el navegador.'
                  : 'You need to open this Mini App from the Telegram bot, not from the browser.')
              : (lang === 'es'
                  ? 'Hubo un problema cargando tus datos. Intenta recargar. Si persiste, envía /start al bot primero.'
                  : 'There was a problem loading your data. Try reloading. If it persists, send /start to the bot first.')
            }
          </p>

          {!noTelegram && (
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="btn-primary"
              style={{ opacity: retrying ? 0.6 : 1 }}
            >
              {retrying
                ? (lang === 'es' ? 'Cargando...' : 'Loading...')
                : (lang === 'es' ? 'Reintentar' : 'Retry')
              }
            </button>
          )}

          <button
            onClick={() => window.location.reload()}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#6b6b7e',
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: 'inherit',
              padding: 8,
            }}
          >
            {lang === 'es' ? 'Recargar app' : 'Reload app'}
          </button>
        </div>
      </div>
    )
  }

  // Render normal
  const refCode = user.username || user.referral_code
  const referralLink = `https://t.me/TabooRealmBot?startapp=${refCode}`
  const earnedGems = (user.total_referrals || 0) * 5

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">{t.inviteTitle}</h1>
      </header>

      {/* Hero */}
      <section style={{ padding: '24px 16px 0' }}>
        <div
          style={{
            padding: 24,
            borderRadius: 24,
            background: 'linear-gradient(135deg, #7c5cff 0%, #a855f7 50%, #d946ef 100%)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 12 }}>🎁</div>
          <h2 style={{ fontSize: 22, fontWeight: 900, color: '#fff', margin: '0 0 6px 0' }}>
            {t.inviteTitle}
          </h2>
          <p
            style={{
              fontSize: 14,
              color: 'rgba(255,255,255,0.85)',
              margin: 0,
              maxWidth: 260,
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          >
            {t.inviteSubtitle}
          </p>
        </div>
      </section>

      {/* Link */}
      <section style={{ padding: '24px 16px 0' }}>
        <p
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: '#8b8b9e',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 8,
            marginTop: 0,
          }}
        >
          {t.yourLink}
        </p>

        <div
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <p
            style={{
              fontSize: 12,
              color: '#a78bfa',
              margin: 0,
              wordBreak: 'break-all',
              fontWeight: 500,
            }}
          >
            {referralLink}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleCopy}
            style={{
              flex: 1,
              padding: '14px 16px',
              borderRadius: 14,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
              <path
                d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            {copied ? t.copied : t.copy}
          </button>

          <button
            onClick={handleShare}
            style={{
              flex: 1,
              padding: '14px 16px',
              borderRadius: 14,
              background: 'linear-gradient(135deg, #7c5cff 0%, #a855f7 100%)',
              border: 'none',
              color: '#fff',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {t.share}
          </button>
        </div>
      </section>

      {/* Stats */}
      <section style={{ padding: '24px 16px 0' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: 16,
            borderRadius: 16,
            background: 'linear-gradient(135deg, rgba(124,92,255,0.15), rgba(168,85,247,0.08))',
            border: '1px solid rgba(124,92,255,0.3)',
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #7c5cff 0%, #a855f7 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 24,
              flexShrink: 0,
            }}
          >
            👥
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 12, color: '#8b8b9e', margin: 0 }}>
              {t.verifiedFriends}
            </p>
            <p style={{ fontSize: 24, fontWeight: 800, color: '#fff', margin: '2px 0 0 0' }}>
              {user.total_referrals || 0}
            </p>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#22c55e', textAlign: 'right' }}>
            +{earnedGems} 💎
          </div>
        </div>
      </section>

      {/* How it works */}
      <section style={{ padding: '24px 16px' }}>
        <div
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 16,
            padding: 16,
          }}
        >
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, marginTop: 0 }}>
            {t.howItWorks}
          </h3>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {[
              { n: '1', text: t.step1 },
              { n: '2', text: t.step2 },
              { n: '3', text: t.step3 },
            ].map((step) => (
              <li key={step.n} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #7c5cff 0%, #a855f7 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 700,
                    flexShrink: 0,
                    color: '#fff',
                  }}
                >
                  {step.n}
                </div>
                <p style={{ fontSize: 13, color: '#c4b5fd', margin: 0, lineHeight: 1.5 }}>
                  {step.text}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  )
}
