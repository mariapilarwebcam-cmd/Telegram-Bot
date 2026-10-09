// app/api/create-crypto-invoice/route.ts

import { NextResponse } from 'next/server'
import { getLastPurchase, getUser } from '@/lib/db-queries'
import { CRYPTO_PACKAGES, getFinalCryptoGems } from '@/lib/constants'

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
    const { package_id } = body

    if (
      typeof package_id !== 'number' ||
      package_id >= CRYPTO_PACKAGES.length ||
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

    const pkg = CRYPTO_PACKAGES[package_id]

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
    // Formato: TABOO_<telegram_id>_<package_index>_<timestamp>
    const reference = `TABOO_${tid}_${package_id}_${Date.now()}`

    const finalGems = getFinalCryptoGems(pkg)

    return NextResponse.json({
      payment_data: {
        amount: pkg.usdt,
        recipientAddr: RECIPIENT_WALLET,
        reference,
      },
      package: {
        usdt: pkg.usdt,
        gems: pkg.gems,
        bonus: pkg.bonus,
        first_time_bonus: pkg.first_time_bonus || 0,
        total_gems: finalGems,
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
