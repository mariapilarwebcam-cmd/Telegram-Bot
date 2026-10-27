// app/api/create-invoice/route.ts

import { NextResponse } from 'next/server'
import { getLastPurchase } from '@/lib/db-queries'
import { STAR_PACKAGES, MESSAGE_PACKAGES, HYBRID_PACKAGES, getFinalGems } from '@/lib/constants'

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { package_id, package_type } = body

    // ✅ NUEVO: Determinamos qué paquete usar (Híbrido, Mensajes o Gemas)
    const isMessages = package_type === 'messages'
    const isHybrid = package_type === 'hybrid'
    const activePackages = isHybrid ? HYBRID_PACKAGES : (isMessages ? MESSAGE_PACKAGES : STAR_PACKAGES)

    if (
      typeof package_id !== 'number' ||
      package_id >= activePackages.length ||
      package_id < 0
    ) {
      return NextResponse.json({ error: 'Paquete no válido' }, { status: 400 })
    }

    const pkg = activePackages[package_id]

    // Validar first_time_only: solo si el usuario nunca ha comprado
    if (pkg.first_time_only) {
      const purchase = await getLastPurchase(tid)
      if (purchase) {
        return NextResponse.json(
          { error: 'Paquete no disponible' },
          { status: 400 }
        )
      }
    }

    // ✅ NUEVO: Formatear título, descripción y payload según el tipo
    let title = ''
    let description = ''
    let payload = ''
    let label = 'Gems'

    if (isHybrid) {
      title = `${(pkg as any).stars_final_gems} Gems + ${(pkg as any).stars_final_messages} Messages`
      description = `${(pkg as any).stars_final_gems} gems and ${(pkg as any).stars_final_messages} messages for chatting`
      payload = `hybrid_purchase_${package_id}`
      label = 'Hybrid Pack'
    } else if (isMessages) {
      const finalAmount = (pkg as any).messages
      title = `${finalAmount} Messages`
      description = `${finalAmount} messages for chatting`
      payload = `message_purchase_${package_id}`
      label = 'Messages'
    } else {
      const finalAmount = getFinalGems(pkg as any)
      title = `${finalAmount} Gems`
      description = `${finalAmount} gems${(pkg as any).bonus > 0 ? ` (+${(pkg as any).bonus}% bonus)` : ''}`
      payload = `gem_purchase_${package_id}`
      label = 'Gems'
    }

    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/createInvoiceLink`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          payload,
          currency: 'XTR',
          prices: [{ label, amount: pkg.stars }],
        }),
      }
    )

    const data = await response.json()

    if (!data.ok) {
      console.error('[create-invoice] Telegram error:', data)
      return NextResponse.json(
        { error: 'Error creando factura' },
        { status: 500 }
      )
    }

    return NextResponse.json({ invoice_link: data.result })
  } catch (error: any) {
    console.error('Error creando invoice:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
