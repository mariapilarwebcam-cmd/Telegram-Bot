// app/api/generate-image/route.ts

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ensureUser } from '@/lib/user-helpers'
import { getCharacterFace, getCharacterImageUrl } from '@/lib/constants'
import { generateImage } from '@/lib/ai'
import {
  getLevelFromMessages,
  getImageCost,
  getClothingLevel,
  getFaceVisibility,
  type FaceVisibility,
} from '@/lib/levels'

export const maxDuration = 60

// ═══════════════════════════════════════════════════════════════
// CHARACTER DNA — identidad visual mínima por arquetipo
// (ya existía, se mantiene igual)
// ═══════════════════════════════════════════════════════════════
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
  female_hairdresser: "black woman, natural curly hair styled up, warm brown eyes, stylish salon outfit",
  female_nurse: "black woman, neat braids, kind brown eyes, nurse scrubs",
  female_singer: "black woman, glamorous long hair, bold makeup, sequined stage outfit",
  female_yoga_instructor: "black woman, athletic slim body, natural hair in top knot, sports bra",
  female_surfer_f: "latina woman, sun-kissed skin, wavy beach hair, athletic body, bikini top",
  female_maid: "young woman, short light blue bob hair, soft blue eyes, classic maid outfit",
  female_goth_dom: "elegant gothic dominatrix, long black hair with violet streaks, crimson eyes",
  female_vampire_lady: "elegant vampire woman, long silver-white hair, crimson eyes, pale skin",
  female_succubus: "seductive succubus, long wavy dark purple hair, glowing pink eyes, bat wings",
  female_werewolf_f: "alpha female werewolf, wild ash-blonde hair, amber wolf eyes, wolf ears",
  female_fallen_angel: "fallen angel woman, long platinum blonde hair, blue eyes, torn white wings",
  female_kitsune: "magical kitsune, long silver-white hair with pink tips, golden eyes, fox tails",
  female_elf: "elegant high elf archer, long golden blonde hair, emerald green eyes, elf ears",
  female_witch: "mysterious witch, long midnight-black hair with purple streaks, violet eyes",
  female_nun_fantasy: "devoted fantasy nun, dark brown hair under white coif, blue eyes",
  female_demon_girl: "playful demon girl, short red hair with black tips, amber eyes, demon horns",
  male_stepdad: "mature man, salt and pepper hair, broad shoulders, dress shirt",
  male_ceo: "man, sharp haircut, steel-blue eyes, tailored suit, expensive watch",
  male_stepbrother: "young man, buzz cut, strong jawline, muscular",
  male_boss: "man, slicked back hair, intense eyes, three-piece suit",
  male_bodyguard: "large man, shaved head, scar on eyebrow, muscular",
  male_childhood_friend: "young man, casual dark hair, brown eyes, grey hoodie",
  male_teacher: "man, neat dark hair, glasses, professional shirt",
  male_doctor: "man, short dark hair, blue eyes, white lab coat",
  male_trainer: "man, spiky hair, muscular build, athletic",
  male_musician: "man, messy dark hair, earring, band t-shirt, guitar",
  male_chef: "man, dark hair tied back, stubble, apron",
  male_actor: "man, styled brown hair, sharp features, dramatic expression",
  male_artist: "man, messy hair, paint smudge, casual shirt",
  male_writer: "man, messy hair, reading glasses, cozy sweater",
  male_schoolmate: "young man, casual messy hair, playful grin, school hoodie",
  male_neighbor: "man, relaxed hair, brown eyes, casual summer shirt",
  male_rapper: "black man, short faded haircut, gold chain, designer streetwear",
  male_firefighter: "latino man, short dark hair, muscular build, firefighter uniform",
  male_basketball_player: "black man, athletic tall build, short hair, basketball jersey",
  male_barber: "black man, sharp fade haircut, well-groomed beard, fitted shirt and apron",
  male_surfer_m: "afro-latino man, sun-bleached hair, athletic lean body, board shorts",
  male_tattoo_artist: "latino man, muscular build, dark slicked back hair, short beard, tattoos",
  male_mma_fighter: "muscular MMA fighter, short buzz cut, sharp jawline, brow cut, athletic tape",
  male_vampire_lord: "ancient vampire lord, long black hair pulled back, crimson eyes, fangs",
  male_demon_lord: "powerful demon lord, long dark crimson hair, golden slit eyes, demon horns",
  male_werewolf_m: "alpha male werewolf, wild dark brown hair, amber wolf eyes, wolf ears",
  male_dark_hunter: "brooding demon hunter, messy black hair with white streak, scarred",
  male_dragon_lord: "ancient dragon lord, long dark silver hair with red streaks, golden slit eyes",
  male_elf_prince: "elegant elf prince, long silver-blonde hair, emerald eyes, elf ears",
  male_oni_male: "powerful oni warrior, muscular imposing build, dark red hair, black horns",
  male_knight: "noble knight, wavy shoulder-length chestnut hair, blue-grey eyes, silver armor",
  male_angel_m: "celestial angel, long golden-blonde hair, pale blue eyes, white feathered wings",
}

