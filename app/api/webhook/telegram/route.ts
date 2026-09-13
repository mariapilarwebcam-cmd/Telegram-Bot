import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { STAR_PACKAGES, getFinalGems } from '@/lib/constants'

export async function POST(request: Request) {
  try {
    const update = await request.json()

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

    if (update.message?.successful_payment) {
      const payment = update.message.successful_payment
      const userId = String(update.message.from.id)
      const packageId = parseInt(payment.invoice_payload.split('_').slice(-1)[0])

      if (packageId >= STAR_PACKAGES.length || packageId < 0) {
        return NextResponse.json({ error: 'Paquete no válido' }, { status: 400 })
      }

      const pkg = STAR_PACKAGES[packageId]
      const gemsToAdd = getFinalGems(pkg)

      const { data: user } = await supabaseAdmin
        .from('users').select('gems').eq('telegram_id', userId).maybeSingle()

      if (user) {
        await supabaseAdmin
          .from('users')
          .update({
            gems: (user.gems || 0) + gemsToAdd,
            hook_messages_remaining: 0
          })
          .eq('telegram_id', userId)

        await supabaseAdmin.from('gem_transactions').insert({
          telegram_id: userId,
          amount: gemsToAdd,
          transaction_type: 'purchase',
          description: `Compra con ${pkg.stars} Stars`
        })

        await supabaseAdmin.from('star_purchases').insert({
          telegram_id: userId,
          stars_amount: pkg.stars,
          gems_amount: gemsToAdd,
          is_first_purchase: pkg.first_time_only || false,
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
