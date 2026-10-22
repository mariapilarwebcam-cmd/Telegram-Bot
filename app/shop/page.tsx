"use client"

import { useEffect, useState, useRef } from 'react'
import { tgFetch } from '@/lib/telegram-fetch'
import {
  STAR_PACKAGES,
  CRYPTO_PACKAGES,
  VIP_PLANS,
  getFinalGems,
  getFinalCryptoGems,
  type VipPlanId,
} from '@/lib/constants'
import { getTranslations } from '@/lib/i18n'
import { useUser } from '@/lib/UserContext'
import { useTonPay } from '@ton-pay/ui-react'
import { createTonPayTransfer, USDT } from '@ton-pay/api'
import { Analytics } from '@/lib/posthog'
import { AnimatedNumber } from '@/components/AnimatedNumber'

const purchaseCache: Record<string, boolean> = {}

export default function ShopPage() {
  const { user, loading: userLoading, lang, refresh } = useUser()
  const [purchasing, setPurchasing] = useState<number | null>(null)
  const [hasPurchased, setHasPurchased] = useState(false)
  const [checking, setChecking] = useState(true)
  const [paymentMethod, setPaymentMethod] = useState<'stars' | 'crypto'>('stars')
  const [pendingReference, setPendingReference] = useState<string | null>(null)
  const [pendingStatus, setPendingStatus] = useState<string>('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [vipSub, setVipSub] = useState<{ active: boolean; subscription: any } | null>(null)
  const [vipLoading, setVipLoading] = useState(true)
  const [vipPurchasing, setVipPurchasing] = useState<string | null>(null)
  const [showVipSuccess, setShowVipSuccess] = useState(false)

  const [vipPendingRef, setVipPendingRef] = useState<string | null>(null)
  const [vipPendingStatus, setVipPendingStatus] = useState<string>('')
  const vipPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const { pay } = useTonPay()
  const t = getTranslations(lang)

  useEffect(() => {
    if (!user?.telegram_id) {
      if (!userLoading) setVipLoading(false)
      return
    }
    loadVipStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.telegram_id, userLoading])

  const loadVipStatus = async () => {
    try {
      const res = await tgFetch('/api/subscription')
      if (res.ok) {
        const data = await res.json()
        setVipSub(data)
        Analytics.vipPageViewed({ is_vip: !!data.active })
      }
    } catch (e) {
      console.warn('[shop] vip status error:', e)
    } finally {
      setVipLoading(false)
    }
  }

  const buyVipWithStars = async (planId: VipPlanId) => {
    if (!user || vipPurchasing) return
    setVipPurchasing(planId)

    try {
      const res = await tgFetch('/api/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_invoice', plan: planId }),
      })
      const data = await res.json()

      if (!res.ok || !data.invoice_link) {
        alert(data.error || 'Error creando factura')
        setVipPurchasing(null)
        return
      }

      const mod = await import('@twa-dev/sdk')
      const WebApp = mod.default

      WebApp.openInvoice(data.invoice_link, async (status: string) => {
        if (status === 'paid') {
          let attempts = 0;
          const checkSub = setInterval(async () => {
             attempts++;
             await loadVipStatus();
             if (attempts >= 4) {
               clearInterval(checkSub);
               setVipPurchasing(null);
             }
          }, 2000);
        } else if (status === 'failed') {
          alert(lang === 'es' ? 'Pago fallido' : 'Payment failed')
          setVipPurchasing(null)
        } else {
          setVipPurchasing(null)
        }
      })
    } catch (e: any) {
      alert('Error: ' + (e?.message || 'desconocido'))
      setVipPurchasing(null)
    }
  }

  const buyVipWithCrypto = async (planId: VipPlanId) => {
    if (!user || vipPurchasing) return
    setVipPurchasing(planId)

    try {
      const res = await tgFetch('/api/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_crypto_invoice', plan: planId }),
      })
      const data = await res.json()

      if (!res.ok || !data.payment_data) {
        alert(data.error || 'Error creando pago crypto')
        setVipPurchasing(null)
        return
      }

      const { payment_data } = data

      try {
        const result = await pay(async (senderAddr: string) => {
          const transfer = await createTonPayTransfer(
            {
              amount: payment_data.amountUnits,
              asset: USDT,
              recipientAddr: payment_data.recipientAddr,
              senderAddr,
              commentToRecipient: payment_data.reference,
              commentToSender: `Taboo Realm VIP — ${payment_data.amount} USDT`,
            },
            { chain: 'mainnet' }
          )
          return {
            message: transfer.message,
            reference: transfer.reference,
            bodyBase64Hash: transfer.bodyBase64Hash,
          }
        })

        console.log('[shop] vip crypto sent:', result)
        startVipPolling(planId, payment_data.reference)
      } catch (cryptoErr: any) {
        console.error('[shop] vip crypto error:', cryptoErr)
        const msg = cryptoErr?.message || cryptoErr?.toString() || String(cryptoErr)
        
        // ✅ FIX: Mostrar el error real para saber qué falla
        if (!msg.toLowerCase().includes('user rejected') && !msg.toLowerCase().includes('cancel')) {
          alert(`ERROR TON PAY VIP:\n\n${msg}`)
        }
      } finally {
        setVipPurchasing(null)
      }
    } catch (e: any) {
      alert('Error: ' + (e?.message || 'desconocido'))
      setVipPurchasing(null)
    }
  }

  const startVipPolling = (planId: VipPlanId, reference: string) => {
    setVipPendingRef(reference)
    setVipPendingStatus(lang === 'es' ? 'Verificando pago VIP…' : 'Verifying VIP payment…')

    let attempts = 0
    const MAX_ATTEMPTS = 25

    vipPollRef.current = setInterval(async () => {
      attempts++
      if (attempts > MAX_ATTEMPTS) {
        stopVipPolling()
        alert(lang === 'es' ? 'No hemos detectado el pago todavía. Si ya pagaste, contacta soporte.' : "We haven't detected the payment yet. If you already paid, contact support.")
        return
      }

      try {
        const res = await tgFetch('/api/subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'confirm_crypto', plan: planId, reference }),
        })
        const data = await res.json()

        if (data.status === 'paid') {
          stopVipPolling()
          setShowVipSuccess(true)
          await loadVipStatus()
          await refresh()
          setTimeout(() => setShowVipSuccess(false), 5000)

          const plan = VIP_PLANS.find((p) => p.id === planId)
          if (plan) {
            Analytics.vipPurchased({
              plan: planId,
              method: 'crypto',
              price_usd: plan.crypto_price,
              stars: plan.stars,
            })
          }
        } else {
          setVipPendingStatus(lang === 'es' ? `Confirmando en la blockchain… (${attempts}/${MAX_ATTEMPTS})` : `Confirming on-chain… (${attempts}/${MAX_ATTEMPTS})`)
        }
      } catch (e) {
        console.error('[shop] vip poll error:', e)
      }
    }, 4000)
  }

  const stopVipPolling = () => {
    if (vipPollRef.current) {
      clearInterval(vipPollRef.current)
      vipPollRef.current = null
    }
    setVipPendingRef(null)
    setVipPendingStatus('')
  }

  const cancelVip = async () => {
    const confirmed = confirm(lang === 'es' ? '¿Cancelar tu suscripción VIP? Mantendrás acceso hasta la fecha de expiración.' : 'Cancel your VIP subscription? You will keep access until the expiration date.')
    if (!confirmed) return

    try {
      const res = await tgFetch('/api/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      })
      const data = await res.json()
      if (res.ok) {
        alert(lang === 'es' ? '✅ Suscripción cancelada. Mantienes acceso VIP hasta que expire.' : '✅ Subscription cancelled. You keep VIP access until it expires.')
        await loadVipStatus()
      } else {
        alert(data.error || 'Error')
      }
    } catch (e: any) {
      alert('Error: ' + (e?.message || 'desconocido'))
    }
  }

  useEffect(() => {
    if (!user?.telegram_id) {
      if (!userLoading) setChecking(false)
      return
    }

    if (purchaseCache[user.telegram_id] !== undefined) {
      setHasPurchased(purchaseCache[user.telegram_id])
      setChecking(false)
      return
    }

    let cancelled = false

    tgFetch('/api/is-premium')
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) {
          setChecking(false)
          return
        }
        const data = await res.json()
        const has = !!data.has_purchased
        purchaseCache[user.telegram_id] = has
        setHasPurchased(has)
        setChecking(false)
      })
      .catch((e) => {
        if (!cancelled) {
          console.warn('[shop] is-premium error:', e)
          setChecking(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [user?.telegram_id, userLoading])

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      if (vipPollRef.current) {
        clearInterval(vipPollRef.current)
        vipPollRef.current = null
      }
    }
  }, [])

  const buyWithStars = async (idx: number) => {
    if (!user) return
    setPurchasing(idx)
    try {
      const res = await tgFetch('/api/create-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package_id: idx }),
      })
      const data = await res.json()
      if (res.ok && data.invoice_link) {
        import('@twa-dev/sdk').then((mod) => {
          const WebApp = mod.default
          WebApp.openInvoice(data.invoice_link, async (status: string) => {
            if (status === 'paid') {
              let attempts = 0;
              const checkBalance = setInterval(async () => {
                attempts++;
                await refresh();
                if (attempts >= 3) {
                  clearInterval(checkBalance);
                  setPurchasing(null);
                }
              }, 1500);

              if (user.telegram_id) purchaseCache[user.telegram_id] = true
              setHasPurchased(true)

              const pkg = STAR_PACKAGES[idx]
              if (pkg) {
                Analytics.gemsPurchased({
                  package_index: idx,
                  gems: getFinalGems(pkg),
                  method: 'stars',
                  amount: pkg.stars,
                })
              }
            } else {
              setPurchasing(null)
            }
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

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    setPendingReference(null)
    setPendingStatus('')
  }

  const startPolling = (reference: string, pkgIndex: number) => {
    setPendingReference(reference)
    setPendingStatus(lang === 'es' ? 'Verificando pago…' : 'Verifying payment…')

    let attempts = 0
    const MAX_ATTEMPTS = 20

    pollRef.current = setInterval(async () => {
      attempts++
      if (attempts > MAX_ATTEMPTS) {
        stopPolling()
        alert(lang === 'es' ? 'No hemos detectado el pago todavía. Si ya pagaste, contacta soporte.' : "We haven't detected the payment yet. If you already paid, contact support.")
        return
      }

      try {
        const res = await tgFetch('/api/check-crypto-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reference }),
        })
        const data = await res.json()

        if (data.status === 'paid') {
          stopPolling()
          await refresh()
          if (user?.telegram_id) purchaseCache[user.telegram_id] = true
          setHasPurchased(true)

          const pkg = CRYPTO_PACKAGES[pkgIndex]
          if (pkg) {
            Analytics.gemsPurchased({
              package_index: pkgIndex,
              gems: getFinalCryptoGems(pkg),
              method: 'crypto',
              amount: pkg.usdt,
            })
          }

          alert(lang === 'es' ? `✅ Pago confirmado. +${data.gems_added} gemas acreditadas.` : `✅ Payment confirmed. +${data.gems_added} gems credited.`)
        } else {
          setPendingStatus(lang === 'es' ? `Confirmando en la blockchain… (${attempts}/${MAX_ATTEMPTS})` : `Confirming on-chain… (${attempts}/${MAX_ATTEMPTS})`)
        }
      } catch (e) {
        console.error('[shop] poll error:', e)
      }
    }, 4000)
  }

  const buyWithCrypto = async (idx: number) => {
    if (!user) return
    setPurchasing(idx)
    try {
      const res = await tgFetch('/api/create-crypto-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package_id: idx }),
      })
      const data = await res.json()
      if (!res.ok || !data.payment_data) {
        alert(data.error || 'Error creando pago')
        setPurchasing(null)
        return
      }

      const { payment_data } = data

      const result = await pay(async (senderAddr: string) => {
        const transfer = await createTonPayTransfer(
          {
            amount: payment_data.amountUnits,
            asset: USDT,
            recipientAddr: payment_data.recipientAddr,
            senderAddr,
            commentToRecipient: payment_data.reference,
            commentToSender: `Taboo Realm — ${payment_data.amount} USDT`,
          },
          { chain: 'mainnet' }
        )
        return {
          message: transfer.message,
          reference: transfer.reference,
          bodyBase64Hash: transfer.bodyBase64Hash,
        }
      })

      console.log('[shop] crypto payment sent:', result)
      startPolling(payment_data.reference, idx)
    } catch (e: any) {
      console.error('[shop] crypto error:', e)
      const msg = e?.message || e?.toString() || String(e)
      
      // ✅ FIX: Mostrar el error real
      if (msg.toLowerCase().includes('user rejected') || msg.toLowerCase().includes('cancel')) {
        // cancelado
      } else {
        alert(`ERROR TON PAY GEMAS:\n\n${msg}`)
      }
    } finally {
      setPurchasing(null)
    }
  }

  if (userLoading && !user) {
    return (
      <div className="spinner-full">
        <div className="spinner" />
      </div>
    )
  }

  const gems = user?.gems || 0

  const visibleStarsPackages = STAR_PACKAGES
    .map((pkg, idx) => ({ ...pkg, originalIndex: idx }))
    .filter((p) => {
      if (!p.first_time_only) return true
      if (checking) return true
      return !hasPurchased
    })

  const visibleCryptoPackages = CRYPTO_PACKAGES
    .map((pkg, idx) => ({ ...pkg, originalIndex: idx }))
    .filter((p) => {
      if (!p.first_time_only) return true
      if (checking) return true
      return !hasPurchased
    })

  const isVipActive = !!vipSub?.active

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
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            <AnimatedNumber value={gems} />
          </span>
        </div>
      </header>

      <section style={{ padding: '20px 16px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 22 }}>👑</span>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
            Taboo Realm VIP
          </h2>
        </div>

        {vipPendingRef && (
          <div
            style={{
              marginBottom: 12,
              padding: 14,
              borderRadius: 14,
              background: 'linear-gradient(135deg, rgba(251,191,36,0.15), rgba(251,191,36,0.05))',
              border: '1px solid rgba(251, 191, 36, 0.4)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
            <p style={{ fontSize: 13, color: '#fbbf24', margin: 0, flex: 1 }}>
              {vipPendingStatus}
            </p>
          </div>
        )}

        {vipLoading ? (
          <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="spinner" />
          </div>
        ) : isVipActive ? (
          <div
            style={{
              padding: 20,
              borderRadius: 20,
              background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%)',
              boxShadow: '0 12px 40px rgba(251, 191, 36, 0.4)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: -20,
                right: -20,
                fontSize: 140,
                opacity: 0.15,
                pointerEvents: 'none',
              }}
            >
              👑
            </div>

            <div style={{ position: 'relative', zIndex: 1 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <span style={{ fontSize: 24 }}>✨</span>
                <div>
                  <p
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: '0.1em',
                      color: 'rgba(255,255,255,0.85)',
                      margin: 0,
                    }}
                  >
                    VIP ACTIVO
                  </p>
                  <h3
                    style={{
                      fontSize: 22,
                      fontWeight: 900,
                      color: '#fff',
                      margin: '2px 0 0 0',
                      textShadow: '0 2px 8px rgba(0,0,0,0.2)',
                    }}
                  >
                    {VIP_PLANS.find((p) => p.id === vipSub.subscription.plan)
                      ? VIP_PLANS.find((p) => p.id === vipSub.subscription.plan)!
                          .label[lang === 'es' ? 'es' : 'en']
                      : 'VIP'}
                  </h3>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: 16,
                  padding: 14,
                  borderRadius: 14,
                  background: 'rgba(0,0,0,0.15)',
                  backdropFilter: 'blur(8px)',
                }}
              >
                <div style={{ flex: 1 }}>
                  <p
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: 'rgba(255,255,255,0.75)',
                      margin: 0,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {lang === 'es' ? 'Días restantes' : 'Days left'}
                  </p>
                  <p
                    style={{
                      fontSize: 24,
                      fontWeight: 900,
                      color: '#fff',
                      margin: '2px 0 0 0',
                    }}
                  >
                    {vipSub.subscription.days_remaining}
                  </p>
                </div>
                <div style={{ flex: 1 }}>
                  <p
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: 'rgba(255,255,255,0.75)',
                      margin: 0,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {lang === 'es' ? 'Expira' : 'Expires'}
                  </p>
                  <p
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: '#fff',
                      margin: '6px 0 0 0',
                    }}
                  >
                    {new Date(
                      vipSub.subscription.expires_at.replace(' ', 'T') + 'Z'
                    ).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  onClick={() => buyVipWithStars(vipSub.subscription.plan)}
                  disabled={!!vipPurchasing || !!vipPendingRef}
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    borderRadius: 12,
                    background: '#fff',
                    border: 'none',
                    color: '#d97706',
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: vipPurchasing ? 'wait' : 'pointer',
                    fontFamily: 'inherit',
                    opacity: vipPurchasing ? 0.6 : 1,
                  }}
                >
                  ⭐ {lang === 'es' ? 'Extender' : 'Extend'}
                </button>
                <button
                  onClick={cancelVip}
                  disabled={!!vipPurchasing || !!vipPendingRef}
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    borderRadius: 12,
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid rgba(255,255,255,0.3)',
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {lang === 'es' ? 'Cancelar' : 'Cancel'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div
              style={{
                fontSize: 13,
                color: '#c4b5fd',
                margin: '0 0 16px 0',
                lineHeight: 1.7,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {lang === 'es' ? (
                <>
                  <div>📨 <strong style={{ color: '#f5f0ff' }}>6.000 mensajes/mes</strong></div>
                  <div>📸 <strong style={{ color: '#f5f0ff' }}>30 imágenes IA premium/mes</strong> <span style={{ color: '#8b8b9e' }}>(acumula hasta 5)</span></div>
                  <div>🎨 <strong style={{ color: '#f5f0ff' }}>Hasta 300 imágenes SFW/mes</strong></div>
                  <div>🎧 <strong style={{ color: '#f5f0ff' }}>1 audio gratis/día</strong> <span style={{ color: '#8b8b9e' }}>(acumula hasta 5)</span></div>
                  <div>👑 <strong style={{ color: '#f5f0ff' }}>18 personajes exclusivos</strong></div>
                </>
              ) : (
                <>
                  <div>📨 <strong style={{ color: '#f5f0ff' }}>6,000 messages/month</strong></div>
                  <div>📸 <strong style={{ color: '#f5f0ff' }}>30 premium AI images/month</strong> <span style={{ color: '#8b8b9e' }}>(accumulate up to 5)</span></div>
                  <div>🎨 <strong style={{ color: '#f5f0ff' }}>Up to 300 SFW images/month</strong></div>
                  <div>🎧 <strong style={{ color: '#f5f0ff' }}>1 free audio/day</strong> <span style={{ color: '#8b8b9e' }}>(accumulate up to 5)</span></div>
                  <div>👑 <strong style={{ color: '#f5f0ff' }}>18 exclusive characters</strong></div>
                </>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {VIP_PLANS.map((plan) => {
                const isPurchasing = vipPurchasing === plan.id
                const planLabel = plan.label[lang === 'es' ? 'es' : 'en']
                const planPrice = plan.price[lang === 'es' ? 'es' : 'en']
                const cryptoPrice = `$${plan.crypto_price.toFixed(2)}`
                const planSavings = plan.savings
                  ? plan.savings[lang === 'es' ? 'es' : 'en']
                  : null
                const cryptoSavings = plan.crypto_savings[lang === 'es' ? 'es' : 'en']

                return (
                  <div
                    key={plan.id}
                    style={{
                      position: 'relative',
                      borderRadius: 18,
                      overflow: 'hidden',
                      background: plan.popular
                        ? 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)'
                        : plan.bestValue
                        ? 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%)'
                        : 'rgba(168, 85, 247, 0.12)',
                      border: plan.popular
                        ? '2px solid rgba(240, 171, 252, 0.8)'
                        : plan.bestValue
                        ? '2px solid rgba(251, 191, 36, 0.8)'
                        : '2px solid rgba(168, 85, 247, 0.3)',
                      boxShadow: plan.popular
                        ? '0 8px 28px rgba(236, 72, 153, 0.5)'
                        : plan.bestValue
                        ? '0 8px 28px rgba(251, 191, 36, 0.5)'
                        : 'none',
                      opacity: vipPurchasing && !isPurchasing ? 0.6 : 1,
                      transition: 'opacity 0.2s ease',
                    }}
                  >
                    {(plan.popular || plan.bestValue) && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 10,
                          right: 12,
                          background: '#1a1228',
                          color: plan.bestValue ? '#fbbf24' : '#f0abfc',
                          fontSize: 9,
                          fontWeight: 900,
                          letterSpacing: '0.1em',
                          padding: '4px 10px',
                          borderRadius: 8,
                          border: plan.bestValue
                            ? '1px solid #fbbf24'
                            : '1px solid #f0abfc',
                          zIndex: 2,
                        }}
                      >
                        {plan.bestValue
                          ? (lang === 'es' ? 'MEJOR VALOR' : 'BEST VALUE')
                          : (lang === 'es' ? 'POPULAR' : 'POPULAR')}
                      </div>
                    )}

                    <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 14,
                          background:
                            plan.popular || plan.bestValue
                              ? 'rgba(0,0,0,0.2)'
                              : 'rgba(168, 85, 247, 0.2)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 24,
                          flexShrink: 0,
                        }}
                      >
                        {plan.emoji}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p
                          style={{
                            fontSize: 16,
                            fontWeight: 800,
                            margin: 0,
                            color: '#fff',
                            textShadow:
                              plan.popular || plan.bestValue
                                ? '0 1px 4px rgba(0,0,0,0.2)'
                                : 'none',
                          }}
                        >
                          {planLabel}
                        </p>
                        <p
                          style={{
                            fontSize: 11,
                            margin: '2px 0 0 0',
                            color:
                              plan.popular || plan.bestValue
                                ? 'rgba(255,255,255,0.85)'
                                : '#a395c9',
                            fontWeight: 600,
                          }}
                        >
                          {plan.days} {lang === 'es' ? 'días' : 'days'}
                          {planSavings && (
                            <>
                              {' · '}
                              <span
                                style={{
                                  color: plan.bestValue
                                    ? '#1a1228'
                                    : plan.popular
                                    ? '#fef3c7'
                                    : '#22c55e',
                                  fontWeight: 800,
                                }}
                              >
                                {planSavings}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 8,
                        padding: '0 16px 16px 16px',
                      }}
                    >
                      <button
                        onClick={() => buyVipWithStars(plan.id)}
                        disabled={!!vipPurchasing || !!vipPendingRef}
                        style={{
                          padding: '12px 10px',
                          borderRadius: 12,
                          background: plan.popular || plan.bestValue
                            ? '#fff'
                            : 'rgba(255, 255, 255, 0.1)',
                          border: 'none',
                          color: plan.popular || plan.bestValue
                            ? (plan.bestValue ? '#d97706' : '#a855f7')
                            : '#fff',
                          fontSize: 13,
                          fontWeight: 800,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 2,
                          opacity: vipPurchasing && !isPurchasing ? 0.5 : 1,
                        }}
                      >
                        <span>⭐ {planPrice}</span>
                        <span style={{ fontSize: 9, opacity: 0.75, fontWeight: 600 }}>
                          {plan.stars} Stars
                        </span>
                      </button>

                      <button
                        onClick={() => buyVipWithCrypto(plan.id)}
                        disabled={!!vipPurchasing || !!vipPendingRef}
                        style={{
                          padding: '12px 10px',
                          borderRadius: 12,
                          background: 'rgba(34, 197, 94, 0.15)',
                          border: '1px solid rgba(34, 197, 94, 0.6)',
                          color: '#4ade80',
                          fontSize: 13,
                          fontWeight: 800,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 2,
                          opacity: vipPurchasing && !isPurchasing ? 0.5 : 1,
                        }}
                      >
                        <span>💎 {cryptoPrice}</span>
                        <span style={{ fontSize: 9, opacity: 0.9, fontWeight: 700 }}>
                          {cryptoSavings}
                        </span>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            <p
              style={{
                fontSize: 10,
                color: '#6b6b7e',
                margin: '12px 0 0 0',
                textAlign: 'center',
                lineHeight: 1.5,
              }}
            >
              {lang === 'es'
                ? '💡 Se renueva automáticamente. Puedes cancelar cuando quieras.'
                : '💡 Auto-renews. Cancel anytime.'}
            </p>
          </>
        )}
      </section>

      <section style={{ padding: '28px 16px 0' }}>
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
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)', margin: 0, maxWidth: '75%' }}>
            {t.premiumDesc}
          </p>
        </div>
      </section>

      <section style={{ padding: '20px 16px 0' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setPaymentMethod('stars')}
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: 14,
              background:
                paymentMethod === 'stars'
                  ? 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)'
                  : 'rgba(168, 85, 247, 0.08)',
              color: paymentMethod === 'stars' ? '#fff' : '#a395c9',
              border: paymentMethod === 'stars' ? 'none' : '1px solid rgba(168, 85, 247, 0.2)',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
              boxShadow:
                paymentMethod === 'stars' ? '0 4px 16px rgba(236, 72, 153, 0.5)' : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            ⭐ Stars +5%
          </button>
          <button
            onClick={() => setPaymentMethod('crypto')}
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: 14,
              background:
                paymentMethod === 'crypto'
                  ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
                  : 'rgba(34, 197, 94, 0.08)',
              color: paymentMethod === 'crypto' ? '#fff' : '#a395c9',
              border: paymentMethod === 'crypto' ? 'none' : '1px solid rgba(34, 197, 94, 0.3)',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
              boxShadow:
                paymentMethod === 'crypto' ? '0 4px 16px rgba(34, 197, 94, 0.5)' : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 3l3 5h5l-8 13L4 8h5l3-5z" fill="currentColor" />
            </svg>
            Crypto +15%
          </button>
        </div>
      </section>

      {pendingReference && (
        <section style={{ padding: '16px 16px 0' }}>
          <div
            style={{
              padding: 14,
              borderRadius: 14,
              background: 'linear-gradient(135deg, rgba(34,197,94,0.15), rgba(34,197,94,0.05))',
              border: '1px solid rgba(34, 197, 94, 0.4)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
            <p style={{ fontSize: 13, color: '#86efac', margin: 0, flex: 1 }}>
              {pendingStatus}
            </p>
          </div>
        </section>
      )}

      <section style={{ padding: '24px 16px 0' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{t.packages}</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {paymentMethod === 'stars'
            ? visibleStarsPackages.map((pkg) => {
                const idx = pkg.originalIndex
                const isFirstTime = pkg.first_time_only
                const finalGems = getFinalGems(pkg)

                return (
                  <button
                    key={`stars_${idx}`}
                    onClick={() => buyWithStars(idx)}
                    disabled={purchasing !== null || !!pendingReference}
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
                      opacity: purchasing !== null || pendingReference ? 0.5 : 1,
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
                        {finalGems > pkg.gems && (
                          <span style={{ fontSize: 13, color: '#22c55e', fontWeight: 700 }}>
                            + {finalGems - pkg.gems} {t.bonusGems}
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
                      <p
                        style={{
                          fontSize: 10,
                          color: '#8b8b9e',
                          textTransform: 'uppercase',
                          margin: 0,
                        }}
                      >
                        Stars
                      </p>
                    </div>
                  </button>
                )
              })
            : visibleCryptoPackages.map((pkg) => {
                const idx = pkg.originalIndex
                const isFirstTime = pkg.first_time_only
                const finalGems = getFinalCryptoGems(pkg)

                return (
                  <button
                    key={`crypto_${idx}`}
                    onClick={() => buyWithCrypto(idx)}
                    disabled={purchasing !== null || !!pendingReference}
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
                      opacity: purchasing !== null || pendingReference ? 0.5 : 1,
                    }}
                  >
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                        <path d="M12 3l3 5h5l-8 13L4 8h5l3-5z" fill="#fff" />
                      </svg>
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <p style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>
                          {pkg.gems} {t.gems}
                        </p>
                        {finalGems > pkg.gems && (
                          <span style={{ fontSize: 13, color: '#22c55e', fontWeight: 700 }}>
                            + {finalGems - pkg.gems} {t.bonusGems}
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
                      <p style={{ fontWeight: 700, fontSize: 14, margin: 0 }}>{pkg.usdt}</p>
                      <p
                        style={{
                          fontSize: 10,
                          color: '#8b8b9e',
                          textTransform: 'uppercase',
                          margin: 0,
                        }}
                      >
                        USDT
                      </p>
                    </div>
                  </button>
                )
              })}
        </div>
      </section>

      {showVipSuccess && (
        <div className="modal-backdrop">
          <div className="modal-box level-up-modal">
            <div style={{ fontSize: 60, textAlign: 'center', marginBottom: 8 }}>👑</div>
            <h2
              className="modal-title"
              style={{
                textAlign: 'center',
                fontSize: 24,
                marginTop: 6,
                background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              {lang === 'es' ? '¡Bienvenido a VIP!' : 'Welcome to VIP!'}
            </h2>

            <div
              style={{
                fontSize: 13,
                color: '#c4b5fd',
                textAlign: 'center',
                margin: '12px 0 20px 0',
                lineHeight: 1.7,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {lang === 'es' ? (
                <>
                  <div>📨 6.000 mensajes/mes</div>
                  <div>📸 30 imágenes IA premium/mes</div>
                  <div>🎨 Hasta 300 imágenes SFW/mes</div>
                  <div>🎧 1 audio gratis/día (acumula 5)</div>
                  <div>👑 18 personajes exclusivos</div>
                </>
              ) : (
                <>
                  <div>📨 6,000 messages/month</div>
                  <div>📸 30 premium AI images/month</div>
                  <div>🎨 Up to 300 SFW images/month</div>
                  <div>🎧 1 free audio/day (accumulate 5)</div>
                  <div>👑 18 exclusive characters</div>
                </>
              )}
            </div>

            <button
              onClick={() => setShowVipSuccess(false)}
              className="modal-btn primary"
              style={{
                width: '100%',
                background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
                boxShadow: '0 4px 24px rgba(251, 191, 36, 0.6)',
              }}
            >
              {lang === 'es' ? '¡Empezar!' : 'Get started!'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
