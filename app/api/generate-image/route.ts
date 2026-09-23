// app/api/generate-image/route.ts

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCharacterFace, getCharacterImageUrl } from '@/lib/constants'
import { generateImage } from '@/lib/ai'
import { getLevelFromMessages, getImageCost, getClothingLevel, getSceneStyle } from '@/lib/levels'

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
          : 'La generación de imágenes es Premium. Compra gemas con Stars para desbloquearla.',
      }, { status: 403 })
    }

    const { data: character } = await supabaseAdmin
      .from('user_characters')
      .select('archetype, character_name, gender')
      .eq('id', character_id)
      .eq('telegram_id', tid)
      .maybeSingle()

    if (!character) return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })

    const { count: userMsgCount } = await supabaseAdmin
      .from('conversation_history')
      .select('*', { count: 'exact', head: true })
      .eq('telegram_id', tid)
      .eq('character_id', character_id)
      .eq('role', 'user')

    const level = getLevelFromMessages(userMsgCount || 0)
    const imageCost = getImageCost(level.level)

    if (user.gems < imageCost) {
      return NextResponse.json({
        error: 'insufficient_gems',
        message: user.language === 'en'
          ? `You need ${imageCost} gems`
          : `Necesitas ${imageCost} gemas`,
        required: imageCost,
      }, { status: 402 })
    }

    // Reference image desde Cloudflare R2 (URL pública)
    const referenceUrl = getCharacterImageUrl(character.archetype, character.gender)

    // Prompt escalado con estética anime
    const facePrompt = getCharacterFace(character.archetype, character.gender)
    const clothing = getClothingLevel(level.level)
    const scene = getSceneStyle(level.level)

    const imagePrompt = `${facePrompt}, anime style, cel shading, vibrant colors, detailed anime eyes, ${clothing}, ${scene}, ${description}, POV selfie, smartphone photo, high detail, flirty expression, beautiful cinematic lighting, 2D illustration, best quality`

    let imageUrl: string
    try {
      imageUrl = await generateImage(imagePrompt, referenceUrl || undefined)
    } catch (imgError) {
      console.error('Image generation error:', imgError)
      return NextResponse.json({ error: 'Error al generar la imagen' }, { status: 500 })
    }

    const newGems = user.gems - imageCost
    await supabaseAdmin.from('users').update({ gems: newGems }).eq('telegram_id', tid)
    await supabaseAdmin.from('gem_transactions').insert({
      telegram_id: tid,
      amount: -imageCost,
      transaction_type: 'image',
      description: `Selfie nivel ${level.level}: ${description.substring(0, 50)}`,
    })

    return NextResponse.json({
      image_url: imageUrl,
      remaining_gems: newGems,
      level: level.level,
      cost: imageCost,
    })
  } catch (error: any) {
    console.error('Error generando imagen:', error)
    return NextResponse.json({ error: 'Error al generar la imagen' }, { status: 500 })
  }
}
