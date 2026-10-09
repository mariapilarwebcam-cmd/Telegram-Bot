// app/api/select-character/route.ts

import { NextResponse } from 'next/server'
import {
  findCharacterByArchetype,
  deactivateAllCharacters,
  activateCharacter,
  insertCharacter,
} from '@/lib/db-queries'
import { PERSONALITIES } from '@/lib/constants'

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { archetype, gender, character_name } = body

    console.log('[select-character] request:', {
      telegram_id: tid,
      archetype,
      gender,
      character_name,
    })

    if (!archetype || !gender) {
      return NextResponse.json(
        { error: 'archetype y gender requeridos' },
        { status: 400 }
      )
    }
    if (gender !== 'male' && gender !== 'female') {
      return NextResponse.json({ error: 'gender inválido' }, { status: 400 })
    }

    // Buscar personaje existente
    const existing = await findCharacterByArchetype(tid, archetype, gender)

    // Desactivar todos los personajes del usuario
    await deactivateAllCharacters(tid)

    if (existing) {
      // Reactivar el existente
      await activateCharacter(existing.id, tid)

      console.log('[select-character] reactivated:', existing.id)
      return NextResponse.json({ character_id: existing.id, created: false })
    }

    // Crear nuevo
    const created = await insertCharacter({
      telegram_id: tid,
      character_name: character_name || 'Character',
      gender,
      archetype,
      personality: PERSONALITIES[archetype] || '',
    })

    console.log('[select-character] created:', created.id)
    return NextResponse.json({ character_id: created.id, created: true })
  } catch (e: any) {
    console.error('[select-character] FATAL:', e)
    return NextResponse.json(
      { error: 'Error interno', detail: e?.message || String(e) },
      { status: 500 }
    )
  }
}
