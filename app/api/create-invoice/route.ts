import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { STAR_PACKAGES, getFinalGems } from '@/lib/constants'

export async function POST(request: Request) {
  try {
    const { telegram_id, package_id } = await request.json()
    const tid = String(telegram_id)

    if (package_id >= STAR_PACKAGES.length || package_id < 0) {
      return NextResponse.json({ error: 'Paquete no válido' }, { status: 400 })
    }

    const pkg = STAR_PACKAGES[package_id]

    // Validar first_time_only: solo si el usuario nunca ha comprado
    if (pkg.first_time_only) {
      const { data: purchases } = await supabaseAdmin
        .from('star_purchases').select('id').eq('telegram_id', tid).limit(1)
      if (purchases && purchases.length > 0) {
        return NextResponse.json({ error: 'Paquete no disponible' }, { status: 400 })
      }
    }

    const finalGems = getFinalGems(pkg)

    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/createInvoiceLink`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${finalGems} Gems`,
          description: `${finalGems} gems${pkg.bonus > 0 ? ` (+${pkg.bonus}% bonus)` : ''}`,
          payload: `gem_purchase_${package_id}`,
          currency: 'XTR',
          prices: [{ label: 'Gems', amount: pkg.stars }]
        })
      }
    )

    const data = await response.json()

    if (!data.ok) {
      return NextResponse.json({ error: 'Error creando factura' }, { status: 500 })
    }

    return NextResponse.json({ invoice_link: data.result })
  } catch (error: any) {
    console.error('Error creando invoice:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
