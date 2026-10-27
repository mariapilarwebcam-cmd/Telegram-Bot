// app/api/create-crypto-invoice/route.ts

import { NextResponse } from 'next/server'
import { getLastPurchase, getUser } from '@/lib/db-queries'
import { CRYPTO_PACKAGES, MESSAGE_PACKAGES, HYBRID_PACKAGES, getFinalCryptoGems } from '@/lib/constants'

const RECIPIENT_WALLET =
  process.env.NEXT_PUBLIC_TON_RECIPIENT_WALLET ||
  'UQCt76T3JPW3WrpsfIz6Tc1eVrvkrQpwV0-3sk1so4P8Vd4-'

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { package_id, package_type } = body

    // ✅ NUEVO: Determinamos qué paquete usar (Híbrido, Mensajes o Gemas)
    const isMessages = package_type === 'messages'
    const isHybrid = package_type === 'hybrid'
    const activePackages = isHybrid ? HYBRID_PACKAGES : (isMessages ? MESSAGE_PACKAGES : CRYPTO_PACKAGES)

    if (
      typeof package_id !== 'number' ||
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

    // Verificar first_time_only
    if (pkg.first_time_only) {
      const purchase = await getLastPurchase(tid)
      if (purchase) {
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
    // ✅ Incluye el tipo (gems, messages, hybrid) para que el verificador sepa qué entregar
    const reference = `TABOO_${tid}_${package_type || 'gems'}_${package_id}_${Date.now()}`

    // ✅ NUEVO: Calcular cantidades finales según el tipo de paquete
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
      finalMessages = (pkg as any).messages
      baseMessages = (pkg as any).messages
    } else {
      finalGems = getFinalCryptoGems(pkg as any)
      baseGems = (pkg as any).gems
      firstTimeBonus = (pkg as any).first_time_bonus || 0
    }

    return NextResponse.json({
      payment_data: {
        amount: pkg.usdt,
        recipientAddr: RECIPIENT_WALLET,
        reference,
      },
      package: {
        usdt: pkg.usdt,
        gems: baseGems,
        messages: baseMessages,
        bonus: (pkg as any).bonus || 0,
        first_time_bonus: firstTimeBonus,
        total_gems: finalGems,
        total_messages: finalMessages,
        is_hybrid: isHybrid,
      },
    })
  } catch (e: any) {
    console.error('[create-crypto-invoice] Error:', e)
    return NextResponse.json(
      { error: e.message || 'Error interno' },
      { status: 500 }
    )
  }
}
