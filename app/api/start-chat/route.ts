// app/api/start-chat/route.ts

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ensureUser } from '@/lib/user-helpers'
import { OPENING_LINES, GEM_COSTS } from '@/lib/constants'

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { character_id } = await request.json()

    // ✅ FIX: crea el usuario si no existe
    const user = await ensureUser(tid)
    if (!user) {
      return NextResponse.json(
        { error: 'Error cargando tu cuenta' },
        { status: 500 }
      )
    }

    const { data: character } = await supabaseAdmin
      .from('user_characters')
      .select('*')
      .eq('id', character_id)
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!character) {
      return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })
    }

    // ¿Ya existe historial? => no cobrar de nuevo
    const { count } = await supabaseAdmin
      .from('conversation_history')
      .select('*', { count: 'exact', head: true })
      .eq('telegram_id', tid)
      .eq('character_id', character_id)

    if ((count || 0) > 0) {
      return NextResponse.json({ already_started: true })
    }

    const gems = user.gems || 0
    if (gems < GEM_COSTS.message) {
      return NextResponse.json({
        blocked: true,
        response: '',
        remaining_gems: gems,
      })
    }

    // ✅ RPC ATÓMICA: descuenta 1 gema sin race condition
    const { data: newGems, error: rpcErr } = await supabaseAdmin.rpc(
      'increment_gems',
      {
        p_telegram_id: tid,
        p_amount: -GEM_COSTS.message,
      }
    )

    if (rpcErr) {
      console.error('[start-chat] RPC failed:', rpcErr)
      return NextResponse.json(
        { error: 'Error actualizando gemas' },
        { status: 500 }
      )
    }

    await supabaseAdmin.from('gem_transactions').insert({
      telegram_id: tid,
      amount: -GEM_COSTS.message,
      transaction_type: 'message',
      description: 'Mensaje de apertura',
    })

    const lang = (user.language === 'en' ? 'en' : 'es') as 'es' | 'en'
    const openingTemplate = OPENING_LINES[character.archetype]
    const fallback = lang === 'es'
      ? `*{name} te mira al entrar y sonríe con intención*\n\n"Hola... estaba esperándote. ¿Qué te trae por aquí?"`
      : `*{name} looks at you as you enter and smiles with intent*\n\n"Hey... I was waiting for you. What brings you here?"`
    const template = openingTemplate ? openingTemplate[lang] : fallback
    const openingMessage = template.replace(/{name}/g, character.character_name)

    await supabaseAdmin.from('conversation_history').insert({
      telegram_id: tid,
      character_id,
      role: 'assistant',
      content: openingMessage,
    })

    return NextResponse.json({
      response: openingMessage,
      remaining_gems: typeof newGems === 'number' ? newGems : (gems - GEM_COSTS.message),
    })
  } catch (e: any) {
    console.error('Error en start-chat:', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
