import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { CHARACTER_FACES, GEM_COSTS } from '@/lib/constants'
import { generateImage } from '@/lib/ai'

export async function POST(request: Request) {
  try {
    const { telegram_id, character_id, description } = await request.json()
    const tid = String(telegram_id)

    const { data: user } = await supabase
      .from('users')
      .select('gems, language')
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!user) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })

    // Gating premium
    const { data: purchases } = await supabase
      .from('star_purchases')
      .select('id')
      .eq('telegram_id', tid)
      .limit(1)

    if (!purchases || purchases.length === 0) {
      return NextResponse.json({
        error: 'premium_required',
        message: user.language === 'en'
          ? 'Image generation is a Premium feature. Buy Stars in the Shop to unlock it.'
          : 'La generación de imágenes es Premium. Compra Stars en la Tienda para desbloquearla.'
      }, { status: 403 })
    }

    if (user.gems < GEM_COSTS.image) {
      return NextResponse.json({ error: 'Necesitas 10 gemas' }, { status: 402 })
    }

    const { data: character } = await supabase
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
    await supabase.from('users').update({ gems: newGems }).eq('telegram_id', tid)
    await supabase.from('gem_transactions').insert({
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
