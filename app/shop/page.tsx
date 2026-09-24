"use client"

import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import {
  STAR_PACKAGES,
  CRYPTO_PACKAGES,
  getFinalGems,
  getFinalCryptoGems,
} from '@/lib/constants'
import { getTranslations } from '@/lib/i18n'
import { useUser } from '@/lib/UserContext'
import { useTonPay } from '@ton-pay/ui-react'
import { createTonPayTransfer, USDT } from '@ton-pay/api'

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

  const { pay } = useTonPay()

  const t = getTranslations(lang)

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
    const timeout = setTimeout(() => {
      if (!cancelled) setChecking(false)
    }, 3000)

    Promise.race([
      supabase
        .from('star_purchases')
        .select('id')
        .eq('telegram_id', user.telegram_id)
        .limit(1),
      new Promise((resolve) => setTimeout(() => resolve({ data: null }), 3000)),
    ])
      .then((result: any) => {
        if (cancelled) return
        const has = !!(result?.data && result.data.length > 0)
        purchaseCache[user.telegram_id] = has
        setHasPurchased(has)
        setChecking(false)
      })
      .catch(() => {
        if (!cancelled) setChecking(false)
      })
      .finally(() => clearTimeout(timeout))

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [user?.telegram_id, userLoading])

  // Limpia el polling al desmontar
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [])

  // ═══════════════════════════════════════
  // COMPRA CON STARS (existente)
  // ═══════════════════════════════════════
  const buyWithStars = async (idx: number) => {
    if (!user) return
    setPurchasing(idx)
    try {
      const res = await fetch('/api/create-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: user.telegram_id,
          package_id: idx,
        }),
      })
      const data = await res.json()
      if (res.ok && data.invoice_link) {
        import('@twa-dev/sdk').then((mod) => {
          const WebApp = mod.default
          WebApp.openInvoice(data.invoice_link, async (status: string) => {
            if (status === 'paid') {
              await refresh()
              if (user.telegram_id) purchaseCache[user.telegram_id] = true
              setHasPurchased(true)
            }
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

  // ═══════════════════════════════════════
  // COMPRA CON CRYPTO (USDT en TON)
  // ═══════════════════════════════════════
  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    setPendingReference(null)
    setPendingStatus('')
  }

  const startPolling = (reference: string) => {
    setPendingReference(reference)
    setPendingStatus(lang === 'es' ? 'Verificando pago…' : 'Verifying payment…')

    let attempts = 0
    const MAX_ATTEMPTS = 20 // 20 × 4s = 80s máx

    pollRef.current = setInterval(async () => {
      attempts++
      if (attempts > MAX_ATTEMPTS) {
        stopPolling()
        alert(
          lang === 'es'
            ? 'No hemos detectado el pago todavía. Si ya pagaste, contacta soporte.'
            : "We haven't detected the payment yet. If you already paid, contact support."
        )
        return
      }

      try {
        const res = await fetch('/api/check-crypto-payment', {
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
          alert(
            lang === 'es'
              ? `✅ Pago confirmado. +${data.gems_added} gemas acreditadas.`
              : `✅ Payment confirmed. +${data.gems_added} gems credited.`
          )
        } else {
          setPendingStatus(
            lang === 'es'
              ? `Confirmando en la blockchain… (${attempts}/${MAX_ATTEMPTS})`
              : `Confirming on-chain… (${attempts}/${MAX_ATTEMPTS})`
          )
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
      // 1. Pedir datos del pago al backend
      const res = await fetch('/api/create-crypto-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: user.telegram_id,
          package_id: idx,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.payment_data) {
        alert(data.error || 'Error creando pago')
        setPurchasing(null)
        return
      }

      const { payment_data } = data

      // 2. Enviar la transacción USDT firmada por el usuario
      const result = await pay(async (senderAddr: string) => {
        const transfer = await createTonPayTransfer(
          {
            amount: payment_data.amount,
            asset: USDT,
            recipientAddr: payment_data.recipientAddr,
            senderAddr,
            commentToRecipient: payment_data.reference,
            commentToSender: `Taboo Realm — ${payment_data.amount} USDT`,
          },
          {
            chain: 'mainnet', // ⚠️ cambia a 'testnet' si estás probando
          }
        )
        return {
          message: transfer.message,
          reference: transfer.reference,
          bodyBase64Hash: transfer.bodyBase64Hash,
        }
      })

      console.log('[shop] crypto payment sent:', result)

      // 3. Empezar a hacer polling al backend para confirmar
      startPolling(payment_data.reference)
    } catch (e: any) {
      console.error('[shop] crypto error:', e)
      const msg = e?.message || String(e)
      if (msg.toLowerCase().includes('user rejected') || msg.toLowerCase().includes('cancel')) {
        // Usuario canceló — no hacer nada
      } else {
        alert(
          lang === 'es'
            ? 'No se pudo enviar la transacción: ' + msg
            : 'Could not send transaction: ' + msg
        )
      }
    } finally {
      setPurchasing(null)
    }
  }

  // ═══════════════════════════════════════
  // Render
  // ═══════════════════════════════════════

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

      {/* Banner Premium */}
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

      {/* Selector de método */}
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
              border:
                paymentMethod === 'stars'
                  ? 'none'
                  : '1px solid rgba(168, 85, 247, 0.2)',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
              boxShadow:
                paymentMethod === 'stars'
                  ? '0 4px 16px rgba(236, 72, 153, 0.5)'
                  : 'none',
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
              border:
                paymentMethod === 'crypto'
                  ? 'none'
                  : '1px solid rgba(34, 197, 94, 0.3)',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
              boxShadow:
                paymentMethod === 'crypto'
                  ? '0 4px 16px rgba(34, 197, 94, 0.5)'
                  : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            💎 Crypto +15%
          </button>
        </div>
      </section>

      {/* Aviso de pago pendiente */}
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

      {/* Paquetes */}
      <section style={{ padding: '24px 16px 0' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
          {t.packages}
        </h2>

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
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          flexWrap: 'wrap',
                        }}
                      >
                        <p style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>
                          {pkg.gems} {t.gems}
                        </p>
                        {finalGems > pkg.gems && (
                          <span
                            style={{ fontSize: 13, color: '#22c55e', fontWeight: 700 }}
                          >
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
                      <p style={{ fontWeight: 700, fontSize: 14, margin: 0 }}>
                        {pkg.stars}
                      </p>
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
                        fontSize: 22,
                      }}
                    >
                      💎
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          flexWrap: 'wrap',
                        }}
                      >
                        <p style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>
                          {pkg.gems} {t.gems}
                        </p>
                        {finalGems > pkg.gems && (
                          <span
                            style={{ fontSize: 13, color: '#22c55e', fontWeight: 700 }}
                          >
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
                      <p style={{ fontWeight: 700, fontSize: 14, margin: 0 }}>
                        {pkg.usdt}
                      </p>
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

      {/* ❌ Instrucciones eliminadas — los precios son variables por nivel */}
    </div>
  )
}
