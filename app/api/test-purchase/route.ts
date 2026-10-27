// app/api/test-purchase/route.ts

import { NextResponse } from 'next/server'
import { getUser, incrementGemsAndPurchased, insertGemTransaction } from '@/lib/db-queries'
import { queryOne, execute } from '@/lib/turso'
import {
  STAR_PACKAGES,
  CRYPTO_PACKAGES,
  MESSAGE_PACKAGES,
  HYBRID_PACKAGES,
  VIP_PLANS,
  getFinalGems,
  getFinalCryptoGems
} from '@/lib/constants'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-test-secret',
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

export async function POST(request: Request) {
  try {
    const secret = request.headers.get('x-test-secret')
    
    if (secret !== 'TABOO_TEST_123') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403, headers: corsHeaders })
    }

    const body = await request.json().catch(() => ({}))
    const { telegram_id, package_type, package_id, plan_id, payment_method } = body

    if (!telegram_id || !package_type || !payment_method) {
      return NextResponse.json({ error: 'Faltan parámetros' }, { status: 400, headers: corsHeaders })
    }

    const tid = String(telegram_id)
    const user = await getUser(tid)
    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404, headers: corsHeaders })
    }

    // ✅ NUEVO: Lógica para VIP
    if (package_type === 'vip') {
      const plan = VIP_PLANS.find(p => p.id === plan_id)
      if (!plan) return NextResponse.json({ error: 'Plan VIP no válido' }, { status: 400, headers: corsHeaders })

      const days = plan.days
      const charge_id = `test_vip_${payment_method}_${Date.now()}`

      // Verificar si ya tiene una suscripción activa
      const currentSub = await queryOne<{ expires_at: string }>(
        `SELECT expires_at FROM subscriptions WHERE telegram_id = ? AND status = 'active' AND expires_at > datetime('now') LIMIT 1`,
        [tid]
      )

      if (currentSub && currentSub.expires_at) {
        // Extender
        await execute(
          `UPDATE subscriptions SET expires_at = datetime(expires_at, '+' || ? || ' days') WHERE telegram_id = ? AND status = 'active'`,
          [days, tid]
        )
      } else {
        // Crear nueva
        const expires_at = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
        await execute(
          `INSERT INTO subscriptions (telegram_id, plan, stars_paid, telegram_charge_id, expires_at, status) VALUES (?, ?, ?, ?, ?, 'active')`,
          [tid, plan_id, plan.stars, charge_id, expires_at]
        )
      }

      return NextResponse.json({
        success: true,
        message: `Suscripción VIP ${plan_id} simulada con éxito (${days} días añadidos)`,
      }, { headers: corsHeaders })
    }

    // ... (El resto de tu código para gemas, mensajes e híbridos se mantiene exactamente igual)
    const isHybrid = package_type === 'hybrid'
    const isMessages = package_type === 'messages'
    const isCrypto = payment_method === 'crypto'

    let activePackages
    if (isHybrid) activePackages = HYBRID_PACKAGES
    else if (isMessages) activePackages = MESSAGE_PACKAGES
    else activePackages = isCrypto ? CRYPTO_PACKAGES : STAR_PACKAGES

    const pkg = activePackages[package_id]
    if (!pkg) {
      return NextResponse.json({ error: 'Paquete no válido' }, { status: 400, headers: corsHeaders })
    }

    let gemsToAdd = 0
    let messagesToAdd = 0

    if (isHybrid) {
      gemsToAdd = isCrypto ? (pkg as any).crypto_final_gems : (pkg as any).stars_final_gems
      messagesToAdd = isCrypto ? (pkg as any).crypto_final_messages : (pkg as any).stars_final_messages
    } else if (isMessages) {
      messagesToAdd = isCrypto 
        ? Math.floor((pkg as any).messages * (1 + ((pkg as any).crypto_bonus || 0) / 100))
        : Math.floor((pkg as any).messages * (1 + ((pkg as any).star_bonus || 0) / 100))
    } else {
      gemsToAdd = isCrypto ? getFinalCryptoGems(pkg as any) : getFinalGems(pkg as any)
    }

    let newGems = user.gems || 0
    let newPurchasedGems = user.purchased_gems || 0
    let newBonusGems = user.bonus_gems || 0

    if (gemsToAdd > 0) {
      const rpcGems = await incrementGemsAndPurchased(tid, gemsToAdd)
      newGems = rpcGems.new_gems
      newPurchasedGems = rpcGems.new_purchased
    }

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

    await insertGemTransaction({
      telegram_id: tid,
      amount: isMessages ? messagesToAdd : gemsToAdd,
      transaction_type: `test_purchase_${package_type}`,
      description: `[TEST] Compra de ${package_type} con ${payment_method}`,
    })

    return NextResponse.json({
      success: true,
      message: 'Compra simulada con éxito',
      gems_added: gemsToAdd,
      messages_added: messagesToAdd,
      remaining_gems: newGems,
      remaining_bonus_gems: newBonusGems,
    }, { headers: corsHeaders })

  } catch (e: any) {
    console.error('[test-purchase] Error:', e)
    return NextResponse.json({ error: e.message || 'Error interno' }, { status: 500, headers: corsHeaders })
  }
}
