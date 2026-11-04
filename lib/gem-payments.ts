// lib/gem-payments.ts
// Derivación server-side del plan de acreditación de gemas / pases.
//
// El endpoint interno de Stars recibe SOLO hechos del pago (payload de la
// factura, importe cobrado, moneda e identidad). Ni los importes a acreditar
// ni los recursos se aceptan desde fuera: se derivan del catálogo del servidor
// y se validan contra lo efectivamente cobrado.

import { timingSafeEqual } from 'crypto'
import {
  STAR_PACKAGES,
  CRYPTO_PACKAGES,
  MESSAGE_PACKAGES,
  HYBRID_PACKAGES,
  getFinalGems,
  getFinalStarMessages,
  getFinalCryptoGems,
  getFinalCryptoMessages,
} from './constants'

export type GemRail = 'stars' | 'crypto'
export type GemPackageType = 'gems' | 'messages' | 'hybrid'

export type GemPurchasePlan = {
  rail: GemRail
  type: GemPackageType
  stars_amount: number
  gems_amount: number
  credit_gems: number
  credit_messages: number
  payment_method: string
  ledger: { amount: number; type: string; description: string } | null
  requiresLedger: boolean
}

export type GemPlanError =
  | 'invalid_payload'
  | 'invalid_package'
  | 'invalid_currency'
  | 'amount_mismatch'

export type GemPlanResult =
  | { ok: true; plan: GemPurchasePlan }
  | { ok: false; reason: GemPlanError }

// Autenticación entre servicios: mismo patrón constante que usa el worker VIP,
// con secreto propio para no acoplar ni modificar el sistema VIP.
export function authorizedGemWorker(
  header: string | null,
  secret: string | undefined
): boolean {
  if (!secret || !header) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const received = Buffer.from(header)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

const STAR_PREFIXES: Array<[string, GemPackageType]> = [
  ['gem_purchase_', 'gems'],
  ['message_purchase_', 'messages'],
  ['hybrid_purchase_', 'hybrid'],
]

function parseIndex(raw: string): number | null {
  if (!/^\d{1,3}$/.test(raw)) return null
  const index = Number(raw)
  return Number.isSafeInteger(index) ? index : null
}

// Stars: el payload de la factura identifica el paquete y `total_amount` debe
// coincidir exactamente con el precio del catálogo para ese paquete.
export function resolveStarPurchase(input: {
  invoice_payload: unknown
  currency: unknown
  total_amount: unknown
}): GemPlanResult {
  if (String(input.currency) !== 'XTR') {
    return { ok: false, reason: 'invalid_currency' }
  }
  if (
    typeof input.total_amount !== 'number' ||
    !Number.isSafeInteger(input.total_amount) ||
    input.total_amount <= 0
  ) {
    return { ok: false, reason: 'amount_mismatch' }
  }
  if (typeof input.invoice_payload !== 'string') {
    return { ok: false, reason: 'invalid_payload' }
  }
  const payload = input.invoice_payload

  const match = STAR_PREFIXES.find(([prefix]) => payload.startsWith(prefix))
  if (!match) return { ok: false, reason: 'invalid_payload' }

  const [prefix, type] = match
  const index = parseIndex(payload.slice(prefix.length))
  if (index === null) return { ok: false, reason: 'invalid_payload' }

  const catalog =
    type === 'hybrid'
      ? HYBRID_PACKAGES
      : type === 'messages'
        ? MESSAGE_PACKAGES
        : STAR_PACKAGES

  if (index >= catalog.length) return { ok: false, reason: 'invalid_package' }

  const pkg: any = catalog[index]
  if (Number(pkg.stars) !== input.total_amount) {
    return { ok: false, reason: 'amount_mismatch' }
  }

  let credit_gems = 0
  let credit_messages = 0

  if (type === 'hybrid') {
    credit_gems = Number(pkg.stars_final_gems)
    credit_messages = Number(pkg.stars_final_messages)
  } else if (type === 'messages') {
    credit_messages = getFinalStarMessages(pkg)
  } else {
    credit_gems = getFinalGems(pkg)
  }

  // Comportamiento previo del bot: el movimiento contable de Stars solo se
  // crea cuando hay gemas (los paquetes de mensajes no lo generaban).
  const ledger =
    type === 'messages'
      ? null
      : {
          amount: credit_gems,
          type: 'purchase',
          description: `Compra con ${Number(pkg.stars)} stars`,
        }

  return {
    ok: true,
    plan: {
      rail: 'stars',
      type,
      stars_amount: Number(pkg.stars),
      gems_amount: type === 'messages' ? 0 : credit_gems,
      credit_gems,
      credit_messages,
      // Mismos valores que escribía el bot: gems | messages | hybrid
      payment_method: type,
      ledger,
      requiresLedger: ledger !== null,
    },
  }
}

// Crypto: los valores también se derivan del catálogo del servidor. El importe
// on-chain se valida en check-crypto-payment antes de construir este plan.
export function resolveCryptoPurchase(input: {
  package_type: GemPackageType
  package_index: number
  reference: string
}): GemPlanResult {
  const index = input.package_index
  if (!Number.isSafeInteger(index) || index < 0) {
    return { ok: false, reason: 'invalid_package' }
  }

  const catalog =
    input.package_type === 'hybrid'
      ? HYBRID_PACKAGES
      : input.package_type === 'messages'
        ? MESSAGE_PACKAGES
        : CRYPTO_PACKAGES

  if (index >= catalog.length) return { ok: false, reason: 'invalid_package' }

  const pkg: any = catalog[index]
  const expectedUnits = Math.round(Number(pkg.usdt) * 1_000_000)
  if (!Number.isSafeInteger(expectedUnits) || expectedUnits <= 0) {
    return { ok: false, reason: 'invalid_package' }
  }

  const usdtAmount = expectedUnits / 1_000_000

  let credit_gems = 0
  let credit_messages = 0

  if (input.package_type === 'hybrid') {
    credit_gems = Number(pkg.crypto_final_gems)
    credit_messages = Number(pkg.crypto_final_messages)
  } else if (input.package_type === 'messages') {
    credit_messages = getFinalCryptoMessages(pkg)
  } else {
    credit_gems = getFinalCryptoGems(pkg)
  }

  const ledgerType =
    input.package_type === 'hybrid'
      ? 'crypto_purchase_hybrid'
      : input.package_type === 'messages'
        ? 'crypto_purchase_messages'
        : 'crypto_purchase'

  // Igual que antes: el paquete de solo mensajes registra importe 0.
  const ledgerAmount = input.package_type === 'messages' ? 0 : credit_gems

  const description =
    input.package_type === 'hybrid'
      ? `Compra crypto híbrida ${usdtAmount} USDT - ${credit_gems} gemas + ${credit_messages} mensajes (${input.reference})`
      : input.package_type === 'messages'
        ? `Compra crypto ${usdtAmount} USDT - ${credit_messages} mensajes (${input.reference})`
        : `Compra crypto ${usdtAmount} USDT - ${credit_gems} gemas (${input.reference})`

  return {
    ok: true,
    plan: {
      rail: 'crypto',
      type: input.package_type,
      stars_amount: 0,
      gems_amount: input.package_type === 'messages' ? 0 : credit_gems,
      credit_gems,
      credit_messages,
      payment_method:
        input.package_type === 'hybrid'
          ? 'crypto_hybrid'
          : input.package_type === 'messages'
            ? 'crypto_messages'
            : 'crypto',
      ledger: { amount: ledgerAmount, type: ledgerType, description },
      requiresLedger: true,
    },
  }
}

