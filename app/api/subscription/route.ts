// app/api/subscription/route.ts

import { NextResponse } from 'next/server'
import {
  ensureUser,
  getActiveSubscription,
  getSubscriptionByChargeId,
  createSubscription,
  cancelActiveSubscription,
} from '@/lib/db-queries'
import { VIP_PLANS, usdtToUnits } from '@/lib/constants'

export const dynamic = 'force-dynamic'

const TONAPI_KEY = process.env.TONAPI_KEY || ''
const RECIPIENT_WALLET =
  process.env.TON_RECIPIENT_WALLET ||
  process.env.NEXT_PUBLIC_TON_RECIPIENT_WALLET ||
  'UQCt76T3JPW3WrpsfIz6Tc1eVrvkrQpwV0-3sk1so4P8Vd4-'

const USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'

function toSqliteDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

async function verifyCryptoPayment(
  reference: string,
  expectedUnits: number
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const url = `https://tonapi.io/v2/accounts/${RECIPIENT_WALLET}/events?limit=30`
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (TONAPI_KEY) headers['Authorization'] = `Bearer ${TONAPI_KEY}`

    const res = await fetch(url, { headers, cache: 'no-store' })
    if (!res.ok) {
      console.warn('[subscription] TonAPI error:', res.status)
      return { ok: false, reason: 'tonapi_error' }
    }

    const data = await res.json()
    const events = data.events || []

    for (const ev of events) {
      for (const action of ev.actions || []) {
        if (action.type !== 'JettonTransfer') continue
        const jt = action.JettonTransfer
        if (!jt) continue
        if (jt.comment !== reference) continue
        if (jt.jetton?.address !== USDT_MASTER) continue

        const receivedUnits = parseInt(jt.amount || '0', 10)
        if (receivedUnits < expectedUnits - 1000) {
          console.warn('[subscription] Amount mismatch:', { expectedUnits, receivedUnits })
          return { ok: false, reason: 'amount_mismatch' }
        }

        return { ok: true }
      }
    }

    return { ok: false, reason: 'not_found' }
  } catch (e: any) {
    console.error('[subscription] verifyCryptoPayment error:', e?.message)
    return { ok: false, reason: 'exception' }
  }
}

export async function GET(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const user = await ensureUser(tid)
    if (!user) {
      return NextResponse.json({ error: 'Error cargando tu cuenta' }, { status: 500 })
    }

    const sub = await getActiveSubscription(tid)

    if (!sub) {
      return NextResponse.json({ active: false, subscription: null })
    }

    const daysRemaining = Math.max(
      0,
      Math.ceil((new Date(sub.expires_at.replace(' ', 'T') + 'Z').getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    )

    return NextResponse.json({
      active: true,
      subscription: {
        plan: sub.plan,
        started_at: sub.started_at,
        expires_at: sub.expires_at,
        days_remaining: daysRemaining,
        status: sub.status,
      },
    })
  } catch (e: any) {
    console.error('[subscription GET] error:', e)
    return NextResponse.json({ error: 'Error interno', detail: e?.message || String(e) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const action = String(body?.action || '')

    const user = await ensureUser(tid)
    if (!user) {
      return NextResponse.json({ error: 'Error cargando tu cuenta' }, { status: 500 })
    }

    switch (action) {
      case 'create_invoice':
        return await handleCreateInvoice(tid, body, user)
      case 'confirm':
        return await handleConfirm(tid, body)
      case 'create_crypto_invoice':
        return await handleCreateCryptoInvoice(tid, body, user)
      case 'confirm_crypto':
        return await handleConfirmCrypto(tid, body)
      case 'cancel':
        return await handleCancel(tid)
      default:
        return NextResponse.json({ error: 'Acción inválida' }, { status: 400 })
    }
  } catch (e: any) {
    console.error('[subscription POST] error:', e)
    return NextResponse.json({ error: 'Error interno', detail: e?.message || String(e) }, { status: 500 })
  }
}

async function handleCreateInvoice(tid: string, body: any, user: any) {
  const planId = String(body?.plan || '')
  const plan = VIP_PLANS.find((p) => p.id === planId)

  if (!plan) return NextResponse.json({ error: 'Plan inválido' }, { status: 400 })

  const reference = `vip_sub_${planId}_${tid}_${Date.now()}`
  const lang = user.language === 'en' ? 'en' : 'es'

  const title = lang === 'en' ? `Taboo Realm VIP — ${plan.label.en}` : `Taboo Realm VIP — ${plan.label.es}`
  const description = lang === 'en'
      ? `VIP subscription for ${plan.days} days.`
      : `Suscripción VIP por ${plan.days} días.`

  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description,
        payload: reference,
        currency: 'XTR',
        prices: [{ label: `VIP ${plan.label[lang]}`, amount: plan.stars }],
      }),
    }
  )

  const data = await res.json()

  if (!data.ok) {
    console.error('[subscription create_invoice] Telegram error:', data)
    return NextResponse.json({ error: 'Error creando factura' }, { status: 500 })
  }

  return NextResponse.json({
    invoice_link: data.result,
    reference,
    plan: { id: plan.id, label: plan.label, stars: plan.stars, days: plan.days },
  })
}

