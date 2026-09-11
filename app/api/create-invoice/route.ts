import { NextResponse } from 'next/server'
import { STAR_PACKAGES } from '@/lib/constants'

export async function POST(request: Request) {
  try {
    const { telegram_id, package_id } = await request.json()

    if (package_id >= STAR_PACKAGES.length) {
      return NextResponse.json({ error: 'Paquete no válido' }, { status: 400 })
    }

    const pkg = STAR_PACKAGES[package_id]
    const finalGems = pkg.bonus > 0
      ? Math.floor(pkg.gems * (1 + pkg.bonus / 100))
      : pkg.gems

    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/createInvoiceLink`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${finalGems} Gemas`,
          description: `Paquete de ${finalGems} gemas${pkg.bonus > 0 ? ` (+${pkg.bonus}% bonus)` : ''}`,
          payload: `gem_purchase_${package_id}`,
          currency: 'XTR',
          prices: [{ label: 'Gemas', amount: pkg.stars }]
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
