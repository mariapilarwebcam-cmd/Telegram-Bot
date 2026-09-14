import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { CHARACTER_FACES, GEM_COSTS } from '@/lib/constants'
import { generateImage } from '@/lib/ai'

export async function POST(request: Request) {
  try {
    const { telegram_id, character_id, description } = await request.json()
    const tid = String(telegram_id)

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('gems, language')
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!user) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })

    // ✅ PREMIUM GATE
    const { data: purchases } = await supabaseAdmin
      .from('star_purchases')
      .select('id')
      .eq('telegram_id', tid)
      .limit(1)

    if (!purchases || purchases.length === 0) {
      return NextResponse.json({
        error: 'premium_required',
        message: user.language === 'en'
          ? 'Image generation is a Premium feature. Buy gems with Stars to unlock it.'
          : 'La generación de imágenes es Premium. Compra gemas con Stars para desbloquearla.'
      }, { status: 403 })
    }

    if (user.gems < GEM_COSTS.image) {
      return NextResponse.json({ error: 'Necesitas 10 gemas' }, { status: 402 })
    }

    const { data: character } = await supabaseAdmin
      .from('user_characters')
      .select('archetype, character_name')
      .eq('id', character_id)
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!character) return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })

    const facePrompt = CHARACTER_FACES[character.archetype] || 'beautiful person'
    const imagePrompt = `${facePrompt}, selfie style, ${description}, POV, realistic, smartphone photo, high detail, sensual, flirty, beautiful lighting`

    const imageUrl = await generateImage(imagePrompt)

    const newGems = user.gems - GEM_COSTS.image
    await supabaseAdmin.from('users').update({ gems: newGems }).eq('telegram_id', tid)
    await supabaseAdmin.from('gem_transactions').insert({
      telegram_id: tid,
      amount: -GEM_COSTS.image,
      transaction_type: 'image',
      description: `Selfie: ${description.substring(0, 50)}`
    })

    return NextResponse.json({ image_url: imageUrl, remaining_gems: newGems })
  } catch (error: any) {
    console.error('Error generando imagen:', error)
    return NextResponse.json({ error: 'Error al generar la imagen' }, { status: 500 })
  }
}
