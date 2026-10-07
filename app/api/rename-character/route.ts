// app/api/rename-character/route.ts

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ensureUser } from '@/lib/user-helpers'
import { GEM_COSTS } from '@/lib/constants'

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { character_id, new_name } = await request.json()
    const cid = Number(character_id)
    const name = String(new_name || '').trim()

    if (!cid) return NextResponse.json({ error: 'character_id requerido' }, { status: 400 })
    if (!name) return NextResponse.json({ error: 'Nombre vacío' }, { status: 400 })
    if (name.length > 30) return NextResponse.json({ error: 'Nombre demasiado largo (máx 30)' }, { status: 400 })

    // ✅ FIX: crea el usuario si no existe
    const user = await ensureUser(tid)
    if (!user) {
      return NextResponse.json(
        { error: 'Error cargando tu cuenta' },
        { status: 500 }
      )
    }

    const lang = (user.language || 'es') as 'es' | 'en'

    const { data: character } = await supabaseAdmin
      .from('user_characters')
      .select('id, character_name')
      .eq('id', cid)
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!character) return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })

    if (character.character_name === name) {
      return NextResponse.json({
        ok: true,
        character_name: name,
        remaining_gems: user.gems,
        unchanged: true,
      })
    }

    if ((user.gems || 0) < GEM_COSTS.rename_character) {
      return NextResponse.json({
        error: 'insufficient_gems',
        message: lang === 'es'
          ? `Necesitas ${GEM_COSTS.rename_character} gemas`
          : `You need ${GEM_COSTS.rename_character} gems`,
        required: GEM_COSTS.rename_character,
      }, { status: 402 })
    }

    // ✅ RPC ATÓMICA: descuenta gemas
    const { data: newGems, error: rpcErr } = await supabaseAdmin.rpc(
      'increment_gems',
      {
        p_telegram_id: tid,
        p_amount: -GEM_COSTS.rename_character,
      }
    )

    if (rpcErr) {
      console.error('[rename-character] RPC failed:', rpcErr)
      return NextResponse.json(
        { error: 'Error actualizando gemas' },
        { status: 500 }
      )
    }

    await supabaseAdmin.from('gem_transactions').insert({
      telegram_id: tid,
      amount: -GEM_COSTS.rename_character,
      transaction_type: 'rename_character',
      description: `Renombrar personaje a "${name}"`,
    })

    await supabaseAdmin
      .from('user_characters')
      .update({ character_name: name })
      .eq('id', cid)
      .eq('telegram_id', tid)

    return NextResponse.json({
      ok: true,
      character_name: name,
      remaining_gems: typeof newGems === 'number' ? newGems : (user.gems || 0) - GEM_COSTS.rename_character,
    })
  } catch (e: any) {
    console.error('Error en rename-character:', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