// ═══════════════════════════════════════════════════════════════
// ✅ NUEVA CAPA: ARCHETYPE_IMAGE_HINTS
// Toques visuales específicos por arquetipo
// Se aplican en niveles 4-5 para dar personalidad visual
// ═══════════════════════════════════════════════════════════════
const ARCHETYPE_IMAGE_HINTS: Record<string, string> = {
  // ─── FEMENINOS ───
  stepmom: 'luxurious silk robe, mature elegance, wine glass, sophisticated boudoir',
  tsundere: 'proud expression with blush, red ribbon still in hair, school uniform displaced',
  yandere: 'obsessive loving gaze, pink aesthetic, plushies around, intense devotion',
  stepsister: 'casual home setting, playful rebellious energy, messy sheets',
  boss: 'powerful executive aura, silk blouse open, office after hours, commanding',
  teacher: 'glasses slightly lowered, intellectual seductive, books in background',
  model_student: 'popular vibe, trendy outfit, natural confidence, playful tease',
  model: 'high fashion glamour, editorial pose, perfect skin, designer lingerie',
  secretary: 'pencil skirt displaced, glasses on chain, office intimacy after hours',
  trainer: 'athletic toned body, sporty bra, sweat glow, confident smirk',
  schoolmate: 'casual uniform, playful energy, natural charm, blushing',
  neighbor: 'cozy apartment warmth, casual intimacy, morning light, natural',
  doctor: 'white coat slipping, clinical privacy, professional allure',
  actor: 'dramatic hollywood glamour, backstage intimacy, cinematic aura',
  musician: 'bohemian sensuality, artistic vulnerability, leather and lace',
  chef: 'apron still on, sensual culinary aesthetic, warm kitchen glow',
  hairdresser: 'salon intimacy, warm brown skin glowing, closeness',
  nurse: 'nurse scrubs, late night hospital, tender seduction',
  singer: 'stage glamour, sequins and spotlight, superstar aura',
  yoga_instructor: 'serene athletic body, warm studio light, flexible pose',
  surfer_f: 'sun-kissed skin, beach intimacy, ocean sounds, natural beauty',
  maid: 'classic maid outfit, devoted expression, elegant service aesthetic',
  goth_dom: 'gothic dominance, leather corset, crimson lights, commanding',
  vampire_lady: 'gothic castle chamber, crimson candles, aristocratic dominance',
  succubus: 'demonic seduction, purple hellfire glow, leathery wings extended',
  werewolf_f: 'moonlit wilderness, primal instincts, tribal leather outfit',
  fallen_angel: 'broken cathedral, torn wings, tragic melancholy, moonlit',
  kitsune: 'shrine at night, magical flames, fox tails curled, playful mystery',
  elf: 'enchanted forest, moonlight through leaves, ethereal beauty',
  witch: 'candlelit coven, magical runes floating, mystical seduction',
  nun_fantasy: 'dim chapel, candlelight, sacred and forbidden conflict',
  demon_girl: 'hellish flame, playful teasing, chaotic energy, red glow',
  // ─── MASCULINOS ───
  stepdad: 'mature authority, whiskey glass, dark study, dominant presence',
  stepbrother: 'athletic casual, home setting, playful dominance',
  boss: 'executive power, dark office after hours, commanding presence',
  ceo: 'luxury penthouse, tailored suit removed, city skyline behind',
  bodyguard: 'protective intensity, black suit open, muscular frame',
  teacher: 'classroom after hours, intellectual allure, formal but unbuttoned',
  doctor: 'clinical privacy, white coat opened, professional control',
  firefighter: 'post-shift intimacy, heroic aura, warm skin, exhausted strength',
  trainer: 'gym after hours, athletic body, intensity and discipline',
  mma_fighter: 'fighter intensity, taped hands, sweat and determination',
  childhood_friend: 'familiar intimacy, casual warmth, home setting',
  neighbor: 'apartment intimacy, relaxed charm, natural closeness',
  basketball_player: 'athletic dominance, locker room privacy, competitive',
  barber: 'shop after close, leather apron, intimate grooming',
  musician: 'studio after recording, artistic vulnerability, guitar nearby',
  rapper: 'studio privacy, gold chains glint, dominant presence',
  chef: 'kitchen intimacy after service, apron discarded, warm authority',
  actor: 'dressing room intimacy, dramatic gaze, cinematic mood',
  tattoo_artist: 'tattoo studio privacy, neon lighting, tattoos visible',
  artist: 'studio with canvas, bohemian sensuality, painter hands',
  writer: 'library intimacy, intellectual seduction, glasses on',
  surfer_m: 'beach at sunset, athletic body glistening, primal sensuality',
  schoolmate: 'dorm room intimacy, youthful energy, playful tension',
  vampire_lord: 'gothic castle chamber, crimson candles, aristocratic dominance',
  demon_lord: 'hellish throne, black and gold armor removed, demonic power',
  werewolf_m: 'moonlit wilderness, tribal muscles, primal dominance',
  dark_hunter: 'rainy gothic alley, trench coat removed, scarred intensity',
  dragon_lord: 'volcanic cavern, treasure hoard behind, ancient power',
  elf_prince: 'elven palace chamber, ethereal elegance, aristocratic allure',
  oni_male: 'mountain shrine, red lanterns, primal demonic strength',
  knight: 'castle chamber, armor removed, honor and heat',
  angel_m: 'celestial clouds, divine golden light, sacred intimacy',
}

