// app/api/characters/route.ts
// GET /api/characters         → lista de personajes del usuario
// GET /api/characters?active=1 → solo el activo

import { NextResponse } from 'next/server'
import { getAllUserCharacters, getActiveCharacter } from '@/lib/db-queries'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const url = new URL(request.url)
    const onlyActive = url.searchParams.get('active') === '1'

    if (onlyActive) {
      const character = await getActiveCharacter(tid)
      return NextResponse.json({ character })
    }

    const characters = await getAllUserCharacters(tid)
    return NextResponse.json({ characters })
  } catch (e: any) {
    console.error('[characters] error:', e)
    return NextResponse.json(
      { error: 'Error interno', detail: e?.message || String(e) },
      { status: 500 }
    )
  }
}