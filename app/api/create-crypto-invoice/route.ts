// app/api/create-crypto-invoice/route.ts

import { NextResponse } from 'next/server'
import { getLastPurchase, getUser, getActiveSubscription } from '@/lib/db-queries'
import {
  CRYPTO_PACKAGES,
  MESSAGE_PACKAGES,
  HYBRID_PACKAGES,
  getFinalCryptoGems,
  getFinalCryptoMessages, // ✅ FIX #5: Importado correctamente
} from '@/lib/constants'

const RECIPIENT_WALLET =
  process.env.NEXT_PUBLIC_TON_RECIPIENT_WALLET ||
  'UQCt76T3JPW3WrpsfIz6Tc1eVrvkrQpwV0-3sk1so4P8Vd4-'

// ✅ FIX #3: Validar package_type contra valores permitidos
const VALID_PACKAGE_TYPES = ['gems', 'messages', 'hybrid'] as const
type PackageType = (typeof VALID_PACKAGE_TYPES)[number]

function isPackageType(v: any): v is PackageType {
  return VALID_PACKAGE_TYPES.includes(v)
}

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { package_id, package_type } = body

    // ✅ FIX #3: Validar package_type explícitamente. Si no viene, default a 'gems'.
    const normalizedType: PackageType =
      package_type === undefined || package_type === null
        ? 'gems'
        : isPackageType(package_type)
          ? package_type
          : (() => {
              throw new Error('package_type inválido')
            })()

    const isMessages = normalizedType === 'messages'
    const isHybrid = normalizedType === 'hybrid'
    const activePackages = isHybrid
      ? HYBRID_PACKAGES
      : isMessages
        ? MESSAGE_PACKAGES
        : CRYPTO_PACKAGES

    if (
      typeof package_id !== 'number' ||
      !Number.isInteger(package_id) ||
      package_id >= activePackages.length ||
      package_id < 0
    ) {
      return NextResponse.json({ error: 'Paquete no válido' }, { status: 400 })
    }

    if (!RECIPIENT_WALLET || RECIPIENT_WALLET.length < 40) {
      console.error('[create-crypto-invoice] RECIPIENT_WALLET no configurada')
      return NextResponse.json(
        { error: 'Configuración incompleta: falta la wallet de destino' },
        { status: 500 }
      )
    }

    const pkg = activePackages[package_id]

    // ✅ FIX #4: Validar que pkg.usdt sea un número positivo
    const usdtAmount = (pkg as any).usdt
    if (typeof usdtAmount !== 'number' || isNaN(usdtAmount) || usdtAmount <= 0) {
      console.error('[create-crypto-invoice] Paquete sin usdt válido:', {
        package_id,
        package_type: normalizedType,
        usdtAmount,
      })
      return NextResponse.json(
        { error: 'Paquete con configuración inválida' },
        { status: 500 }
      )
    }

    // ✅ FIX #2: Verificar first_time_only considerando compras previas Y suscripción VIP
    if ((pkg as any).first_time_only) {
      const [priorPurchase, activeSub] = await Promise.all([
        getLastPurchase(tid),
        getActiveSubscription(tid),
      ])

      if (priorPurchase || activeSub) {
        return NextResponse.json(
          { error: 'Paquete no disponible' },
          { status: 400 }
        )
      }
    }

    // Verificar usuario
    const user = await getUser(tid)
    if (!user) {
      return NextResponse.json(
        { error: 'Usuario no encontrado' },
        { status: 404 }
      )
    }

    // Reference único — se envía como comentario en la transacción USDT
    const reference = `TABOO_${tid}_${normalizedType}_${package_id}_${Date.now()}`

    // ✅ Calcular cantidades finales según el tipo de paquete
    let finalGems = 0
    let finalMessages = 0
    let baseGems = 0
    let baseMessages = 0
    let firstTimeBonus = 0

    if (isHybrid) {
      // Usar los valores precalculados de crypto del paquete híbrido
      finalGems = (pkg as any).crypto_final_gems
      finalMessages = (pkg as any).crypto_final_messages
      baseGems = (pkg as any).gems
      baseMessages = (pkg as any).messages
    } else if (isMessages) {
      // ✅ FIX #1: Aplicar getFinalCryptoMessages (bono crypto del 20%)
      // Antes se usaba (pkg as any).messages base, lo que entregaba 300 en vez de 360
      finalMessages = getFinalCryptoMessages(pkg as any)
      baseMessages = (pkg as any).messages
    } else {
      // Gemas regulares de crypto (usa getFinalCryptoGems que ya maneja pkg.bonus)
      finalGems = getFinalCryptoGems(pkg as any)
      baseGems = (pkg as any).gems
      firstTimeBonus = (pkg as any).first_time_bonus || 0
    }

    return NextResponse.json({
      payment_data: {
        amount: usdtAmount,
        recipientAddr: RECIPIENT_WALLET,
        reference,
      },
      package: {
        usdt: usdtAmount,
        gems: baseGems,
        messages: baseMessages,
        bonus: (pkg as any).bonus || 0,
        crypto_bonus: (pkg as any).crypto_bonus || 0,
        first_time_bonus: firstTimeBonus,
        total_gems: finalGems,
        total_messages: finalMessages,
        is_hybrid: isHybrid,
        is_messages: isMessages,
      },
    })
  } catch (e: any) {
    console.error('[create-crypto-invoice] Error:', e)

    // ✅ FIX #3: Manejo específico del error de package_type inválido
    if (e?.message === 'package_type inválido') {
      return NextResponse.json(
        { error: 'Tipo de paquete inválido' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: e.message || 'Error interno' },
      { status: 500 }
    )
  }
}
