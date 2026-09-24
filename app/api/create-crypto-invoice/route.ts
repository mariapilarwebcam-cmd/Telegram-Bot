// app/api/create-crypto-invoice/route.ts

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { CRYPTO_PACKAGES, getFinalCryptoGems } from '@/lib/constants'

// ⚠️ Tu wallet de Tonkeeper para recibir USDT
const RECIPIENT_WALLET = process.env.TON_RECIPIENT_WALLET || 'UQCt76T3JPW3WrpsfIz6Tc1eVrvkrQpwV0-3sk1so4P8Vd4-'

export async function POST(request: Request) {
  try {
    const { telegram_id, package_id } = await request.json()
    const tid = String(telegram_id)

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
      const { data: purchases } = await supabaseAdmin
        .from('star_purchases')
        .select('id')
        .eq('telegram_id', tid)
        .limit(1)

      if (purchases && purchases.length > 0) {
        return NextResponse.json({ error: 'Paquete no disponible' }, { status: 400 })
      }
    }

    // Verificar usuario
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('telegram_id')
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
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
        first_time_bonus_percent: pkg.first_time_bonus_percent || 0,
        total_gems: finalGems,
      },
    })
  } catch (e: any) {
    console.error('[create-crypto-invoice] Error:', e)
    return NextResponse.json({ error: e.message || 'Error interno' }, { status: 500 })
  }
}