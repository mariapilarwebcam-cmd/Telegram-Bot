// app/api/subscription/route.ts

import { NextResponse } from 'next/server'
import {
  ensureUser,
  getActiveSubscription,
  cancelActiveSubscription,
} from '@/lib/db-queries'
import { db } from '@/lib/turso'
import { randomUUID } from 'crypto'
import { confirmVipCrypto, findCreditedVip } from '@/lib/vip-subscription'
import { VIP_PLANS, usdtToUnits } from '@/lib/constants'

export const dynamic = 'force-dynamic'

export const maxDuration = 60
const RECIPIENT_WALLET =
  process.env.TON_RECIPIENT_WALLET || ''

// ✅ FIX #1 y #2: Parsers estrictos de reference para validar tid y planId
// Formato Stars: vip_sub_<planId>_<tid>_<timestamp>
// Formato Crypto: VIP_<planId>_<tid>_<timestamp>
function parseStarsVipReference(reference: string): { planId: string; tid: string } | null {
  const parts = reference.split('_')
  if (parts.length < 5) return null
  if (parts[0] !== 'vip' || parts[1] !== 'sub') return null
  return { planId: parts[2], tid: parts[3] }
}

function parseCryptoVipReference(reference: string): { planId: string; tid: string } | null {
  const parts = reference.split('_')
  if (parts.length < 4) return null
  if (parts[0] !== 'VIP') return null
  return { planId: parts[1], tid: parts[2] }
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
    console.error('[subscription POST] error')
    return NextResponse.json({ error: 'Error interno' }, { status: 503 })
  }
}

async function handleCreateInvoice(tid: string, body: any, user: any) {
  const planId = String(body?.plan || '')
  const plan = VIP_PLANS.find((p) => p.id === planId)

  if (!plan) return NextResponse.json({ error: 'Plan inválido' }, { status: 400 })

  const reference = `vip_sub_${planId}_${tid}_${randomUUID()}`
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error('bot_not_configured')
  await db.execute({
    sql: `INSERT INTO vip_invoices
          (reference, telegram_id, payment_method, plan, days, expected_amount_units, currency)
          VALUES (?, ?, 'stars', ?, ?, ?, 'XTR')`,
    args: [reference, tid, plan.id, plan.days, plan.stars],
  })
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

  // ✅ FIX #1: Validar que el reference pertenezca al usuario
  const parsed = parseStarsVipReference(reference)
  if (!parsed) {
    return NextResponse.json({ error: 'Reference inválido' }, { status: 400 })
  }
  if (parsed.tid !== tid) {
    console.warn('[subscription confirm] Reference no coincide con tid:', {
      refTid: parsed.tid,
      tid,
    })
    return NextResponse.json({ error: 'Reference no coincide con la sesión' }, { status: 403 })
  }

  // Búsqueda directa: si el `telegram_charge_id` coincide con el `reference` (flujo crypto o casos previos)
  const existing = await findCreditedVip(db, reference, tid)
  if (existing) {
    return NextResponse.json({
      ok: true,
      already: true,
      subscription: { plan: existing.plan, expires_at: existing.expires_at, status: existing.status },
    })
  }

  // Only the permanent ledger proves this invoice; a pre-existing VIP or an
  // inbox receipt still pending is never confirmation of payment.

  // Ni por reference ni por tid: el webhook aún no ha llegado
  return NextResponse.json({
    ok: false,
    status: 'pending',
    message: 'Esperando confirmación de Telegram...',
  })
}

async function handleCreateCryptoInvoice(tid: string, body: any, user: any) {
  const planId = String(body?.plan || '')
  const plan = VIP_PLANS.find((p) => p.id === planId)

  if (!plan) return NextResponse.json({ error: 'Plan inválido' }, { status: 400 })
  if (!RECIPIENT_WALLET || RECIPIENT_WALLET.length < 40) return NextResponse.json({ error: 'Configuración incompleta: falta wallet de destino' }, { status: 500 })

  const reference = `VIP_${planId}_${tid}_${randomUUID()}`
  const units = usdtToUnits(plan.crypto_price)
  await db.execute({
    sql: `INSERT INTO vip_invoices
          (reference, telegram_id, payment_method, plan, days, expected_amount_units, currency)
          VALUES (?, ?, 'crypto', ?, ?, ?, 'USDT')`,
    args: [reference, tid, plan.id, plan.days, units],
  })

  return NextResponse.json({
    payment_data: {
      amount: plan.crypto_price,
      amountUnits: units,
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

  // ✅ FIX #1 (seguridad): Validar que el reference pertenezca al usuario
  const parsed = parseCryptoVipReference(reference)
  if (!parsed) {
    return NextResponse.json({ error: 'Reference inválido' }, { status: 400 })
  }
  if (parsed.tid !== tid) {
    console.warn('[subscription confirm_crypto] Reference no coincide con tid:', {
      refTid: parsed.tid,
      tid,
    })
    return NextResponse.json({ error: 'Reference no coincide con la sesión' }, { status: 403 })
  }

  // ✅ FIX #2 (seguridad): Validar que el planId del reference coincida con el del body
  if (parsed.planId !== planId) {
    console.warn('[subscription confirm_crypto] Plan mismatch:', {
      refPlan: parsed.planId,
      bodyPlan: planId,
    })
    return NextResponse.json({ error: 'Plan no coincide con el reference' }, { status: 400 })
  }

  const plan = VIP_PLANS.find((p) => p.id === planId)
  if (!plan) return NextResponse.json({ error: 'Plan inválido' }, { status: 400 })

  return NextResponse.json(await confirmVipCrypto(db, tid, body, RECIPIENT_WALLET))
}

async function handleCancel(tid: string) {
  const cancelled = await cancelActiveSubscription(tid)
  if (!cancelled) return NextResponse.json({ error: 'No tienes suscripción activa para cancelar' }, { status: 404 })
  return NextResponse.json({ ok: true, message: 'Suscripción cancelada. Mantendrás acceso VIP hasta la fecha de expiración.' })
}
