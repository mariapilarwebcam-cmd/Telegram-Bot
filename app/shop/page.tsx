"use client"

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { STAR_PACKAGES } from '@/lib/constants'
import { getTranslations, getLanguage, Language } from '@/lib/i18n'

export default function ShopPage() {
  const [user, setUser] = useState<any>(null)
  const [gems, setGems] = useState(0)
  const [loading, setLoading] = useState(true)
  const [purchasing, setPurchasing] = useState<number | null>(null)
  const [lang, setLang] = useState<Language>('es')
  const [hasPurchased, setHasPurchased] = useState(false)

  useEffect(() => {
    import('@twa-dev/sdk').then((mod) => {
      const WebApp = mod.default
      WebApp.ready()
      WebApp.expand()
      const u = WebApp.initDataUnsafe?.user
      if (u?.id) {
        setLang(getLanguage(u.language_code))
        load(u.id)
      } else setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const load = async (telegramId: number) => {
    const tid = telegramId.toString()
    try {
      const { data } = await supabase.from('users').select('*').eq('telegram_id', tid).maybeSingle()
      if (data) {
        setUser(data)
        setGems(data.gems || 0)
      }
      const { data: purchases } = await supabase
        .from('star_purchases').select('id').eq('telegram_id', tid).limit(1)
      setHasPurchased(!!purchases && purchases.length > 0)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const buy = async (idx: number) => {
    if (!user) return
    setPurchasing(idx)
    try {
      const res = await fetch('/api/create-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: user.telegram_id.toString(),
          package_id: idx,
        }),
      })
      const data = await res.json()
      if (res.ok && data.invoice_link) {
        import('@twa-dev/sdk').then((mod) => {
          const WebApp = mod.default
          WebApp.openInvoice(data.invoice_link, async (status: string) => {
            if (status === 'paid') await load(Number(user.telegram_id))
            setPurchasing(null)
          })
        })
      } else {
        alert(data.error || t.errorGeneric)
        setPurchasing(null)
      }
    } catch {
      alert(t.errorConnection)
      setPurchasing(null)
    }
  }

  const t = getTranslations(lang)

  if (loading) {
    return (
      <div className="spinner-full">
        <div className="spinner" />
      </div>
    )
  }

  const visiblePackages = STAR_PACKAGES
    .map((pkg, idx) => ({ ...pkg, originalIndex: idx }))
    .filter(p => !p.first_time_only || !hasPurchased)

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">{t.shop}</h1>
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

      {/* Premium banner */}
      <section style={{ padding: '20px 16px 0' }}>
        <div
          style={{
            position: 'relative',
            borderRadius: 24,
            overflow: 'hidden',
            padding: 20,
            background: 'linear-gradient(135deg, #7c5cff 0%, #a855f7 50%, #d946ef 100%)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              background: 'rgba(255,255,255,0.2)',
              backdropFilter: 'blur(8px)',
              fontSize: 10,
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: 20,
              color: '#fff',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {t.premiumBanner}
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 900, color: '#fff', margin: '0 0 4px 0' }}>
            {t.premiumTitle}
          </h2>
          <p
            style={{
              fontSize: 14,
              color: 'rgba(255,255,255,0.8)',
              margin: 0,
              maxWidth: '75%',
            }}
          >
            {t.premiumDesc}
          </p>
        </div>
      </section>

      {/* Packages */}
      <section style={{ padding: '24px 16px 0' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{t.packages}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visiblePackages.map((pkg) => {
            const idx = pkg.originalIndex
            const isFirstTime = pkg.first_time_only
            const bonusGems = pkg.bonus > 0 ? Math.floor(pkg.gems * pkg.bonus / 100) : 0

            return (
              <button
                key={idx}
                onClick={() => buy(idx)}
                disabled={purchasing !== null}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 16,
                  borderRadius: 16,
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  color: 'inherit',
                  background: isFirstTime
                    ? 'linear-gradient(90deg, rgba(34,197,94,0.15), rgba(34,197,94,0.05))'
                    : 'rgba(255,255,255,0.03)',
                  border: isFirstTime
                    ? '1px solid rgba(34,197,94,0.4)'
                    : '1px solid rgba(255,255,255,0.06)',
                  opacity: purchasing !== null ? 0.5 : 1,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: isFirstTime
                      ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
                      : 'linear-gradient(135deg, #7c5cff 0%, #a855f7 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M12 3l3 5h5l-8 13L4 8h5l3-5z" fill="#fff" />
                  </svg>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <p style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>
                      {pkg.gems} {t.gems}
                    </p>
                    {bonusGems > 0 && (
                      <span
                        style={{
                          fontSize: 13,
                          color: '#22c55e',
                          fontWeight: 700,
                        }}
                      >
                        + {bonusGems} {t.bonusGems}
                      </span>
                    )}
                    {isFirstTime && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          background: '#22c55e',
                          color: '#fff',
                          padding: '2px 6px',
                          borderRadius: 4,
                        }}
                      >
                        {t.firstTime}
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  <p style={{ fontWeight: 700, fontSize: 14, margin: 0 }}>{pkg.stars}</p>
                  <p style={{ fontSize: 10, color: '#8b8b9e', textTransform: 'uppercase', margin: 0 }}>
                    Stars
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {/* Info */}
      <section style={{ padding: '24px 16px' }}>
        <div
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 16,
            padding: 16,
          }}
        >
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{t.howItWorks}</h3>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              fontSize: 14,
              color: '#8b8b9e',
            }}
          >
            {[
              { label: t.chatCost, cost: `1 ${t.gems}` },
              { label: t.audioCost, cost: `5 ${t.gems}` },
              { label: t.imageCost, cost: `10 ${t.gems}` },
              { label: t.renameCost, cost: `3 ${t.gems}` },
            ].map((row, i) => (
              <li key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{row.label}</span>
                <span style={{ color: '#fff', fontWeight: 600 }}>{row.cost}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  )
}
