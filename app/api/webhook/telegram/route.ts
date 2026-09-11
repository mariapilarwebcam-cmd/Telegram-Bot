import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { STAR_PACKAGES } from '@/lib/constants'

export async function POST(request: Request) {
  try {
    const update = await request.json()

    // Pre-checkout
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

    // Pago exitoso
    if (update.message?.successful_payment) {
      const payment = update.message.successful_payment
      const userId = String(update.message.from.id)
      const packageId = parseInt(payment.invoice_payload.split('_').slice(-1)[0])

      if (packageId >= STAR_PACKAGES.length) {
        return NextResponse.json({ error: 'Paquete no válido' }, { status: 400 })
      }

      const pkg = STAR_PACKAGES[packageId]
      const gemsToAdd = pkg.bonus > 0
        ? Math.floor(pkg.gems * (1 + pkg.bonus / 100))
        : pkg.gems

      const { data: user } = await supabase
        .from('users')
        .select('gems')
        .eq('telegram_id', userId)
        .maybeSingle()

      if (user) {
        await supabase
          .from('users')
          .update({
            gems: user.gems + gemsToAdd,
            hook_messages_remaining: 0
          })
          .eq('telegram_id', userId)

        await supabase.from('gem_transactions').insert({
          telegram_id: userId,
          amount: gemsToAdd,
          transaction_type: 'purchase',
          description: `Compra con ${pkg.stars} Stars`
        })

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