async function handleConfirm(tid: string, body: any) {
  const reference = String(body?.reference || '')

  if (!reference) {
    return NextResponse.json({ error: 'Faltan datos: reference' }, { status: 400 })
  }

  // ✅ FIX DE SEGURIDAD: Ya NO activamos la suscripción aquí. 
  // Solo comprobamos si el webhook de Python ya lo hizo en la base de datos.
  // Esto evita que cualquiera se haga VIP gratis sin pagar.
  const existing = await getSubscriptionByChargeId(reference)
  if (existing) {
    return NextResponse.json({
      ok: true,
      already: true,
      subscription: { plan: existing.plan, expires_at: existing.expires_at, status: existing.status },
    })
  }

  // Si no está en la DB, es porque el webhook aún no ha llegado
  return NextResponse.json({ ok: false, status: 'pending', message: 'Esperando confirmación de Telegram...' })
}

async function handleCreateCryptoInvoice(tid: string, body: any, user: any) {
  const planId = String(body?.plan || '')
  const plan = VIP_PLANS.find((p) => p.id === planId)

  if (!plan) return NextResponse.json({ error: 'Plan inválido' }, { status: 400 })
  if (!RECIPIENT_WALLET || RECIPIENT_WALLET.length < 40) return NextResponse.json({ error: 'Configuración incompleta: falta wallet de destino' }, { status: 500 })

  const reference = `VIP_${planId}_${tid}_${Date.now()}`
  const units = usdtToUnits(plan.crypto_price)

  return NextResponse.json({
    payment_data: {
      amount: plan.crypto_price,
      amountUnits: units, // ✅ Enviamos las unidades exactas para la blockchain
      recipientAddr: RECIPIENT_WALLET,
      reference,
    },
    plan: { id: plan.id, label: plan.label, crypto_price: plan.crypto_price, days: plan.days },
  })
}

async function handleConfirmCrypto(tid: string, body: any) {
  const planId = String(body?.plan || '')
  const reference = String(body?.reference || '')

  if (!planId || !reference) return NextResponse.json({ error: 'Faltan datos: plan y reference' }, { status: 400 })

  const plan = VIP_PLANS.find((p) => p.id === planId)
  if (!plan) return NextResponse.json({ error: 'Plan inválido' }, { status: 400 })

  const existing = await getSubscriptionByChargeId(reference)
  if (existing) {
    return NextResponse.json({
      status: 'paid',
      already: true,
      subscription: { plan: existing.plan, expires_at: existing.expires_at, status: existing.status },
    })
  }

  const expectedUnits = usdtToUnits(plan.crypto_price)
  const verification = await verifyCryptoPayment(reference, expectedUnits)

  if (!verification.ok) {
    if (verification.reason === 'not_found') return NextResponse.json({ status: 'pending' })
    return NextResponse.json({ status: 'pending', reason: verification.reason })
  }

  const activation = await activateSubscription(tid, plan, reference)
  const activationData = await activation.json()

  if (!activationData.ok) return NextResponse.json(activationData, { status: activation.status })

  return NextResponse.json({ status: 'paid', subscription: activationData.subscription })
}

async function activateSubscription(tid: string, plan: any, reference: string) {
  const existing = await getSubscriptionByChargeId(reference)
  if (existing) {
    return NextResponse.json({ ok: true, already: true, subscription: { plan: existing.plan, expires_at: existing.expires_at, status: existing.status } })
  }

  const currentSub = await getActiveSubscription(tid)
  let baseDate = new Date()
  if (currentSub) {
    const currentExpiry = new Date(currentSub.expires_at.replace(' ', 'T') + 'Z')
    if (currentExpiry > baseDate) baseDate = currentExpiry
  }

  const expiresAt = new Date(baseDate.getTime() + plan.days * 24 * 60 * 60 * 1000)

  const created = await createSubscription({
    telegram_id: tid,
    plan: plan.id,
    stars_paid: plan.stars,
    telegram_charge_id: reference,
    expires_at: toSqliteDate(expiresAt),
  })

  if (!created) {
    const existing2 = await getSubscriptionByChargeId(reference)
    return NextResponse.json({
      ok: true, already: true, subscription: existing2 ? { plan: existing2.plan, expires_at: existing2.expires_at } : null,
    })
  }

  return NextResponse.json({
    ok: true, subscription: { plan: plan.id, expires_at: toSqliteDate(expiresAt), days: plan.days },
  })
}

async function handleCancel(tid: string) {
  const cancelled = await cancelActiveSubscription(tid)
  if (!cancelled) return NextResponse.json({ error: 'No tienes suscripción activa para cancelar' }, { status: 404 })
  return NextResponse.json({ ok: true, message: 'Suscripción cancelada. Mantendrás acceso VIP hasta la fecha de expiración.' })
}
