// app/api/select-character/route.ts

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { PERSONALITIES } from '@/lib/constants'

export async function POST(request: Request) {
  try {
    // ✅ AUTH: telegram_id validado por el middleware
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // Body sin telegram_id (ya no es fuente de verdad)
    const { archetype, gender, character_name } = await request.json()

    console.log('[select-character] request:', { telegram_id: tid, archetype, gender, character_name })

    if (!archetype || !gender) {
      return NextResponse.json({ error: 'archetype y gender requeridos' }, { status: 400 })
    }
    if (gender !== 'male' && gender !== 'female') {
      return NextResponse.json({ error: 'gender inválido' }, { status: 400 })
    }

    // Buscar personaje existente
    const { data: existing, error: findErr } = await supabaseAdmin
      .from('user_characters')
      .select('id')
      .eq('telegram_id', tid)
      .eq('archetype', archetype)
      .eq('gender', gender)
      .maybeSingle()

    if (findErr) {
      console.error('[select-character] find error:', findErr)
    }

    // Desactivar todos los personajes del usuario
    const { error: deactivateErr } = await supabaseAdmin
      .from('user_characters')
      .update({ is_active: false })
      .eq('telegram_id', tid)

    if (deactivateErr) {
      console.error('[select-character] deactivate error:', deactivateErr)
      // No bloqueamos aquí, puede no haber personajes previos
    }

    if (existing) {
      // Reactivar el existente
      await supabaseAdmin
        .from('user_characters')
        .update({ is_active: true })
        .eq('id', existing.id)
        .eq('telegram_id', tid)

      console.log('[select-character] reactivated:', existing.id)
      return NextResponse.json({ character_id: existing.id, created: false })
    }

    // Crear nuevo
    const insertPayload = {
      telegram_id: tid,
      character_name: character_name || 'Character',
      gender,
      archetype,
      personality: PERSONALITIES[archetype] || '',
      is_active: true,
    }

    console.log('[select-character] insert payload:', insertPayload)

    const { data: created, error } = await supabaseAdmin
      .from('user_characters')
      .insert(insertPayload)
      .select('id')
      .single()

    if (error) {
      console.error('[select-character] INSERT FAILED:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      })
      return NextResponse.json({
        error: 'Error creando personaje',
        detail: error.message,
        code: error.code,
      }, { status: 500 })
    }

    console.log('[select-character] created:', created.id)
    return NextResponse.json({ character_id: created.id, created: true })
  } catch (e: any) {
    console.error('[select-character] FATAL:', e)
    return NextResponse.json({
      error: 'Error interno',
      detail: e?.message || String(e),
    }, { status: 500 })
  }
}
