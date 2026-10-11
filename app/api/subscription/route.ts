// app/api/subscription/route.ts
// Endpoint para gestionar suscripciones VIP.
//
// GET  → devuelve el estado actual de la suscripción
// POST → acciones: create_invoice | confirm | cancel
//
// Flujo de pago:
//   1. Cliente POST { action: 'create_invoice', plan: 'monthly' }
//      → recibe { invoice_link, reference }
//   2. Cliente abre invoice_link con WebApp.openInvoice
//   3. Si callback status === 'paid':
//      Cliente POST { action: 'confirm', plan: 'monthly', reference }
//      → backend activa suscripción (idempotente)

import { NextResponse } from 'next/server'
import {
  ensureUser,
  getActiveSubscription,
  getSubscriptionByChargeId,
  createSubscription,
  cancelActiveSubscription,
} from '@/lib/db-queries'
import { VIP_PLANS } from '@/lib/constants'

export const dynamic = 'force-dynamic'

// ═══════════════════════════════════════════════════════════════
// Helper: convierte Date → formato compatible con datetime('now')
// SQLite espera 'YYYY-MM-DD HH:MM:SS' (no ISO con T y Z)
// ═══════════════════════════════════════════════════════════════
function toSqliteDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

// ═══════════════════════════════════════════════════════════════
// GET — Estado actual de la suscripción
// ═══════════════════════════════════════════════════════════════
export async function GET(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const user = await ensureUser(tid)
    if (!user) {
      return NextResponse.json(
        { error: 'Error cargando tu cuenta' },
        { status: 500 }
      )
    }

    const sub = await getActiveSubscription(tid)

    if (!sub) {
      return NextResponse.json({
        active: false,
        subscription: null,
      })
    }

    const daysRemaining = Math.max(
      0,
      Math.ceil(
        (new Date(sub.expires_at.replace(' ', 'T') + 'Z').getTime() - Date.now()) /
          (1000 * 60 * 60 * 24)
      )
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
    return NextResponse.json(
      { error: 'Error interno', detail: e?.message || String(e) },
      { status: 500 }
    )
  }
}

// ═══════════════════════════════════════════════════════════════
// POST — Acciones
// ═══════════════════════════════════════════════════════════════
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
      return NextResponse.json(
        { error: 'Error cargando tu cuenta' },
        { status: 500 }
      )
    }

    switch (action) {
      case 'create_invoice':
        return await handleCreateInvoice(tid, body, user)

      case 'confirm':
        return await handleConfirm(tid, body)

      case 'cancel':
        return await handleCancel(tid)

      default:
        return NextResponse.json(
          { error: 'Acción inválida. Usa: create_invoice, confirm o cancel' },
          { status: 400 }
        )
    }
  } catch (e: any) {
    console.error('[subscription POST] error:', e)
    return NextResponse.json(
      { error: 'Error interno', detail: e?.message || String(e) },
      { status: 500 }
    )
  }
}

// ═══════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════

async function handleCreateInvoice(tid: string, body: any, user: any) {
  const planId = String(body?.plan || '')
  const plan = VIP_PLANS.find((p) => p.id === planId)

  if (!plan) {
    return NextResponse.json({ error: 'Plan inválido' }, { status: 400 })
  }

  // ─── Reference único ───
  // Formato: vip_sub_<plan>_<telegram_id>_<timestamp>
  // Se usa también como identificador de idempotencia
  const reference = `vip_sub_${planId}_${tid}_${Date.now()}`

  const lang = user.language === 'en' ? 'en' : 'es'

  const title =
    lang === 'en'
      ? `Taboo Realm VIP — ${plan.label.en}`
      : `Taboo Realm VIP — ${plan.label.es}`

  const description =
    lang === 'en'
      ? `VIP subscription for ${plan.days} days. Unlimited messages, free images, exclusive characters.`
      : `Suscripción VIP por ${plan.days} días. Mensajes ilimitados, imágenes gratis, personajes exclusivos.`

  const res = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/createInvoiceLink`,
    {
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
    return NextResponse.json(
      { error: 'Error creando factura' },
      { status: 500 }
    )
  }

  console.log('[subscription] 📝 Invoice created:', {
    tid,
    plan: planId,
    reference,
  })

  return NextResponse.json({
    invoice_link: data.result,
    reference,
    plan: {
      id: plan.id,
      label: plan.label,
      stars: plan.stars,
      days: plan.days,
    },
  })
}

async function handleConfirm(tid: string, body: any) {
  const planId = String(body?.plan || '')
  const reference = String(body?.reference || '')

  if (!planId || !reference) {
    return NextResponse.json(
      { error: 'Faltan datos: plan y reference' },
      { status: 400 }
    )
  }

  const plan = VIP_PLANS.find((p) => p.id === planId)
  if (!plan) {
    return NextResponse.json({ error: 'Plan inválido' }, { status: 400 })
  }

  // ─── Idempotencia: ¿ya existe? ───
  const existing = await getSubscriptionByChargeId(reference)
  if (existing) {
    console.log('[subscription] ⚠️ Already confirmed:', reference)
    return NextResponse.json({
      ok: true,
      already: true,
      subscription: {
        plan: existing.plan,
        expires_at: existing.expires_at,
        status: existing.status,
      },
    })
  }

  // ─── Calcular expiración ───
  // Si ya tiene suscripción activa → extender desde su expiración actual
  // Si no → empezar desde ahora
  const currentSub = await getActiveSubscription(tid)

  let baseDate = new Date()
  if (currentSub) {
    const currentExpiry = new Date(
      currentSub.expires_at.replace(' ', 'T') + 'Z'
    )
    if (currentExpiry > baseDate) {
      baseDate = currentExpiry
    }
  }

  const expiresAt = new Date(
    baseDate.getTime() + plan.days * 24 * 60 * 60 * 1000
  )

  // ─── Crear suscripción ───
  const created = await createSubscription({
    telegram_id: tid,
    plan: plan.id,
    stars_paid: plan.stars,
    telegram_charge_id: reference,
    expires_at: toSqliteDate(expiresAt),
  })

  if (!created) {
    // Race condition: alguien lo creó entre el check y el insert
    const existing2 = await getSubscriptionByChargeId(reference)
    return NextResponse.json({
      ok: true,
      already: true,
      subscription: existing2
        ? {
            plan: existing2.plan,
            expires_at: existing2.expires_at,
          }
        : null,
    })
  }

  console.log('[subscription] ✅ VIP activated:', {
    tid,
    plan: plan.id,
    expires_at: toSqliteDate(expiresAt),
  })

  return NextResponse.json({
    ok: true,
    subscription: {
      plan: plan.id,
      expires_at: toSqliteDate(expiresAt),
      days: plan.days,
    },
  })
}

async function handleCancel(tid: string) {
  const cancelled = await cancelActiveSubscription(tid)

  if (!cancelled) {
    return NextResponse.json(
      { error: 'No tienes suscripción activa para cancelar' },
      { status: 404 }
    )
  }

  console.log('[subscription] ❌ VIP cancelled:', tid)

  return NextResponse.json({
    ok: true,
    message:
      'Suscripción cancelada. Mantendrás acceso VIP hasta la fecha de expiración.',
  })
}