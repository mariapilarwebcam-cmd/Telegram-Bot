// app/api/select-character/route.ts

import { NextResponse } from 'next/server'
import {
  findCharacterByArchetype,
  deactivateAllCharacters,
  activateCharacter,
  insertCharacter,
  getActiveSubscription,          // ✅ VIP
} from '@/lib/db-queries'
import { queryOne } from '@/lib/turso'
import { PERSONALITIES, isVipArchetype, GACHA_ARCHETYPES } from '@/lib/constants'

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

    // ✅ VIP: validar acceso a personajes exclusivos
    if (isVipArchetype(archetype)) {
      const sub = await getActiveSubscription(tid)
      if (!sub) {
        return NextResponse.json(
          {
            error: 'vip_required',
            message: 'Este personaje es exclusivo para usuarios VIP',
          },
          { status: 403 }
        )
      }
    }

    // ✅ FIX DE SEGURIDAD: Validar personajes de la ruleta
    if (GACHA_ARCHETYPES.includes(archetype)) {
      // Verificamos si lo tiene en el inventario (tiradas viejas) o en user_characters (nuevas tiradas)
      const owned = await queryOne<{ id: number }>(
        `SELECT id FROM user_inventory WHERE user_id = ? AND item_type = 'gacha_character' AND item_key = ? LIMIT 1`,
        [tid, archetype]
      )
      const existingChar = await findCharacterByArchetype(tid, archetype, gender)
      
      if (!owned && !existingChar) {
        return NextResponse.json(
          { error: 'gacha_required', message: 'Este personaje solo se consigue en la ruleta' },
          { status: 403 }
        )
      }
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
