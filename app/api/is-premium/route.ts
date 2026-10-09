// app/api/is-premium/route.ts
// Devuelve si el usuario ha comprado alguna vez (usado por shop).

import { NextResponse } from 'next/server'
import { getLastPurchase } from '@/lib/db-queries'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const purchase = await getLastPurchase(tid)
    return NextResponse.json({ has_purchased: !!purchase })
  } catch (e: any) {
    console.error('[is-premium] error:', e)
    return NextResponse.json(
      { error: 'Error interno', detail: e?.message || String(e) },
      { status: 500 }
    )
  }
}