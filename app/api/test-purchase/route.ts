// app/api/test-purchase/route.ts

import { NextResponse } from 'next/server'
import { getUser, incrementGemsAndPurchased, insertGemTransaction } from '@/lib/db-queries'
import { queryOne } from '@/lib/turso'
import {
  STAR_PACKAGES,
  CRYPTO_PACKAGES,
  MESSAGE_PACKAGES,
  HYBRID_PACKAGES,
  getFinalGems,
  getFinalCryptoGems
} from '@/lib/constants'

export async function POST(request: Request) {
  try {
    // 🛡️ SEGURIDAD: Solo permitir si estamos en desarrollo o si se pasa un secreto
    // (Si estás en Vercel, asegúrate de tener NODE_ENV en 'production' para bloquearlo)
    const isDev = process.env.NODE_ENV === 'development'
    const secret = request.headers.get('x-test-secret')
    
    if (!isDev && secret !== 'TABOO_TEST_123') {
      return NextResponse.json({ error: 'No autorizado (Endpoint de prueba)' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const { telegram_id, package_type, package_id, payment_method } = body

    if (!telegram_id || !package_type || package_id === undefined || !payment_method) {
      return NextResponse.json({ error: 'Faltan parámetros (telegram_id, package_type, package_id, payment_method)' }, { status: 400 })
    }

    const tid = String(telegram_id)
    const user = await getUser(tid)
    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    const isHybrid = package_type === 'hybrid'
    const isMessages = package_type === 'messages'
    const isCrypto = payment_method === 'crypto'

    // 1. Seleccionar el paquete correcto
    let activePackages
    if (isHybrid) activePackages = HYBRID_PACKAGES
    else if (isMessages) activePackages = MESSAGE_PACKAGES
    else activePackages = isCrypto ? CRYPTO_PACKAGES : STAR_PACKAGES

    const pkg = activePackages[package_id]
    if (!pkg) {
      return NextResponse.json({ error: 'Paquete no válido' }, { status: 400 })
    }

    // 2. Calcular cuánto dar
    let gemsToAdd = 0
    let messagesToAdd = 0

    if (isHybrid) {
      gemsToAdd = isCrypto ? (pkg as any).crypto_final_gems : (pkg as any).stars_final_gems
      messagesToAdd = isCrypto ? (pkg as any).crypto_final_messages : (pkg as any).stars_final_messages
    } else if (isMessages) {
      // Usamos el bono real según el método de pago
      messagesToAdd = isCrypto 
        ? Math.floor((pkg as any).messages * (1 + ((pkg as any).crypto_bonus || 0) / 100))
        : Math.floor((pkg as any).messages * (1 + ((pkg as any).star_bonus || 0) / 100))
    } else {
      gemsToAdd = isCrypto ? getFinalCryptoGems(pkg as any) : getFinalGems(pkg as any)
    }

    // 3. Actualizar la Base de Datos (Simulando el webhook)
    let newGems = user.gems || 0
    let newPurchasedGems = user.purchased_gems || 0
    let newBonusGems = user.bonus_gems || 0

    // Sumar Gemas
    if (gemsToAdd > 0) {
      const rpcGems = await incrementGemsAndPurchased(tid, gemsToAdd)
      newGems = rpcGems.new_gems
      newPurchasedGems = rpcGems.new_purchased
    }

    // Sumar Mensajes
    if (messagesToAdd > 0) {
      const rpcMessages = await queryOne<{ bonus_gems: number }>(
        `UPDATE users 
         SET bonus_gems = COALESCE(bonus_gems, 0) + ?, 
             hook_messages_remaining = 0
         WHERE telegram_id = ? 
         RETURNING bonus_gems`,
        [messagesToAdd, tid]
      )
      newBonusGems = rpcMessages?.bonus_gems ?? newBonusGems
    }

    // 4. Registrar la transacción
    await insertGemTransaction({
      telegram_id: tid,
      amount: isMessages ? messagesToAdd : gemsToAdd,
      transaction_type: `test_purchase_${package_type}`,
      description: `[TEST] Compra de ${package_type} con ${payment_method}`,
    })

    // 5. Devolver la respuesta
    return NextResponse.json({
      success: true,
      message: 'Compra simulada con éxito',
      gems_added: gemsToAdd,
      messages_added: messagesToAdd,
      remaining_gems: newGems,
      remaining_bonus_gems: newBonusGems,
    })

  } catch (e: any) {
    console.error('[test-purchase] Error:', e)
    return NextResponse.json({ error: e.message || 'Error interno' }, { status: 500 })
  }
}