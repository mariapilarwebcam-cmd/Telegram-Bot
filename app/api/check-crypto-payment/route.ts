// app/api/check-crypto-payment/route.ts

import { NextResponse } from 'next/server'
import { authenticateTelegramRequest } from '@/lib/telegram-auth'
import {
  getUser,
  proveAppliedPurchase,
  applyGemPurchaseAtomic,
  resolveCommissionTarget,
  type CommissionTarget,
  type GemPurchaseOutcome,
  getLastPurchase, // ✅ FIX #1: Importado para unificar lógica de VIPs
} from '@/lib/db-queries'
import { resolveCryptoPurchase } from '@/lib/gem-payments'
import {
  CRYPTO_PACKAGES,
  MESSAGE_PACKAGES,
  HYBRID_PACKAGES,
} from '@/lib/constants'

const TONAPI_KEY = process.env.TONAPI_KEY || ''
const RECIPIENT_WALLET =
  process.env.TON_RECIPIENT_WALLET || 'UQCt76T3JPW3WrpsfIz6Tc1eVrvkrQpwV0-3sk1so4P8Vd4-'

const USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'

const VALID_PACKAGE_TYPES = ['gems', 'messages', 'hybrid'] as const
type PackageType = (typeof VALID_PACKAGE_TYPES)[number]

function isPackageType(v: any): v is PackageType {
  return VALID_PACKAGE_TYPES.includes(v)
}

