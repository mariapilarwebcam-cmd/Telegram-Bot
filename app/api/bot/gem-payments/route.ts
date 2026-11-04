// app/api/bot/gem-payments/route.ts
// Procesador interno de compras de gemas / pases con Telegram Stars.
// Lo invoca únicamente el bot, después de recibir un successful_payment
// auténtico de Telegram. No acepta importes, recursos ni flags del llamador:
// todo se deriva del catálogo validado contra lo realmente cobrado.

import { NextResponse } from 'next/server'
import {
  applyGemPurchaseAtomic,
  getLastPurchase,
  getUser,
  proveAppliedPurchase,
  resolveCommissionTarget,
  GemPurchaseTransactionError,
  type CommissionTarget,
} from '@/lib/db-queries'
import { authorizedGemWorker, resolveStarPurchase } from '@/lib/gem-payments'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_TELEGRAM_ID = 32
const MAX_CHARGE_ID = 256

function validTelegramId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_TELEGRAM_ID &&
    /^\d+$/.test(value)
  )
}

function validChargeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CHARGE_ID &&
    value.trim() === value
  )
}

export async function POST(request: Request) {
  // Secreto obligatorio: sin configuración no se procesa nada (503) y nunca
  // se concede acceso.
  const secret = process.env.GEM_PROCESSOR_SECRET
  if (!secret) {
    console.error('[gem-payments] GEM_PROCESSOR_SECRET no configurado')
    return NextResponse.json(
      { error: 'Configuración incompleta' },
      { status: 503 }
    )
  }

  // Autenticación entre servicios antes de leer el cuerpo.
  if (!authorizedGemWorker(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { status: 'rejected', reason: 'invalid_body' },
      { status: 400 }
    )
  }

  const payment = body as Record<string, unknown>

  if (payment.provider !== 'stars') {
    return NextResponse.json(
      { status: 'rejected', reason: 'unsupported_provider' },
      { status: 400 }
    )
  }

  if (!validTelegramId(payment.telegram_id)) {
    return NextResponse.json(
      { status: 'rejected', reason: 'invalid_telegram_id' },
      { status: 400 }
    )
  }

  if (!validChargeId(payment.telegram_charge_id)) {
    return NextResponse.json(
      { status: 'rejected', reason: 'invalid_charge_id' },
      { status: 400 }
    )
  }

  // Payload, moneda e importe cobrado deben corresponder al catálogo.
  const resolved = resolveStarPurchase({
    invoice_payload: payment.invoice_payload,
    currency: payment.currency,
    total_amount: payment.total_amount,
  })

  if (!resolved.ok) {
    console.error('[gem-payments] Pago rechazado:', {
      telegram_id: payment.telegram_id,
      reason: resolved.reason,
    })
    return NextResponse.json(
      { status: 'rejected', reason: resolved.reason },
      { status: 400 }
    )
  }

  const plan = resolved.plan
  const telegramId = String(payment.telegram_id)
  const chargeId = String(payment.telegram_charge_id)

  // Lecturas protegidas: un fallo de Turso no debe convertirse en excepción no
  // controlada ni en una acreditación parcial.
  let priorPurchase: { id: number } | null
  try {
    const user = await getUser(telegramId)
    if (!user) {
      return NextResponse.json(
        { status: 'rejected', reason: 'user_missing' },
        { status: 404 }
      )
    }
    priorPurchase = await getLastPurchase(telegramId)
  } catch (error: any) {
    console.error('[gem-payments] Error consultando usuario:', {
      reference: chargeId,
      message: error?.message,
    })
    return NextResponse.json(
      { status: 'error', reason: 'lookup_failed' },
      { status: 503 }
    )
  }

  // Evidencia persistida ANTES de resolver comisión: un cargo ya aplicado no se
  // vuelve a acreditar ni vuelve a generar comisión. `purchase_absent` significa
  // "todavía no aplicado" y continúa el flujo normal.
  try {
    const evidence = await proveAppliedPurchase(
      { telegram_id: telegramId, telegram_charge_id: chargeId },
      plan
    )

    if (evidence.state === 'applied') {
      return NextResponse.json({ status: 'duplicate' })
    }

    if (evidence.reason !== 'purchase_absent') {
      console.error('[gem-payments] Cargo requiere conciliación:', {
        reference: chargeId,
        reason: evidence.reason,
      })
      return NextResponse.json(
        { status: 'conflict', reason: evidence.reason },
        { status: 409 }
      )
    }
  } catch (error: any) {
    console.error('[gem-payments] Error verificando evidencia:', {
      reference: chargeId,
      message: error?.message,
    })
    return NextResponse.json(
      { status: 'error', reason: 'lookup_failed' },
      { status: 503 }
    )
  }

  // (1) Base de comisión EXCLUSIVAMENTE del plan validado del servidor.
  const commissionBase =
    plan.credit_gems + Math.floor(plan.credit_messages / 3)

  // (2) Referidor resuelto en servidor (users.referred_by), después de verificar
  // el pago y antes de la transacción. Contrato:
  //   commission_lookup_failed    ⇒ 503 reintentable (no consume el cargo)
  //   commission_referrer_missing ⇒ 200 review_required (no consume el cargo)
  let commission: CommissionTarget | null = null
  try {
    const resolvedCommission = await resolveCommissionTarget(
      telegramId,
      commissionBase
    )
    if (resolvedCommission.status === 'resolved') {
      commission = resolvedCommission.target
    } else if (resolvedCommission.status === 'referrer_missing') {
      console.error('[gem-payments] referidor inexistente; pago pendiente:', {
        reference: chargeId,
      })
      return NextResponse.json({
        status: 'review_required',
        reason: 'commission_referrer_missing',
        reference: chargeId,
        review_required: true,
      })
    }
  } catch (lookupError: any) {
    console.error('[gem-payments] comisión no resoluble; pago pendiente:', {
      reference: chargeId,
      message: lookupError?.message,
    })
    return NextResponse.json(
      {
        status: 'error',
        reason: 'commission_lookup_failed',
        reference: chargeId,
        retryable: true,
      },
      { status: 503 }
    )
  }

  // `is_first_purchase` es EXCLUSIVAMENTE informativo (auditoría): no altera
  // recursos, precios, bonos ni comisiones, así que una carrera entre dos
  // cargos distintos no puede activar ninguna ventaja económica.
  try {
    const outcome = await applyGemPurchaseAtomic({
      telegram_id: telegramId,
      telegram_charge_id: chargeId,
      is_first_purchase: !priorPurchase,
      plan,
      ...(commission ? { commission } : {}),
    })

    if (outcome.status === 'applied') {
      return NextResponse.json({
        status: 'applied',
        gems_added: plan.credit_gems,
        messages_added: plan.credit_messages,
        is_messages: plan.type === 'messages',
        is_hybrid: plan.type === 'hybrid',
        commission_applied: outcome.commission_applied,
        commission_pending:
          outcome.commission_note === 'commission_transient_failure',
        remaining_gems: outcome.gems,
        remaining_purchased_gems: outcome.purchased_gems,
        remaining_bonus_gems: outcome.bonus_gems,
      })
    }

    if (outcome.status === 'duplicate') {
      return NextResponse.json({ status: 'duplicate' })
    }

    if (outcome.status === 'user_missing') {
      return NextResponse.json(
        { status: 'rejected', reason: 'user_missing' },
        { status: 404 }
      )
    }

    console.error('[gem-payments] Cargo requiere conciliación:', {
      reference: chargeId,
      reason: outcome.reason,
    })
    return NextResponse.json(
      { status: 'conflict', reason: outcome.reason },
      { status: 409 }
    )
  } catch (error: any) {
    // Comisión determinista no resoluble: no se reintenta (409), no se acredita.
    if (
      error instanceof GemPurchaseTransactionError &&
      error.message === 'commission_review_required'
    ) {
      console.error('[gem-payments] comisión requiere revisión:', {
        reference: chargeId,
        detail: error.detail,
      })
      return NextResponse.json(
        { status: 'conflict', reason: 'commission_review_required' },
        { status: 409 }
      )
    }

    // Error transitorio: el bot reintenta y nunca confirma la compra.
    console.error('[gem-payments] Error aplicando pago:', {
      reference: chargeId,
      message: error?.message,
    })
    return NextResponse.json(
      { status: 'error', reason: 'apply_failed' },
      { status: 503 }
    )
  }
}