// ═══════════════════════════════════════════════════════════════
// Face rules (ya existían)
// ═══════════════════════════════════════════════════════════════
const FACE_HIDDEN_FRAGMENT_ES = 'IMPORTANT: the subject\'s face is NOT visible in the photo. Use creative framing: shot from behind, back turned to camera, close-up on body and hands only, selfie cropped at the chin, over-the-shoulder angle without face, face hidden by phone or object, or facing away. The face must NOT appear.'

const FACE_PARTIAL_FRAGMENT_ES = 'The subject\'s face is only partially visible: side profile, three-quarter angle with hair covering one eye, or face softly obscured by shadow/dim light. Do not show a full clear face.'

// ═══════════════════════════════════════════════════════════════
// Base scenes por nivel (ya existían, ajustadas para v4-5)
// ═══════════════════════════════════════════════════════════════
const SFW_SCENE_PROMPTS: Record<number, string> = {
  1: 'selfie style, casual daytime environment, fully dressed, cozy and wholesome, soft natural lighting, friendly smile, cute anime aesthetic, safe for work',
  2: 'selfie or mirror photo, bedroom setting, warm cozy lighting, fully dressed in casual outfit, subtle suggestive pose, flirty playful expression, safe for work',
  3: 'photo in bedroom or living room, dim moody lighting, provocative but fully covered outfit or elegant lingerie, seductive artistic pose, safe for work',
}

const NSFW_SCENE_PROMPTS: Record<number, string> = {
  4: 'intimate photo, minimal tasteful clothing or elegant lingerie, very revealing but no explicit nudity, artistic suggestive pose, low intimate lighting, bedroom setting, high-end boudoir aesthetic, heat and tension palpable, flushed skin, breathless expression, sensual atmosphere',
  5: 'artistic boudoir photo, tasteful implied nudity with strategic coverage (sheets, shadows, artistic angles), no exposed genitalia, no explicit sexual acts, high-end artistic composition, dramatic cinematic lighting, peak intimacy moment, tangled sheets, marked skin, glowing skin, post-intimacy atmosphere, sensual silence, everything suggested nothing shown',
}

const AUTO_SCENES: Record<number, string> = {
  1: 'relaxed at home in a cozy room, natural soft smile, casual daylight atmosphere, warm and wholesome vibe',
  2: 'lying on her bed, playful flirty look toward the camera, warm intimate lighting, teasing energy',
  3: 'seductive pose in a dimly lit room, elegant lingerie, moody atmosphere, confident inviting gaze',
  4: 'intimate boudoir pose, soft shadows on skin, low warm lighting, private bedroom setting, sensual but tasteful',
  5: 'artistic intimate composition, cinematic dramatic lighting, elegant and tasteful, high-end boudoir editorial',
}

