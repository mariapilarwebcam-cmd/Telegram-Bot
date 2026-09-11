import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { CHARACTER_FACES, GEM_COSTS } from '@/lib/constants'
import { generateImage } from '@/lib/ai'

export async function POST(request: Request) {
  try {
    const { telegram_id, character_id, description } = await request.json()

    // 1. Validar gemas
    const { data: user } = await supabase
      .from('users')
      .select('gems')
      .eq('telegram_id', telegram_id)
      .single()

    if (!user || user.gems < GEM_COSTS.image) {
      return NextResponse.json({ error: 'Necesitas 10 gemas para generar una imagen' }, { status: 402 })
    }

    // 2. Obtener personaje
    const { data: character } = await supabase
      .from('user_characters')
      .select('archetype, character_name')
      .eq('id', character_id)
      .single()

    if (!character) {
      return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })
    }

    // 3. Crear prompt de imagen
    const facePrompt = CHARACTER_FACES[character.archetype] || 'beautiful person'
    const imagePrompt = `${facePrompt}, selfie style, ${description}, POV, realistic, smartphone photo, high detail, sensual, flirty, beautiful lighting`

    // 4. Generar imagen
    const imageUrl = await generateImage(imagePrompt)

    // 5. Deducir gemas
    const newGems = user.gems - GEM_COSTS.image
    await supabase.from('users').update({ gems: newGems }).eq('telegram_id', telegram_id)
    
    await supabase.from('gem_transactions').insert({
      telegram_id,
      amount: -GEM_COSTS.image,
      transaction_type: 'image',
      description: `Selfie: ${description.substring(0, 50)}`
    })

    return NextResponse.json({
      image_url: imageUrl,
      remaining_gems: newGems
    })

  } catch (error: any) {
    console.error('Error generando imagen:', error)
    return NextResponse.json({ error: 'Error al generar la imagen' }, { status: 500 })
  }
}