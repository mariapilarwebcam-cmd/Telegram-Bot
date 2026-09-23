// app/api/select-character/route.ts

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { PERSONALITIES } from '@/lib/constants'

export async function POST(request: Request) {
  try {
    const { telegram_id, archetype, gender, character_name } = await request.json()
    const tid = String(telegram_id)

    if (!tid) return NextResponse.json({ error: 'telegram_id requerido' }, { status: 400 })
    if (!archetype || !gender) return NextResponse.json({ error: 'archetype y gender requeridos' }, { status: 400 })
    if (gender !== 'male' && gender !== 'female') {
      return NextResponse.json({ error: 'gender inválido' }, { status: 400 })
    }

    // Buscar personaje existente
    const { data: existing } = await supabaseAdmin
      .from('user_characters')
      .select('id')
      .eq('telegram_id', tid)
      .eq('archetype', archetype)
      .eq('gender', gender)
      .maybeSingle()

    // Desactivar todos los personajes del usuario
    await supabaseAdmin
      .from('user_characters')
      .update({ is_active: false })
      .eq('telegram_id', tid)

    if (existing) {
      // Reactivar el existente
      await supabaseAdmin
        .from('user_characters')
        .update({ is_active: true })
        .eq('id', existing.id)
        .eq('telegram_id', tid)

      return NextResponse.json({ character_id: existing.id, created: false })
    }

    // Crear nuevo
    const { data: created, error } = await supabaseAdmin
      .from('user_characters')
      .insert({
        telegram_id: tid,
        character_name: character_name || 'Character',
        gender,
        archetype,
        personality: PERSONALITIES[archetype] || '',
        is_active: true,
      })
      .select('id')
      .single()

    if (error) {
      console.error('Error creando personaje:', error)
      return NextResponse.json({ error: 'Error creando personaje' }, { status: 500 })
    }

    return NextResponse.json({ character_id: created.id, created: true })
  } catch (e: any) {
    console.error('Error en select-character:', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}