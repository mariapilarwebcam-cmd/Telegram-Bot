// app/api/generate-image/route.ts

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCharacterFace, getCharacterImageUrl } from '@/lib/constants'
import { generateImage } from '@/lib/ai'
import {
  getLevelFromMessages,
  getImageCost,
  getClothingLevel,
  getFaceVisibility,
  type FaceVisibility,
} from '@/lib/levels'

// ============================================================
// CHARACTER DNA — Anclas visuales para niveles 1-3 (sin referencia)
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
  female_hairdresser: "black woman, natural curly hair styled up, warm brown eyes, stylish salon outfit, confident smile",
  female_nurse: "black woman, neat braids, kind brown eyes, nurse scrubs, caring expression",
  female_singer: "black woman, glamorous long hair, bold makeup, sequined stage outfit, seductive smile",
  female_yoga_instructor: "black woman, athletic slim body, natural hair in top knot, sports bra, calm pose",
  female_surfer_f: "latina woman, sun-kissed skin, wavy beach hair, athletic body, bikini top, playful smile",
  female_maid: "young woman, short light blue bob hair, soft blue eyes, classic black and white maid outfit with frilled apron, white headdress, devoted gentle expression",
  female_goth_dom: "elegant gothic dominatrix, long black hair with violet streaks, sharp crimson red eyes with cat-eye makeup, dark red lips, pale porcelain skin, black leather corset dress with silver buckles, silver spike choker, long black opera gloves, dark lacy thigh-high stockings",
  female_vampire_lady: "elegant vampire woman, long silver-white hair, glowing crimson red eyes, pale porcelain skin, dark gothic Victorian dress with high collar, ruby choker, small bat wings",
  female_succubus: "seductive succubus woman, long wavy dark purple hair, glowing pink eyes, small curved black demon horns, large leathery bat wings, pointed devil tail",
  female_werewolf_f: "alpha female werewolf, wild ash-blonde hair with silver streaks, glowing amber wolf eyes, subtle white wolf ears, tribal leather outfit with fur mantle",
  female_fallen_angel: "fallen angel woman, long platinum blonde hair, sorrowful blue eyes, broken halo glowing faintly, large torn white feathered wings with black tips, elegant white robe",
  female_kitsune: "magical kitsune fox spirit woman, long silver-white hair with pink tips, glowing golden amber slit eyes, white fox ears, three fluffy white fox tails, traditional white and crimson short kimono, glowing blue spirit flames",
  female_elf: "elegant high elf archer, long flowing golden blonde hair with subtle braids, bright emerald green eyes, pointed elf ears, flawless pale skin, emerald green and silver woodland outfit with leaf embroidery, silver arm guard, ornate silver circlet with gem, silver longbow",
  female_witch: "mysterious witch sorceress, long wavy midnight-black hair with deep purple streaks, sharp violet eyes, fitted dark purple and black lace corset dress, black choker with glowing crystal, subtle pointed black witch hat tilted back, large black raven on shoulder, glowing purple potion vial, ornate silver rings",
  female_nun_fantasy: "devoted fantasy nun, long dark brown hair mostly hidden under a white coif, gentle conflicted blue eyes, soft rosy cheeks, classic black and white nun habit with silver cross pendant, delicate silver rosary on wrist, holding a small worn leather bible",
  female_demon_girl: "playful young demon girl, short wild red hair with black tips, glowing amber-gold slit eyes, two small curved dark red demon horns, thin pointed devil tail with arrow tip, small black leathery bat wings, fitted black and crimson gothic mini-dress with silver lace, choker with silver skull pendant",
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
  male_rapper: "black man, short faded haircut, gold chain, designer streetwear, dominant expression",
  male_firefighter: "latino man, short dark hair, muscular build, firefighter uniform, heroic look",
  male_basketball_player: "black man, athletic tall build, short hair, basketball jersey, confident grin",
  male_barber: "black man, sharp fade haircut, well-groomed beard, fitted shirt and apron, charming smirk",
  male_surfer_m: "afro-latino man, sun-bleached hair, athletic lean body, board shorts, relaxed smile",
  male_tattoo_artist: "latino man, muscular build, dark slicked back hair, short beard, tattooed forearms and neck, silver chain, black t-shirt and leather apron, edgy confident smirk",
  male_mma_fighter: "muscular MMA fighter, short buzz cut with faded sides, sharp angular jawline, light stubble, intense dark brown eyes, small brow cut, athletic tape wrapped around both hands, fitted black tank top, professional MMA shorts, silver dog-tag necklace",
  male_vampire_lord: "ancient vampire lord, long black hair pulled back, glowing crimson red eyes, sharp fangs, pale skin, black high-collared Victorian coat with red velvet lining",
  male_demon_lord: "powerful demon lord, long flowing dark crimson hair, glowing golden slit eyes, large curved black demon horns, large leathery bat wings, black and gold aristocratic armor with red cape",
  male_werewolf_m: "alpha male werewolf, wild dark brown hair with grey streaks, glowing amber wolf eyes, subtle dark wolf ears, muscular bare chest with tribal tattoos, leather straps and fur mantle",
  male_dark_hunter: "brooding demon hunter, messy black hair with white streak, intense steel-grey eyes, scarred face, long dark leather trench coat, silver katana on back, bandaged arms",
  male_dragon_lord: "ancient dragon lord, long flowing dark silver hair with red streaks, glowing molten gold slit eyes, large curved black dragon horns, subtle golden scales on jaw and forearms, black and gold armored coat with high collar, golden dragon wings folded behind",
  male_elf_prince: "elegant elf prince, long flowing silver-blonde hair with subtle waves, sharp piercing emerald green eyes, pointed elf ears, refined aristocratic features, emerald green and gold regal outfit with silver embroidery and leaf motifs, ornate silver crown circlet with small emerald, long white cape with gold trim, silver longbow",
  male_oni_male: "powerful oni demon warrior, muscular imposing build, wild short dark red hair tied in topknot, glowing molten gold slit eyes, two sharp black horns, subtle red tiger-stripe markings on forearms and shoulders, sharp fangs in fierce grin, traditional short dark red kimono open chest showing muscular torso, red rope belt, large black kanabo club over shoulder",
  male_knight: "noble knight, wavy shoulder-length chestnut hair, kind blue-grey eyes, strong square jaw with light stubble, faint cheek scar, polished silver plate armor with gold accents and sacred engravings, crimson red cape over one shoulder, ornate silver cross pendant, silver longsword pointed down in ceremonial stance",
  male_angel_m: "celestial angel, long flowing golden-blonde hair with soft waves, luminous pale blue eyes with soft glow, flawless serene features, faint golden forehead markings, glowing golden halo floating above head, large pristine white feathered wings, elegant flowing white and gold celestial robe with sacred engravings, golden bracers on both wrists, gold chain necklace with small glowing gem",
}

