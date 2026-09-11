import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { STAR_PACKAGES } from '@/lib/constants'

export async function POST(request: Request) {
  try {
    const update = await request.json()

    // Responder a pre-checkout query
    if (update.pre_checkout_query) {
      await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerPreCheckoutQuery`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pre_checkout_query_id: update.pre_checkout_query.id,
            ok: true
          })
        }
      )
    }

    // Procesar pago exitoso
    if (update.message?.successful_payment) {
      const payment = update.message.successful_payment
      const userId = update.message.from.id
      const packageId = parseInt(payment.invoice_payload.split('_')[2])

      if (packageId >= STAR_PACKAGES.length) {
        return NextResponse.json({ error: 'Paquete no válido' }, { status: 400 })
      }

      const pkg = STAR_PACKAGES[packageId]
      const gemsToAdd = Math.floor(pkg.gems * (1 + pkg.bonus / 100))

      // Obtener gemas actuales
      const { data: user } = await supabase
        .from('users')
        .select('gems')
        .eq('telegram_id', userId)
        .single()

      if (user) {
        // Añadir gemas
        await supabase
          .from('users')
          .update({ gems: user.gems + gemsToAdd })
          .eq('telegram_id', userId)

        // Registrar transacción
        await supabase.from('gem_transactions').insert({
          telegram_id: userId,
          amount: gemsToAdd,
          transaction_type: 'purchase',
          description: `Compra con ${pkg.stars} Stars`
        })

        // Registrar compra de stars
        await supabase.from('star_purchases').insert({
          telegram_id: userId,
          stars_amount: pkg.stars,
          gems_amount: gemsToAdd,
          is_first_purchase: pkg.first_time,
          telegram_charge_id: payment.telegram_payment_charge_id
        })
      }
    }

    return NextResponse.json({ ok: true })

  } catch (error: any) {
    console.error('Error en webhook:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}