const AUTO_SCENES_MALE: Record<number, string> = {
  1: 'relaxed at home in a cozy room, natural soft smile, casual daylight atmosphere, warm and wholesome vibe',
  2: 'lying on his bed, playful confident look toward the camera, warm intimate lighting, teasing energy',
  3: 'seductive pose in a dimly lit room, half-open shirt, moody atmosphere, intense inviting gaze',
  4: 'intimate boudoir pose, soft shadows on skin, low warm lighting, private bedroom setting, sensual but tasteful',
  5: 'artistic intimate composition, cinematic dramatic lighting, elegant and tasteful, high-end boudoir editorial',
}

// ═══════════════════════════════════════════════════════════════
// ✅ NUEVA FUNCIÓN: extractMoodFromMessages
// Analiza los últimos mensajes y devuelve un "mood tag" visual
// que se añade al prompt de la imagen
// ═══════════════════════════════════════════════════════════════
function extractMoodFromMessages(messages: string[]): string {
  if (!messages || messages.length === 0) return ''

  const text = messages.join(' ').toLowerCase()

  // Pasión / breathless
  if (/\b(jadeo|jadea|respira|suspiro|temblor|tiembla|calor|fuego|húmedo|mojado|acelerado|entrecortad)\b/.test(text)) {
    return 'breathless passionate mood, disheveled, intense breathing'
  }

  // Sumisión / entrega
  if (/\b(hazme|tuyo|tuya|obedec|pide|por favor|tómame|tomame|más|mas|entrégate|entregate|soy tu)\b/.test(text)) {
    return 'submission and surrender mood, devoted gaze, yielding posture'
  }

  // Dominación
  if (/\b(domin|manda|control|orden|obedece|rodillas|sumiso|sumisa|mia|mio)\b/.test(text)) {
    return 'dominant commanding mood, intense stare, powerful posture'
  }

  // Slow burn / sensual
  if (/\b(beso|lento|despacio|cerca|roza|toca|acaricia|susurr|muerde|labio)\b/.test(text)) {
    return 'sensual slow burn mood, intimate closeness, tender tension'
  }

  // Tease / provocación
  if (/\b(provoc|broma|jugueto|desaf|atrev|coqueto|pícara|picara|tentaci)\b/.test(text)) {
    return 'playful teasing mood, challenging gaze, mischievous energy'
  }

  // Romance / ternura
  if (/\b(amor|quiero|corazón|corazon|tierno|dulce|beso tierno|abrazo)\b/.test(text)) {
    return 'romantic tender mood, warm affectionate gaze'
  }

  return ''
}