// ============================================================
// FRAGMENTOS DE PROMPT POR VISIBILIDAD DE CARA
// ============================================================

const FACE_HIDDEN_FRAGMENT_ES = 'IMPORTANT: the subject\'s face is NOT visible in the photo. Use creative framing: shot from behind, back turned to camera, close-up on body and hands only, selfie cropped at the chin, over-the-shoulder angle without face, face hidden by phone or object, or facing away. The face must NOT appear.'

const FACE_PARTIAL_FRAGMENT_ES = 'The subject\'s face is only partially visible: side profile, three-quarter angle with hair covering one eye, or face softly obscured by shadow/dim light. Do not show a full clear face.'

// ============================================================
// SCENE PROMPTS POR NIVEL
// ============================================================

const SFW_SCENE_PROMPTS: Record<number, string> = {
  1: 'selfie style, casual daytime environment, fully dressed, cozy and wholesome, soft natural lighting, friendly smile, cute anime aesthetic, safe for work',
  2: 'selfie or mirror photo, bedroom setting, warm cozy lighting, fully dressed in casual outfit, subtle suggestive pose, flirty playful expression, safe for work',
  3: 'photo in bedroom or living room, dim moody lighting, provocative but fully covered outfit or elegant lingerie, seductive artistic pose, safe for work',
}

const NSFW_SCENE_PROMPTS: Record<number, string> = {
  4: 'intimate photo, minimal tasteful clothing or elegant lingerie, very revealing but no explicit nudity, artistic suggestive pose, low intimate lighting, bedroom setting, high-end boudoir aesthetic',
  5: 'artistic boudoir photo, tasteful implied nudity with strategic coverage (sheets, shadows, artistic angles), no exposed genitalia, no explicit sexual acts, high-end artistic composition, dramatic cinematic lighting, elegant and tasteful',
}

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { character_id, description } = await request.json()

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
    const faceVisibility = getFaceVisibility(level.level)

    if (user.gems < imageCost) {
      return NextResponse.json({
        error: 'insufficient_gems',
        message: user.language === 'en'
          ? `You need ${imageCost} gems`
          : `Necesitas ${imageCost} gemas`,
        required: imageCost,
      }, { status: 402 })
    }

    let imagePrompt: string
    let referenceUrl: string | undefined

    // ✅ ANTI-GENITALIA: instrucción explícita para niveles 4-5
    const NO_GENITALIA = 'tasteful artistic composition, no explicit genitalia, no nudity visible below waist, strategic coverage, high-end boudoir photography aesthetic, safe for platform'

    if (level.level <= 3) {
      // ── Niveles 1-3: DeepInfra (sin reference, con face hiding) ──
      const dna = CHARACTER_DNA[`${character.gender}_${character.archetype}`] || 'anime character'
      const scene = SFW_SCENE_PROMPTS[level.level] || SFW_SCENE_PROMPTS[1]

      // ✅ Reglas de visibilidad
      let faceRule = ''
      if (faceVisibility === 'hidden') {
        faceRule = FACE_HIDDEN_FRAGMENT_ES
      } else if (faceVisibility === 'partial') {
        faceRule = FACE_PARTIAL_FRAGMENT_ES
      }

      imagePrompt = `[CHARACTER DNA: ${dna}], anime style, cel shading, vibrant colors, detailed anime eyes, ${scene}, ${description}, ${faceRule}, high detail, beautiful cinematic lighting, 2D illustration, best quality, safe for work, no nudity, no explicit content`

      referenceUrl = undefined
    } else {
      // ── Niveles 4-5: Wiro con reference (cara completa, sin genitalia) ──
      const facePrompt = getCharacterFace(character.archetype, character.gender)
      const clothing = getClothingLevel(level.level)
      const scene = NSFW_SCENE_PROMPTS[level.level] || NSFW_SCENE_PROMPTS[4]

      imagePrompt = `${facePrompt}, anime style, cel shading, vibrant colors, detailed anime eyes, ${clothing}, ${scene}, ${description}, ${NO_GENITALIA}, beautiful cinematic lighting, 2D illustration, best quality`

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
      face_visibility: faceVisibility,
      model: level.level <= 3 ? 'deepinfra' : 'wiro',
    })
  } catch (error: any) {
    console.error('Error generando imagen:', error)
    return NextResponse.json({ error: 'Error al generar la imagen' }, { status: 500 })
  }
}
