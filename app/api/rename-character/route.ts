// app/api/rename-character/route.ts

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { GEM_COSTS } from '@/lib/constants'

export async function POST(request: Request) {
  try {
    const { telegram_id, character_id, new_name } = await request.json()
    const tid = String(telegram_id)
    const cid = Number(character_id)
    const name = String(new_name || '').trim()

    // Validaciones básicas
    if (!tid) return NextResponse.json({ error: 'telegram_id requerido' }, { status: 400 })
    if (!cid) return NextResponse.json({ error: 'character_id requerido' }, { status: 400 })
    if (!name) return NextResponse.json({ error: 'Nombre vacío' }, { status: 400 })
    if (name.length > 30) return NextResponse.json({ error: 'Nombre demasiado largo (máx 30)' }, { status: 400 })

    // Verificar usuario
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('gems, language')
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!user) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })

    const lang = (user.language || 'es') as 'es' | 'en'

    // Verificar personaje (debe pertenecer al usuario)
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

    // Verificar gemas
    if ((user.gems || 0) < GEM_COSTS.rename_character) {
      return NextResponse.json({
        error: 'insufficient_gems',
        message: lang === 'es'
          ? `Necesitas ${GEM_COSTS.rename_character} gemas`
          : `You need ${GEM_COSTS.rename_character} gems`,
        required: GEM_COSTS.rename_character,
      }, { status: 402 })
    }

    const newGems = (user.gems || 0) - GEM_COSTS.rename_character

    // Actualizar user
    await supabaseAdmin
      .from('users')
      .update({ gems: newGems })
      .eq('telegram_id', tid)

    // Registrar transacción
    await supabaseAdmin.from('gem_transactions').insert({
      telegram_id: tid,
      amount: -GEM_COSTS.rename_character,
      transaction_type: 'rename_character',
      description: `Renombrar personaje a "${name}"`,
    })

    // Actualizar nombre del personaje
    await supabaseAdmin
      .from('user_characters')
      .update({ character_name: name })
      .eq('id', cid)
      .eq('telegram_id', tid)

    return NextResponse.json({
      ok: true,
      character_name: name,
      remaining_gems: newGems,
    })
  } catch (e: any) {
    console.error('Error en rename-character:', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}