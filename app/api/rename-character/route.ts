// app/api/rename-character/route.ts

import { NextResponse } from 'next/server'
import {
  ensureUser,
  getCharacter,
  incrementGems,
  insertGemTransaction,
  renameCharacter,
} from '@/lib/db-queries'
import { GEM_COSTS } from '@/lib/constants'

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const cid = Number(body.character_id)
    const name = String(body.new_name || '').trim()

    if (!cid) {
      return NextResponse.json({ error: 'character_id requerido' }, { status: 400 })
    }
    if (!name) {
      return NextResponse.json({ error: 'Nombre vacío' }, { status: 400 })
    }
    if (name.length > 30) {
      return NextResponse.json(
        { error: 'Nombre demasiado largo (máx 30)' },
        { status: 400 }
      )
    }

    const user = await ensureUser(tid)
    if (!user) {
      return NextResponse.json(
        { error: 'Error cargando tu cuenta' },
        { status: 500 }
      )
    }

    const lang = (user.language || 'es') as 'es' | 'en'

    const character = await getCharacter(cid, tid)
    if (!character) {
      return NextResponse.json(
        { error: 'Personaje no encontrado' },
        { status: 404 }
      )
    }

    if (character.character_name === name) {
      return NextResponse.json({
        ok: true,
        character_name: name,
        remaining_gems: user.gems,
        unchanged: true,
      })
    }

    if ((user.gems || 0) < GEM_COSTS.rename_character) {
      return NextResponse.json(
        {
          error: 'insufficient_gems',
          message:
            lang === 'es'
              ? `Necesitas ${GEM_COSTS.rename_character} gemas`
              : `You need ${GEM_COSTS.rename_character} gems`,
          required: GEM_COSTS.rename_character,
        },
        { status: 402 }
      )
    }

    // RPC atómica: descuenta gemas
    const newGems = await incrementGems(tid, -GEM_COSTS.rename_character)

    await insertGemTransaction({
      telegram_id: tid,
      amount: -GEM_COSTS.rename_character,
      transaction_type: 'rename_character',
      description: `Renombrar personaje a "${name}"`,
    })

    await renameCharacter(cid, tid, name)

    return NextResponse.json({
      ok: true,
      character_name: name,
      remaining_gems:
        typeof newGems === 'number'
          ? newGems
          : (user.gems || 0) - GEM_COSTS.rename_character,
    })
  } catch (e: any) {
    console.error('Error en rename-character:', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