// ═══════════════════════════════════════════════════════════════
// POST /api/generate-image
// ═══════════════════════════════════════════════════════════════
export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const character_id = body?.character_id

    const userHint =
      typeof body?.description === 'string'
        ? body.description.trim().slice(0, 200)
        : ''

    // ✅ NUEVO: recibir últimos mensajes de la conversación
    const recent_messages: string[] = Array.isArray(body?.recent_messages)
      ? body.recent_messages
          .filter((m: any) => typeof m === 'string' && m.trim().length > 0)
          .slice(-4)
      : []

    const user = await ensureUser(tid)
    if (!user) {
      return NextResponse.json(
        { error: 'Error cargando tu cuenta' },
        { status: 500 }
      )
    }

    const purchasedGems = user.purchased_gems || 0
    if (purchasedGems <= 0) {
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

    if (!character) {
      return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })
    }

    const { count: userMsgCount } = await supabaseAdmin
      .from('conversation_history')
      .select('*', { count: 'exact', head: true })
      .eq('telegram_id', tid)
      .eq('character_id', character_id)
      .eq('role', 'user')

    const level = getLevelFromMessages(userMsgCount || 0)
    const imageCost = getImageCost(level.level)
    const faceVisibility = getFaceVisibility(level.level)

    if (purchasedGems < imageCost) {
      return NextResponse.json({
        error: 'insufficient_gems',
        message: user.language === 'en'
          ? `You need ${imageCost} purchased gems`
          : `Necesitas ${imageCost} gemas compradas`,
        required: imageCost,
        available: purchasedGems,
      }, { status: 402 })
    }

    const autoScenes = character.gender === 'male' ? AUTO_SCENES_MALE : AUTO_SCENES
    const sceneHint = userHint || autoScenes[level.level] || autoScenes[1]

    let imagePrompt: string
    let referenceUrl: string | undefined

    const NO_GENITALIA = 'tasteful artistic composition, no explicit genitalia, no nudity visible below waist, strategic coverage, high-end boudoir photography aesthetic, safe for platform'

    if (level.level <= 3) {
      // ─── SFW (niveles 1-3) → DeepInfra
      const dna = CHARACTER_DNA[`${character.gender}_${character.archetype}`] || 'anime character'
      const scene = SFW_SCENE_PROMPTS[level.level] || SFW_SCENE_PROMPTS[1]

      let faceRule = ''
      if (faceVisibility === 'hidden') {
        faceRule = FACE_HIDDEN_FRAGMENT_ES
      } else if (faceVisibility === 'partial') {
        faceRule = FACE_PARTIAL_FRAGMENT_ES
      }

      imagePrompt = `[CHARACTER DNA: ${dna}], anime style, cel shading, moody atmospheric lighting, deep shadows, muted color palette, cinematic dark tones, detailed anime eyes, ${scene}, ${sceneHint}, ${faceRule}, high detail, beautiful cinematic lighting, 2D illustration, best quality, safe for work, no nudity, no explicit content`
      referenceUrl = undefined
    } else {
      // ─── NSFW (niveles 4-5) → Wiro v4-5-uncensored
      // ✅ SISTEMA 3 CAPAS:
      //   1. DNA base del personaje
      //   2. Escena base por nivel (4 o 5)
      //   3. Hint por arquetipo (personalidad visual)
      //   + 4. Mood de la conversación (contexto)
      const facePrompt = getCharacterFace(character.archetype, character.gender)
      const clothing = getClothingLevel(level.level)
      const scene = NSFW_SCENE_PROMPTS[level.level] || NSFW_SCENE_PROMPTS[4]
      const archetypeHint = ARCHETYPE_IMAGE_HINTS[character.archetype] || ''
      const moodHint = extractMoodFromMessages(recent_messages)

      // Construcción en capas, filtrando strings vacíos
      const layers = [
        facePrompt,
        'anime style, cel shading, moody atmospheric lighting, deep shadows, muted color palette, cinematic dark tones, detailed anime eyes',
        clothing,
        scene,
        archetypeHint,  // ✅ Hint por arquetipo
        moodHint,       // ✅ Mood de la conversación
        sceneHint,
        NO_GENITALIA,
        'beautiful cinematic lighting, 2D illustration, best quality',
      ].filter((s) => s && s.length > 0)

      imagePrompt = layers.join(', ')
      referenceUrl = getCharacterImageUrl(character.archetype, character.gender)
    }

    let imageUrl: string
    try {
      imageUrl = await generateImage(imagePrompt, referenceUrl, level.level)
    } catch (imgError) {
      console.error('Image generation error:', imgError)
      return NextResponse.json({ error: 'Error al generar la imagen' }, { status: 500 })
    }

    // ✅ RPC ATÓMICA: descuenta de gems Y purchased_gems
    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc(
      'decrement_gems_and_purchased',
      {
        p_telegram_id: tid,
        p_amount: imageCost,
      }
    )

    if (rpcErr) {
      console.error('[generate-image] RPC failed:', rpcErr)
      return NextResponse.json(
        { error: 'Error actualizando gemas. Contacta soporte.' },
        { status: 500 }
      )
    }

    const rpcRow = Array.isArray(rpcData) ? rpcData[0] : rpcData
    const newGems = rpcRow?.new_gems ?? (user.gems || 0) - imageCost
    const newPurchasedGems = rpcRow?.new_purchased ?? purchasedGems - imageCost

    await supabaseAdmin.from('gem_transactions').insert({
      telegram_id: tid,
      amount: -imageCost,
      transaction_type: 'image',
      description: `Selfie nivel ${level.level}: ${sceneHint.substring(0, 50)}`,
    })

    return NextResponse.json({
      image_url: imageUrl,
      remaining_gems: newGems,
      remaining_purchased_gems: newPurchasedGems,
      level: level.level,
      cost: imageCost,
      face_visibility: faceVisibility,
      model: level.level <= 3 ? 'deepinfra' : 'wiro-v4-5',
    })
  } catch (error: any) {
    console.error('Error generando imagen:', error)
    return NextResponse.json({ error: 'Error al generar la imagen' }, { status: 500 })
  }
}