// ═══════════════════════════════════════════════════════════════
// POST /api/check-crypto-payment
// ═══════════════════════════════════════════════════════════════
export async function POST(request: Request) {
  let tidFromAuth: string

  try {
    const authentication = await authenticateTelegramRequest(request)

    if (authentication.ok === false) {
      return NextResponse.json(
        { error: authentication.error },
        { status: authentication.status }
      )
    }

    tidFromAuth = authentication.telegramId
  } catch {
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }

  try {
    const body = await request.json().catch(() => ({}))
    const reference = typeof body.reference === 'string' ? body.reference : ''

    if (!reference) {
      return NextResponse.json({ error: 'Reference requerido' }, { status: 400 })
    }

    // ✅ Formato: TABOO_<telegram_id>_<package_type>_<package_index>_<timestamp>
    const parts = reference.split('_')
    if (parts.length < 5 || parts[0] !== 'TABOO') {
      return NextResponse.json({ error: 'Reference inválido' }, { status: 400 })
    }

    const telegramId = parts[1]
    const packageType = parts[2]
    const packageIndex = parseInt(parts[3], 10)

    if (telegramId !== tidFromAuth) {
      console.warn('[check-crypto-payment] Reference no coincide:', {
        telegramId,
        tidFromAuth,
      })
      return NextResponse.json(
        { error: 'Reference no coincide con la sesión' },
        { status: 403 }
      )
    }

    if (!isPackageType(packageType)) {
      console.warn('[check-crypto-payment] packageType inválido:', packageType)
      return NextResponse.json({ error: 'package_type inválido' }, { status: 400 })
    }

    const isMessages = packageType === 'messages'
    const isHybrid = packageType === 'hybrid'
    const activePackages = isHybrid
      ? HYBRID_PACKAGES
      : isMessages
        ? MESSAGE_PACKAGES
        : CRYPTO_PACKAGES

    if (
      isNaN(packageIndex) ||
      packageIndex >= activePackages.length ||
      packageIndex < 0
    ) {
      return NextResponse.json({ error: 'Package index inválido' }, { status: 400 })
    }

    // ─── Plan derivado del catálogo (importes y recursos del servidor) ───
    const resolvedPlan = resolveCryptoPurchase({
      package_type: packageType,
      package_index: packageIndex,
      reference,
    })

    if (!resolvedPlan.ok) {
      console.error('[check-crypto-payment] Paquete no resoluble:', {
        reference,
        reason: resolvedPlan.reason,
      })
      return NextResponse.json({ error: 'Paquete no válido' }, { status: 400 })
    }

    const plan = resolvedPlan.plan

    // ─── Idempotencia estricta por reference ───
    // Se reutiliza la misma prueba que aplica la transacción: usuario, cargo,
    // método, importes y movimiento contable esperado. Una compra antigua
    // ('review_required') o inconsistente NUNCA se da por duplicada: se
    // responde conflicto sin acreditar.
    const previous = await proveAppliedPurchase(
      { telegram_id: telegramId, telegram_charge_id: reference },
      plan
    )

    if (previous.state === 'applied') {
      const u = await getUser(telegramId)
      return NextResponse.json({
        status: 'paid',
        already: true,
        remaining_gems: u?.gems || 0,
        remaining_purchased_gems: u?.purchased_gems || 0,
        remaining_bonus_gems: u?.bonus_gems || 0,
      })
    }

    if (previous.state === 'conflict' && previous.reason !== 'purchase_absent') {
      console.error('[check-crypto-payment] ⚠️ Cargo requiere conciliación:', {
        reference,
        reason: previous.reason,
      })
      return NextResponse.json({
        status: 'error',
        reason: 'conflict',
        reference,
        message: `El pago (${reference}) figura registrado pero no pudimos verificar su acreditación. Contacta a soporte con esta referencia.`,
      })
    }

    // ─── Consultar TonAPI ───
    // ✅ FIX #2: Aumentado a 1000 para evitar que el pago se "pierda" si hay mucha actividad
    const url = `https://tonapi.io/v2/accounts/${RECIPIENT_WALLET}/events?limit=1000`
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (TONAPI_KEY) headers['Authorization'] = `Bearer ${TONAPI_KEY}`

    const res = await fetch(url, { headers, cache: 'no-store' })

    if (!res.ok) {
      console.warn('[check-crypto-payment] TonAPI error:', res.status)
      return NextResponse.json({ status: 'pending', reason: 'tonapi_error' })
    }

    const data = await res.json()
    const events = data.events || []

    let matchedAction: any = null

    for (const ev of events) {
      for (const action of ev.actions || []) {
        if (action.type !== 'JettonTransfer') continue
        const jt = action.JettonTransfer
        if (!jt) continue

        if (jt.comment === reference) {
          if (jt.jetton?.address === USDT_MASTER) {
            matchedAction = jt
            break
          }
        }
      }
      if (matchedAction) break
    }

    if (!matchedAction) {
      return NextResponse.json({ status: 'pending' })
    }

    const pkg = activePackages[packageIndex]
    const expectedUnits = Math.round(pkg.usdt * 1_000_000)

    const rawAmount = matchedAction.amount
    const receivedUnits =
      typeof rawAmount === 'string'
        ? parseInt(rawAmount, 10)
        : typeof rawAmount === 'number'
          ? rawAmount
          : 0

    if (isNaN(receivedUnits) || receivedUnits <= 0) {
      console.warn('[check-crypto-payment] Invalid amount:', {
        rawAmount,
        reference,
      })
      return NextResponse.json({ status: 'pending', reason: 'invalid_amount' })
    }

    if (receivedUnits < expectedUnits - 1000) {
      return NextResponse.json({ status: 'pending', reason: 'amount_mismatch' })
    }

    // ✅ FIX #1: Verificar first_time_only Y is_first_purchase usando getLastPurchase
    // (que ya incluye suscripciones VIP)
    const priorPurchase = await getLastPurchase(telegramId)
    const isUserFirstPurchase = !priorPurchase

    if (pkg.first_time_only && priorPurchase) {
      console.error('[check-crypto-payment] ❌ first_time_used:', {
        telegramId,
        reference,
      })
      return NextResponse.json({ status: 'error', reason: 'first_time_used' })
    }

    const user = await getUser(telegramId)
    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    // (1) Base de comisión EXCLUSIVAMENTE del plan validado del servidor.
    const commissionBase =
      plan.credit_gems + Math.floor(plan.credit_messages / 3)

    // (2) Referidor resuelto en servidor (users.referred_by), después de
    // verificar pago, importe y referencia, y antes de la transacción.
    // Contrato: commission_lookup_failed ⇒ 503 reintentable;
    // commission_referrer_missing ⇒ 200 con review_required. Ninguno consume
    // el reference, por lo que el pago puede aplicarse después.
    let commission: CommissionTarget | null = null
    try {
      const resolvedCommission = await resolveCommissionTarget(
        telegramId,
        commissionBase
      )
      if (resolvedCommission.status === 'resolved') {
        commission = resolvedCommission.target
      } else if (resolvedCommission.status === 'referrer_missing') {
        console.error(
          '[check-crypto-payment] referidor inexistente; pago pendiente de revisión:',
          { reference, telegramId }
        )
        return NextResponse.json({
          status: 'error',
          reason: 'commission_referrer_missing',
          reference,
          review_required: true,
        })
      }
    } catch (lookupError: any) {
      console.error(
        '[check-crypto-payment] comisión no resoluble; pago pendiente:',
        { reference, message: lookupError?.message }
      )
      return NextResponse.json(
        {
          status: 'error',
          reason: 'commission_lookup_failed',
          reference,
          retryable: true,
        },
        { status: 503 }
      )
    }

    // ─── Aplicación atómica: cargo + recursos + movimiento contable ───
    // H-3: registro, acreditación, asiento y status='applied' se confirman en
    // una única transacción. Si algo falla se revierte todo y el sondeo del
    // cliente puede reintentar el mismo reference.
    let outcome: GemPurchaseOutcome
    try {
      outcome = await applyGemPurchaseAtomic({
        telegram_id: telegramId,
        telegram_charge_id: reference,
        is_first_purchase: isUserFirstPurchase,
        plan,
        ...(commission ? { commission } : {}),
      })
    } catch (creditError: any) {
      console.error('[check-crypto-payment] ❌ Error acreditando balance:', creditError)
      return NextResponse.json({
        status: 'error',
        reason: 'credit_failed',
        reference,
        message: `Pago recibido (${reference}) pero hubo un error acreditando tu balance. Contacta a soporte con esta referencia.`,
      })
    }

    if (outcome.status === 'duplicate') {
      // Cargo ya aplicado y verificado: se informa sin volver a acreditar.
      console.log('[check-crypto-payment] Charge ya procesado, ignorando')
      const u = await getUser(telegramId)
      return NextResponse.json({
        status: 'paid',
        already: true,
        remaining_gems: u?.gems || 0,
        remaining_purchased_gems: u?.purchased_gems || 0,
        remaining_bonus_gems: u?.bonus_gems || 0,
      })
    }

    if (outcome.status === 'conflict') {
      console.error('[check-crypto-payment] ⚠️ Cargo requiere conciliación:', {
        reference,
        reason: outcome.reason,
      })
      return NextResponse.json({
        status: 'error',
        reason: 'conflict',
        reference,
        message: `El pago (${reference}) figura registrado pero no pudimos verificar su acreditación. Contacta a soporte con esta referencia.`,
      })
    }

    if (outcome.status === 'user_missing') {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    if (outcome.commission_note === 'commission_transient_failure') {
      console.error(
        '[check-crypto-payment] comisión pendiente de conciliación:',
        { reference }
      )
    }

    return NextResponse.json({
      status: 'paid',
      commission_applied: outcome.commission_applied,
      commission_pending:
        outcome.commission_note === 'commission_transient_failure',
      amount_added: isMessages ? plan.credit_messages : plan.credit_gems,
      gems_added: plan.credit_gems,
      messages_added: plan.credit_messages,
      is_messages: isMessages,
      is_hybrid: isHybrid,
      remaining_gems: outcome.gems,
      remaining_purchased_gems: outcome.purchased_gems,
      remaining_bonus_gems: outcome.bonus_gems,
    })
  } catch (e: any) {
    console.error('[check-crypto-payment] Error:', e)
    return NextResponse.json(
      { error: e?.message || 'Error interno' },
      { status: 500 }
    )
  }
}
