// app/api/create-crypto-invoice/route.ts

import { NextResponse } from 'next/server'
import { getLastPurchase, getUser } from '@/lib/db-queries'
import { CRYPTO_PACKAGES, MESSAGE_PACKAGES, getFinalCryptoGems } from '@/lib/constants'

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

    // ✅ NUEVO: Determinamos qué paquete usar
    const isMessages = package_type === 'messages'
    const activePackages = isMessages ? MESSAGE_PACKAGES : CRYPTO_PACKAGES

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
    // ✅ NUEVO: Añadimos el tipo al reference para saber qué entregar
    const reference = `TABOO_${tid}_${package_type || 'gems'}_${package_id}_${Date.now()}`

    const finalAmount = isMessages ? (pkg as any).messages : getFinalCryptoGems(pkg as any)

    return NextResponse.json({
      payment_data: {
        amount: pkg.usdt,
        recipientAddr: RECIPIENT_WALLET,
        reference,
      },
      package: {
        usdt: pkg.usdt,
        gems: isMessages ? 0 : (pkg as any).gems,
        messages: isMessages ? (pkg as any).messages : 0,
        bonus: isMessages ? 0 : (pkg as any).bonus,
        first_time_bonus: isMessages ? 0 : ((pkg as any).first_time_bonus || 0),
        total_gems: isMessages ? 0 : finalAmount,
        total_messages: isMessages ? finalAmount : 0,
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
