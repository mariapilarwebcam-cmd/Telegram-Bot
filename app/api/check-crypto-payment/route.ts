// app/api/check-crypto-payment/route.ts

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { CRYPTO_PACKAGES, getFinalCryptoGems } from '@/lib/constants'

const TONAPI_KEY = process.env.TONAPI_KEY || '' // opcional pero recomendado
const RECIPIENT_WALLET =
  process.env.TON_RECIPIENT_WALLET || 'UQCt76T3JPW3WrpsfIz6Tc1eVrvkrQpwV0-3sk1so4P8Vd4-'

const USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'

export async function POST(request: Request) {
  try {
    const { reference } = await request.json()
    if (!reference || typeof reference !== 'string') {
      return NextResponse.json({ error: 'Reference requerido' }, { status: 400 })
    }

    // 1. Parsear reference
    const parts = reference.split('_')
    if (parts.length < 4 || parts[0] !== 'TABOO') {
      return NextResponse.json({ error: 'Reference inválido' }, { status: 400 })
    }

    const telegramId = parts[1]
    const packageIndex = parseInt(parts[2])

    if (
      isNaN(packageIndex) ||
      packageIndex >= CRYPTO_PACKAGES.length ||
      packageIndex < 0
    ) {
      return NextResponse.json({ error: 'Package index inválido' }, { status: 400 })
    }

    // 2. Verificar si ya se procesó (idempotencia por reference)
    const { data: existing } = await supabaseAdmin
      .from('star_purchases')
      .select('id')
      .eq('telegram_id', telegramId)
      .eq('telegram_charge_id', reference)
      .maybeSingle()

    if (existing) {
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('gems')
        .eq('telegram_id', telegramId)
        .maybeSingle()
      return NextResponse.json({
        status: 'paid',
        already: true,
        remaining_gems: user?.gems || 0,
      })
    }

    // 3. Consultar TonAPI para transacciones recientes en nuestra wallet
    const url = `https://tonapi.io/v2/accounts/${RECIPIENT_WALLET}/events?limit=20`
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (TONAPI_KEY) headers['Authorization'] = `Bearer ${TONAPI_KEY}`

    const res = await fetch(url, { headers, cache: 'no-store' })

    if (!res.ok) {
      console.warn('[check-crypto-payment] TonAPI error:', res.status)
      return NextResponse.json({ status: 'pending', reason: 'tonapi_error' })
    }

    const data = await res.json()
    const events = data.events || []

    // 4. Buscar la transacción con nuestro comment === reference
    let matchedEvent: any = null
    let matchedAction: any = null

    for (const ev of events) {
      for (const action of ev.actions || []) {
        if (action.type !== 'JettonTransfer') continue
        const jt = action.JettonTransfer
        if (!jt) continue

        // Verificar comment
        if (jt.comment === reference) {
          // Verificar que sea USDT
          if (jt.jetton?.address === USDT_MASTER) {
            matchedEvent = ev
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

    // 5. Verificar monto
    const pkg = CRYPTO_PACKAGES[packageIndex]
    const expectedUnits = Math.round(pkg.usdt * 1_000_000) // USDT 6 decimals
    const receivedUnits = parseInt(matchedAction.amount || '0')

    if (receivedUnits < expectedUnits - 1000) {
      console.warn('[check-crypto-payment] Monto insuficiente:', {
        expected: expectedUnits,
        received: receivedUnits,
      })
      return NextResponse.json({ status: 'pending', reason: 'amount_mismatch' })
    }

    // 6. Acreditar gemas
    const gemsToAdd = getFinalCryptoGems(pkg)
    const txHash = matchedEvent.event_id || `tx_${Date.now()}`

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('gems')
      .eq('telegram_id', telegramId)
      .maybeSingle()

    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    const newGems = (user.gems || 0) + gemsToAdd

    await supabaseAdmin
      .from('users')
      .update({ gems: newGems, hook_messages_remaining: 0 })
      .eq('telegram_id', telegramId)

    await supabaseAdmin.from('gem_transactions').insert({
      telegram_id: telegramId,
      amount: gemsToAdd,
      transaction_type: 'crypto_purchase',
      description: `Compra crypto ${pkg.usdt} USDT (${reference})`,
    })

    await supabaseAdmin.from('star_purchases').insert({
      telegram_id: telegramId,
      stars_amount: 0,
      gems_amount: gemsToAdd,
      is_first_purchase: pkg.first_time_only || false,
      telegram_charge_id: reference,
      payment_method: 'crypto',
    })

    console.log('[check-crypto-payment] ✅ Gemas acreditadas:', {
      telegramId,
      gemsToAdd,
      newGems,
      txHash,
    })

    return NextResponse.json({
      status: 'paid',
      gems_added: gemsToAdd,
      remaining_gems: newGems,
    })
  } catch (e: any) {
    console.error('[check-crypto-payment] Error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}