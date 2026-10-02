"use client"

import { useState, useEffect, useMemo } from 'react'
import { useUser } from '@/lib/UserContext'
import { getTranslations } from '@/lib/i18n'
import { tgFetch } from '@/lib/telegram-fetch'
import {
  BASE_DAILY_GEMS,
  GEMS_PER_REFERRAL,
  REFERRAL_PURCHASE_COMMISSION_PCT,
  REFERRAL_TOP_TIER_THRESHOLD,
  REFERRAL_TOP_TIER_PCT,
  REFERRAL_ELITE_TIER_THRESHOLD,
  REFERRAL_ELITE_TIER_PCT,
} from '@/lib/constants'

export default function RewardsPage() {
  const { user, loading: userLoading, lang, refresh, isTelegram } = useUser()
  const [copied, setCopied] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const [claiming, setClaiming] = useState(false)
  const [claimResult, setClaimResult] = useState<any>(null)
  const [claimError, setClaimError] = useState<string | null>(null)
  const [showClaimModal, setShowClaimModal] = useState(false)

  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(interval)
  }, [])

  const t = getTranslations(lang)

  useEffect(() => {
    if (user) return
    const to = setTimeout(() => setTimedOut(true), 6000)
    return () => clearTimeout(to)
  }, [user])

  const claimState = useMemo(() => {
    if (!user) {
      return { canClaim: false, hoursRemaining: 0, minutesRemaining: 0 }
    }
    if (!user.last_daily_claim) {
      return { canClaim: true, hoursRemaining: 0, minutesRemaining: 0 }
    }
    const hoursSince =
      (now - new Date(user.last_daily_claim).getTime()) / 3_600_000
    if (hoursSince >= 24) {
      return { canClaim: true, hoursRemaining: 0, minutesRemaining: 0 }
    }
    const totalMinutes = Math.ceil((24 - hoursSince) * 60)
    return {
      canClaim: false,
      hoursRemaining: Math.floor(totalMinutes / 60),
      minutesRemaining: totalMinutes % 60,
    }
  }, [user, now])

  // ✅ 3 gemas planas — sin racha
  const previewGems = BASE_DAILY_GEMS

  const handleRetry = async () => {
    setRetrying(true)
    setTimedOut(false)
    try {
      await refresh()
    } catch (e) {
      console.error(e)
    } finally {
      setRetrying(false)
      setTimeout(() => setTimedOut(true), 6000)
    }
  }

  const handleClaim = async () => {
    if (!user || claiming || !claimState.canClaim) return
    setClaiming(true)
    setClaimError(null)
    try {
      const res = await tgFetch('/api/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()

      if (res.ok) {
        setClaimResult(data)
        setShowClaimModal(true)
        await refresh()
      } else if (res.status === 429) {
        setClaimError(data.error || 'Come back later')
        await refresh()
      } else {
        setClaimError(data.error || data.detail || t.dailyClaimError)
      }
    } catch (e: any) {
      console.error('[rewards] claim error:', e)
      setClaimError(e?.message || t.dailyClaimError)
    } finally {
      setClaiming(false)
    }
  }

  const handleCopy = async () => {
    if (!user) return
    const refCode = user.username || user.referral_code
    // ✅ Link pasa por el bot (?start=)
    const link = `https://t.me/TabooRealmBot?start=${refCode}`
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
    // ✅ Link pasa por el bot (?start=)
    const referralLink = `https://t.me/TabooRealmBot?start=${refCode}`
    const shareText =
      lang === 'es'
        ? '¡Mira esta app! Chatea con personajes IA 🔥'
        : 'Check this app out! Chat with AI characters 🔥'

    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(
      referralLink
    )}&text=${encodeURIComponent(shareText)}`

    import('@twa-dev/sdk')
      .then((mod) => {
        const WebApp = mod.default
        try {
          WebApp.openTelegramLink(shareUrl)
        } catch {
          window.open(shareUrl, '_blank')
        }
      })
      .catch(() => {
        window.open(shareUrl, '_blank')
      })
  }

  if (userLoading && !timedOut && !user) {
    return (
      <div className="spinner-full">
        <div className="spinner" />
      </div>
    )
  }

  if (!user) {
    const noTelegram = !isTelegram
    return (
      <div className="page">
        <header className="page-header">
          <h1 className="page-title">{t.dailyClaimRewardsTitle}</h1>
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
              ? lang === 'es'
                ? 'Abre desde Telegram'
                : 'Open from Telegram'
              : lang === 'es'
              ? 'Cargando tu cuenta...'
              : 'Loading your account...'}
          </h2>

          <p
            style={{
              color: '#8b8b9e',
              margin: 0,
              fontSize: 14,
              maxWidth: 300,
              lineHeight: 1.5,
            }}
          >
            {noTelegram
              ? lang === 'es'
                ? 'Abre esta Mini App desde el bot en Telegram.'
                : 'Open this Mini App from the bot in Telegram.'
              : lang === 'es'
              ? 'Hubo un problema de conexión. Reintenta o envía /start al bot.'
              : 'There was a connection issue. Retry or send /start to the bot.'}
          </p>

          {!noTelegram && (
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="btn-primary"
              style={{ opacity: retrying ? 0.6 : 1 }}
            >
              {retrying
                ? lang === 'es'
                  ? 'Cargando...'
                  : 'Loading...'
                : lang === 'es'
                ? 'Reintentar'
                : 'Retry'}
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

  const refCode = user.username || user.referral_code
  // ✅ Link pasa por el bot
  const referralLink = `https://t.me/TabooRealmBot?start=${refCode}`
  const earnedGems = (user.total_referrals || 0) * GEMS_PER_REFERRAL
  const payingCount = user.paying_referrals_count || 0

  // ✅ Calcular tier actual
  let currentPct = REFERRAL_PURCHASE_COMMISSION_PCT
  let nextTierAt: number | null = REFERRAL_TOP_TIER_THRESHOLD
  let nextTierPct: number | null = REFERRAL_TOP_TIER_PCT
  if (payingCount >= REFERRAL_ELITE_TIER_THRESHOLD) {
    currentPct = REFERRAL_ELITE_TIER_PCT
    nextTierAt = null
    nextTierPct = null
  } else if (payingCount >= REFERRAL_TOP_TIER_THRESHOLD) {
    currentPct = REFERRAL_TOP_TIER_PCT
    nextTierAt = REFERRAL_ELITE_TIER_THRESHOLD
    nextTierPct = REFERRAL_ELITE_TIER_PCT
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">{t.dailyClaimRewardsTitle}</h1>
      </header>

      {/* ═══════════════════════════════════════════════
          SECCIÓN 1: RECLAMO DIARIO
      ═══════════════════════════════════════════════ */}
      <section style={{ padding: '20px 16px 0' }}>
        <div
          style={{
            position: 'relative',
            padding: 24,
            borderRadius: 24,
            overflow: 'hidden',
            background: claimState.canClaim
              ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 50%, #15803d 100%)'
              : 'linear-gradient(135deg, #1f1733 0%, #2a1f3d 100%)',
            border: claimState.canClaim
              ? '1px solid rgba(34, 197, 94, 0.4)'
              : '1px solid rgba(168, 85, 247, 0.2)',
            boxShadow: claimState.canClaim
              ? '0 12px 40px rgba(34, 197, 94, 0.35)'
              : 'none',
            transition: 'all 0.3s ease',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginBottom: 8,
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: claimState.canClaim
                  ? 'rgba(255,255,255,0.25)'
                  : 'linear-gradient(135deg, #7c5cff 0%, #a855f7 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                flexShrink: 0,
              }}
            >
              🎁
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2
                style={{
                  fontSize: 18,
                  fontWeight: 900,
                  color: '#fff',
                  margin: 0,
                  lineHeight: 1.2,
                }}
              >
                {t.dailyClaimTitle}
              </h2>
              <p
                style={{
                  fontSize: 12,
                  color: claimState.canClaim
                    ? 'rgba(255,255,255,0.85)'
                    : '#a395c9',
                  margin: '2px 0 0 0',
                  lineHeight: 1.3,
                }}
              >
                {lang === 'es'
                  ? 'Entra cada día y recibe gemas gratis'
                  : 'Come back every day for free gems'}
              </p>
            </div>
          </div>

          {claimState.canClaim ? (
            <>
              <p
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#fff',
                  margin: '20px 0 12px 0',
                  textAlign: 'center',
                  textShadow: '0 1px 4px rgba(0,0,0,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <span>✨ {t.dailyClaimReady} ~{previewGems}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M12 3l3 5h5l-8 13L4 8h5l3-5z" fill="#fff" />
                </svg>
              </p>
              <button
                onClick={handleClaim}
                disabled={claiming}
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  borderRadius: 14,
                  background: '#fff',
                  border: 'none',
                  color: '#16a34a',
                  fontSize: 15,
                  fontWeight: 900,
                  cursor: claiming ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                  opacity: claiming ? 0.7 : 1,
                  transition: 'all 0.2s ease',
                }}
              >
                {claiming ? t.dailyClaimClaiming : `🎁 ${t.dailyClaimButton}`}
              </button>
            </>
          ) : (
            <div
              style={{
                marginTop: 20,
                padding: 14,
                borderRadius: 14,
                background: 'rgba(0,0,0,0.25)',
                border: '1px solid rgba(168, 85, 247, 0.15)',
                textAlign: 'center',
              }}
            >
              <p
                style={{
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  fontWeight: 700,
                  color: '#a395c9',
                  margin: '0 0 4px 0',
                }}
              >
                {t.dailyClaimNext}
              </p>
              <p
                style={{
                  fontSize: 20,
                  fontWeight: 900,
                  color: '#fff',
                  margin: 0,
                }}
              >
                {claimState.hoursRemaining}
                {t.dailyClaimHoursShort} {claimState.minutesRemaining}
                {t.dailyClaimMinutesShort}
              </p>
            </div>
          )}

          {claimError && (
            <p
              style={{
                fontSize: 12,
                color: '#fecaca',
                margin: '12px 0 0 0',
                textAlign: 'center',
              }}
            >
              ⚠️ {claimError}
            </p>
          )}
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          SECCIÓN 2: INVITAR AMIGOS
      ═══════════════════════════════════════════════ */}
      <section style={{ padding: '24px 16px 0' }}>
        <div
          style={{
            padding: 24,
            borderRadius: 24,
            background:
              'linear-gradient(135deg, #7c5cff 0%, #a855f7 50%, #d946ef 100%)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 12 }}>🎁</div>
          <h2
            style={{
              fontSize: 22,
              fontWeight: 900,
              color: '#fff',
              margin: '0 0 6px 0',
            }}
          >
            {t.inviteTitle}
          </h2>
          <p
            style={{
              fontSize: 14,
              color: 'rgba(255,255,255,0.85)',
              margin: 0,
              maxWidth: 280,
              marginLeft: 'auto',
              marginRight: 'auto',
              lineHeight: 1.45,
            }}
          >
            {lang === 'es'
              ? `Gana ${GEMS_PER_REFERRAL} gemas por cada amigo + ${currentPct}% de sus compras`
              : `Earn ${GEMS_PER_REFERRAL} gems per friend + ${currentPct}% of their purchases`}
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          TIER DE COMISIÓN
      ═══════════════════════════════════════════════ */}
      <section style={{ padding: '16px 16px 0' }}>
        <div
          style={{
            padding: 16,
            borderRadius: 16,
            background:
              'linear-gradient(135deg, rgba(124,92,255,0.15), rgba(168,85,247,0.08))',
            border: '1px solid rgba(124,92,255,0.3)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <p
              style={{
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                fontWeight: 700,
                color: '#a78bfa',
                margin: 0,
              }}
            >
              {lang === 'es' ? 'Tu comisión' : 'Your commission'}
            </p>
            <p
              style={{
                fontSize: 22,
                fontWeight: 900,
                color: '#22c55e',
                margin: 0,
              }}
            >
              {currentPct}%
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11,
              color: '#8b8b9e',
              marginBottom: 6,
            }}
          >
            <span>
              {lang === 'es' ? 'Amigos que han comprado' : 'Friends who bought'}
            </span>
            <span style={{ color: '#fff', fontWeight: 700 }}>{payingCount}</span>
          </div>

          {/* Barra de progreso al siguiente tier */}
          {nextTierAt !== null && nextTierPct !== null && (
            <>
              <div
                style={{
                  height: 4,
                  background: 'rgba(168, 85, 247, 0.15)',
                  borderRadius: 2,
                  overflow: 'hidden',
                  marginTop: 8,
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, (payingCount / nextTierAt) * 100)}%`,
                    background: 'linear-gradient(90deg, #a855f7, #ec4899)',
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
              <p
                style={{
                  fontSize: 10,
                  color: '#a395c9',
                  margin: '6px 0 0 0',
                  textAlign: 'center',
                }}
              >
                {lang === 'es'
                  ? `${nextTierAt - payingCount} más para subir a ${nextTierPct}%`
                  : `${nextTierAt - payingCount} more to reach ${nextTierPct}%`}
              </p>
            </>
          )}

          {nextTierAt === null && (
            <p
              style={{
                fontSize: 10,
                color: '#22c55e',
                margin: '8px 0 0 0',
                textAlign: 'center',
                fontWeight: 700,
              }}
            >
              🏆 {lang === 'es' ? '¡Tier máximo alcanzado!' : 'Max tier reached!'}
            </p>
          )}
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          LINK DE REFERIDO
      ═══════════════════════════════════════════════ */}
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
              <rect
                x="9"
                y="9"
                width="12"
                height="12"
                rx="2"
                stroke="currentColor"
                strokeWidth="2"
              />
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

      {/* ═══════════════════════════════════════════════
          VERIFIED FRIENDS
      ═══════════════════════════════════════════════ */}
      <section style={{ padding: '24px 16px 0' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: 16,
            borderRadius: 16,
            background:
              'linear-gradient(135deg, rgba(124,92,255,0.15), rgba(168,85,247,0.08))',
            border: '1px solid rgba(124,92,255,0.3)',
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background:
                'linear-gradient(135deg, #7c5cff 0%, #a855f7 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 24,
              flexShrink: 0,
            }}
          >
            👥
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 12, color: '#8b8b9e', margin: 0 }}>
              {t.verifiedFriends}
            </p>
            <p
              style={{
                fontSize: 24,
                fontWeight: 800,
                color: '#fff',
                margin: '2px 0 0 0',
              }}
            >
              {user.total_referrals || 0}
            </p>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              fontWeight: 700,
              color: '#22c55e',
              textAlign: 'right',
              flexShrink: 0,
            }}
          >
            <span>+{earnedGems}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 3l3 5h5l-8 13L4 8h5l3-5z" fill="#22c55e" />
            </svg>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          HOW IT WORKS
      ═══════════════════════════════════════════════ */}
      <section style={{ padding: '24px 16px' }}>
        <div
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 16,
            padding: 16,
          }}
        >
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 12,
              marginTop: 0,
            }}
          >
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
              {
                n: '1',
                text: lang === 'es'
                  ? 'Comparte tu enlace con un amigo'
                  : 'Share your link with a friend',
              },
              {
                n: '2',
                text: lang === 'es'
                  ? 'Tu amigo abre el link y chatea 3 mensajes'
                  : 'Your friend opens the link and sends 3 messages',
              },
              {
                n: '3',
                text: lang === 'es'
                  ? `Ganas ${GEMS_PER_REFERRAL} gemas al instante`
                  : `You earn ${GEMS_PER_REFERRAL} gems instantly`,
              },
              {
                n: '4',
                text: lang === 'es'
                  ? `+ ${currentPct}% de CADA compra que haga (para siempre)`
                  : `+ ${currentPct}% of EVERY purchase they make (forever)`,
              },
              {
                n: '5',
                text: lang === 'es'
                  ? `Con 5+ amigos comprando → ${REFERRAL_TOP_TIER_PCT}% · Con 20+ → ${REFERRAL_ELITE_TIER_PCT}%`
                  : `With 5+ friends buying → ${REFERRAL_TOP_TIER_PCT}% · With 20+ → ${REFERRAL_ELITE_TIER_PCT}%`,
              },
            ].map((step) => (
              <li
                key={step.n}
                style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background:
                      'linear-gradient(135deg, #7c5cff 0%, #a855f7 100%)',
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
                <p
                  style={{
                    fontSize: 13,
                    color: '#c4b5fd',
                    margin: 0,
                    lineHeight: 1.5,
                  }}
                >
                  {step.text}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          MODAL DE RECLAMO
      ═══════════════════════════════════════════════ */}
      {showClaimModal && claimResult && (
        <div className="modal-backdrop">
          <div className="modal-box">
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: 20,
                margin: '0 auto 16px',
                background:
                  'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 36,
                boxShadow: '0 8px 32px rgba(34, 197, 94, 0.4)',
              }}
            >
              🎉
            </div>
            <h3
              className="modal-title"
              style={{ textAlign: 'center', fontSize: 20, marginBottom: 4 }}
            >
              {t.dailyClaimYouGot} {claimResult.claimed} {t.dailyClaimGems}
            </h3>

            <div
              style={{
                marginTop: 16,
                marginBottom: 20,
                padding: 16,
                borderRadius: 14,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                textAlign: 'center',
              }}
            >
              <p style={{ fontSize: 13, color: '#a395c9', margin: '0 0 4px 0' }}>
                {lang === 'es' ? 'Nuevo balance' : 'New balance'}
              </p>
              <p
                style={{
                  fontSize: 28,
                  fontWeight: 900,
                  color: '#22c55e',
                  margin: 0,
                }}
              >
                {claimResult.gems}
              </p>
            </div>

            <button
              onClick={() => setShowClaimModal(false)}
              className="modal-btn primary"
              style={{ width: '100%' }}
            >
              {t.dailyClaimGreat}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
