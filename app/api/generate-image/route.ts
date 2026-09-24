// app/api/generate-image/route.ts

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCharacterFace, getCharacterImageUrl } from '@/lib/constants'
import { generateImage } from '@/lib/ai'
import { getLevelFromMessages, getImageCost, getClothingLevel, getSceneStyle } from '@/lib/levels'

// ============================================================
// CHARACTER DNA — Anclas visuales del personaje para niveles 1-3
// Se inyecta en el prompt cuando NO se usa reference image.
// ============================================================
const CHARACTER_DNA: Record<string, string> = {
  female_stepmom: "mature woman, long dark hair, green eyes, elegant",
  female_tsundere: "young woman, long dark navy hair, red ribbon, amber eyes",
  female_yandere: "young woman, long black hair with pink highlights, pink eyes",
  female_stepsister: "young woman, blonde bob cut, blue eyes, nose ring",
  female_boss: "mature woman, black bob haircut, dark eyes, business suit",
  female_teacher: "woman, updo hair, glasses, blue eyes, professional blouse",
  female_model_student: "young woman, long blonde waves, brown eyes, trendy outfit",
  female_model: "young woman, long brown hair, flawless skin, glamorous",
  female_secretary: "woman, ponytail hair, glasses, brown eyes, pencil skirt",
  female_trainer: "young woman, high ponytail, tanned skin, athletic, sports bra",
  female_schoolmate: "young woman, messy brown hair, hazel eyes, casual hoodie",
  female_neighbor: "woman, wavy hair, green eyes, casual summer clothes",
  female_doctor: "woman, neat bun, brown eyes, white coat, stethoscope",
  female_actor: "woman, hollywood waves, red lips, elegant dress",
  female_musician: "young woman, dark curls, smudged eyeliner, leather jacket",
  female_chef: "woman, messy hair tied back, warm smile, apron",
  male_stepdad: "mature man, salt and pepper hair, broad shoulders, dress shirt",
  male_ceo: "man, sharp haircut, steel-blue eyes, tailored suit, expensive watch",
  male_stepbrother: "young man, buzz cut, strong jawline, muscular, tank top",
  male_boss: "man, slicked back hair, intense eyes, three-piece suit",
  male_bodyguard: "large man, shaved head, scar on eyebrow, muscular, black suit",
  male_childhood_friend: "young man, casual dark hair, brown eyes, grey hoodie",
  male_teacher: "man, neat dark hair, glasses, professional shirt",
  male_doctor: "man, short dark hair, blue eyes, white lab coat",
  male_trainer: "man, spiky hair, muscular build, grey tank top, sweat",
  male_musician: "man, messy dark hair, earring, band t-shirt, guitar",
  male_chef: "man, dark hair tied back, stubble, apron, rolled sleeves",
  male_actor: "man, styled brown hair, sharp features, dark shirt",
  male_artist: "man, messy hair, paint smudge, casual shirt",
  male_writer: "man, messy hair, reading glasses, cozy sweater",
  male_schoolmate: "young man, casual messy hair, playful grin, school hoodie",
  male_neighbor: "man, relaxed hair, brown eyes, casual summer shirt",
}

// ── Prompts SFW para niveles 1-3 (sin contenido NSFW) ──
const SFW_SCENE_PROMPTS: Record<number, string> = {
  1: "selfie style, casual daytime environment, fully dressed, cute anime style, safe for work, soft natural lighting, wholesome, friendly",
  2: "bedroom setting, warm cozy lighting, fully dressed with suggestive pose, subtle cleavage, flirty expression, safe for work, anime aesthetic",
  3: "bedroom or living room, dim moody lighting, provocative outfit but fully covered, lingerie visible subtly, seductive pose, anime aesthetic",
}

// ── Prompts NSFW para niveles 4-5 (solo con Wiro) ──
const NSFW_SCENE_PROMPTS: Record<number, string> = {
  4: "minimal clothing, lingerie or swimwear, very revealing, explicit suggestive pose, low intimate lighting, bedroom setting, anime aesthetic",
  5: "extremely revealing or tasteful implied nudity, artistic, highly explicit artistic composition, dramatic cinematic lighting, intimate, anime aesthetic",
}

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

    // ── Construir prompt según nivel ──
    let imagePrompt: string
    let referenceUrl: string | undefined

    if (level.level <= 3) {
      // ── Niveles 1-3: DeepInfra FLUX (sin reference image, sin NSFW) ──
      const dna = CHARACTER_DNA[`${character.gender}_${character.archetype}`] || 'anime character'
      const scene = SFW_SCENE_PROMPTS[level.level] || SFW_SCENE_PROMPTS[1]

      imagePrompt = `[CHARACTER DNA: ${dna}], anime style, cel shading, vibrant colors, detailed anime eyes, ${scene}, ${description}, selfie style, smartphone photo, high detail, beautiful cinematic lighting, 2D illustration, best quality, safe for work, no nudity, no explicit content`

      referenceUrl = undefined // DeepInfra no usa reference
    } else {
      // ── Niveles 4-5: Wiro Seedream (con reference image, NSFW permitido) ──
      const facePrompt = getCharacterFace(character.archetype, character.gender)
      const clothing = getClothingLevel(level.level)
      const scene = NSFW_SCENE_PROMPTS[level.level] || NSFW_SCENE_PROMPTS[4]

      imagePrompt = `${facePrompt}, anime style, cel shading, vibrant colors, detailed anime eyes, ${clothing}, ${scene}, ${description}, POV selfie, smartphone photo, high detail, flirty expression, beautiful cinematic lighting, 2D illustration, best quality`

      referenceUrl = getCharacterImageUrl(character.archetype, character.gender)
    }

    let imageUrl: string
    try {
      imageUrl = await generateImage(imagePrompt, referenceUrl, level.level)
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
      model: level.level <= 3 ? 'deepinfra' : 'wiro',
    })
  } catch (error: any) {
    console.error('Error generando imagen:', error)
    return NextResponse.json({ error: 'Error al generar la imagen' }, { status: 500 })
  }
}
