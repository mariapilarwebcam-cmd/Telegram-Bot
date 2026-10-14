// app/api/generate-image/route.ts

import { NextResponse } from 'next/server'
import {
  ensureUser,
  getCharacter,
  countUserMessages,
  decrementGemsAndPurchased,
  insertGemTransaction,
  getSeenImageCount,
  markImageSeen,
  getPoolImageByTag,
  incrementPoolImageUse,
  insertPoolImage,
  insertMessage,
} from '@/lib/db-queries'
import { getCharacterFace, getCharacterImageUrl } from '@/lib/constants'
import { generateImage } from '@/lib/ai'
import {
  getLevelFromMessages,
  getImageCost,
  getClothingLevel,
  getFaceVisibility,
  type FaceVisibility,
} from '@/lib/levels'
import {
  r2Available,
  uploadToR2,
  downloadImage,
  buildR2Key,
  buildTagKey,
} from '@/lib/r2-upload'

export const maxDuration = 60

// ═══════════════════════════════════════════════════════════════
// CHARACTER DNA — identidad visual mínima por arquetipo
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
// ARCHETYPE_IMAGE_HINTS
// ═══════════════════════════════════════════════════════════════
const ARCHETYPE_IMAGE_HINTS: Record<string, string> = {
  female_stepmom: 'luxurious silk robe, mature elegance, wine glass, sophisticated boudoir',
  female_tsundere: 'proud expression with blush, red ribbon still in hair, school uniform displaced',
  female_yandere: 'obsessive loving gaze, pink aesthetic, plushies around, intense devotion',
  female_stepsister: 'casual home setting, playful rebellious energy, messy sheets',
  female_boss: 'powerful executive aura, silk blouse open, office after hours, commanding',
  female_teacher: 'glasses slightly lowered, intellectual seductive, books in background',
  female_model_student: 'popular vibe, trendy outfit, natural confidence, playful tease',
  female_model: 'high fashion glamour, editorial pose, perfect skin, designer lingerie',
  female_secretary: 'pencil skirt displaced, glasses on chain, office intimacy after hours',
  female_trainer: 'athletic toned body, sporty bra, sweat glow, confident smirk',
  female_schoolmate: 'casual uniform, playful energy, natural charm, blushing',
  female_neighbor: 'cozy apartment warmth, casual intimacy, morning light, natural',
  female_doctor: 'white coat slipping, clinical privacy, professional allure',
  female_actor: 'dramatic hollywood glamour, backstage intimacy, cinematic aura',
  female_musician: 'bohemian sensuality, artistic vulnerability, leather and lace',
  female_chef: 'apron still on, sensual culinary aesthetic, warm kitchen glow',
  female_hairdresser: 'salon intimacy, warm brown skin glowing, closeness',
  female_nurse: 'nurse scrubs, late night hospital, tender seduction',
  female_singer: 'stage glamour, sequins and spotlight, superstar aura',
  female_yoga_instructor: 'serene athletic body, warm studio light, flexible pose',
  female_surfer_f: 'sun-kissed skin, beach intimacy, ocean sounds, natural beauty',
  female_maid: 'classic maid outfit, devoted expression, elegant service aesthetic',
  female_goth_dom: 'gothic dominance, leather corset, crimson lights, commanding',
  female_vampire_lady: 'gothic castle chamber, crimson candles, aristocratic dominance',
  female_succubus: 'demonic seduction, purple hellfire glow, leathery wings extended',
  female_werewolf_f: 'moonlit wilderness, primal instincts, tribal leather outfit',
  female_fallen_angel: 'broken cathedral, torn wings, tragic melancholy, moonlit',
  female_kitsune: 'shrine at night, magical flames, fox tails curled, playful mystery',
  female_elf: 'enchanted forest, moonlight through leaves, ethereal beauty',
  female_witch: 'candlelit coven, magical runes floating, mystical seduction',
  female_nun_fantasy: 'dim chapel, candlelight, sacred and forbidden conflict',
  female_demon_girl: 'hellish flame, playful teasing, chaotic energy, red glow',
  male_stepdad: 'mature authority, whiskey glass, dark study, dominant presence',
  male_stepbrother: 'athletic casual, home setting, playful dominance',
  male_boss: 'executive power, dark office after hours, commanding presence',
  male_ceo: 'luxury penthouse, tailored suit removed, city skyline behind',
  male_bodyguard: 'protective intensity, black suit open, muscular frame',
  male_teacher: 'classroom after hours, intellectual allure, formal but unbuttoned',
  male_doctor: 'clinical privacy, white coat opened, professional control',
  male_firefighter: 'post-shift intimacy, heroic aura, warm skin, exhausted strength',
  male_trainer: 'gym after hours, athletic body, intensity and discipline',
  male_mma_fighter: 'fighter intensity, taped hands, sweat and determination',
  male_childhood_friend: 'familiar intimacy, casual warmth, home setting',
  male_neighbor: 'apartment intimacy, relaxed charm, natural closeness',
  male_basketball_player: 'athletic dominance, locker room privacy, competitive',
  male_barber: 'shop after close, leather apron, intimate grooming',
  male_musician: 'studio after recording, artistic vulnerability, guitar nearby',
  male_rapper: 'studio privacy, gold chains glint, dominant presence',
  male_chef: 'kitchen intimacy after service, apron discarded, warm authority',
  male_actor: 'dressing room intimacy, dramatic gaze, cinematic mood',
  male_tattoo_artist: 'tattoo studio privacy, neon lighting, tattoos visible',
  male_artist: 'studio with canvas, bohemian sensuality, painter hands',
  male_writer: 'library intimacy, intellectual seduction, glasses on',
  male_surfer_m: 'beach at sunset, athletic body glistening, primal sensuality',
  male_schoolmate: 'dorm room intimacy, youthful energy, playful tension',
  male_vampire_lord: 'gothic castle chamber, crimson candles, aristocratic dominance',
  male_demon_lord: 'hellish throne, black and gold armor removed, demonic power',
  male_werewolf_m: 'moonlit wilderness, tribal muscles, primal dominance',
  male_dark_hunter: 'rainy gothic alley, trench coat removed, scarred intensity',
  male_dragon_lord: 'volcanic cavern, treasure hoard behind, ancient power',
  male_elf_prince: 'elven palace chamber, ethereal elegance, aristocratic allure',
  male_oni_male: 'mountain shrine, red lanterns, primal demonic strength',
  male_knight: 'castle chamber, armor removed, honor and heat',
  male_angel_m: 'celestial clouds, divine golden light, sacred intimacy',
}

const FACE_HIDDEN_FRAGMENT =
  "The subject's face is NOT visible in the photo. Use creative framing: selfie cropped at chin level, shot from behind, close-up on body and hands only, over-the-shoulder angle without face, face hidden by phone position, hair, turned away, or by an object. The face must NOT appear or must be completely obscured."

const FACE_PARTIAL_FRAGMENT =
  "The subject's face is only partially visible: side profile in soft shadow, three-quarter angle with hair covering one eye, face softly obscured by dim light or shadow, or turned to the side. Do not show a full clear frontal face."

const SFW_SCENE_PROMPTS: Record<number, string> = {
  1: `selfie photo taken by the character with the phone in hand, close to the body,
      framing: chest-up or waist-up selfie, face naturally cropped by phone position or turned away,
      pose: casual relaxed natural body posture, one hand holding the phone, weight on one leg,
      outfit: casual everyday clothes fully covered (oversized hoodie, plain t-shirt, comfortable sweater, casual jeans),
      environment: cozy home setting, warm afternoon daylight, soft natural window light,
      mood: wholesome, friendly, approachable, playful casual vibe,
      focus: casual outfit details, natural body language, hands holding phone, room atmosphere,
      detail level: high detail on fabric, hands, hair, room decor,
      avoid showing face clearly, mysterious framing,
      style: anime illustration, cel shading, muted color palette, soft cinematic lighting,
      no nudity, no suggestive content, safe for work, cozy anime aesthetic`,

  2: `mirror selfie in bedroom, phone in hand or one hand resting on hip,
      framing: waist-up mirror shot, face obscured by the phone, hair falling in front, or turned away,
      pose: flirty relaxed pose, weight shifted on one hip, subtle playful body language,
      one hand adjusting hair or resting on collarbone, slight hip tilt,
      outfit: slightly revealing casual outfit fully covered
              (crop top with high-waist jeans, fitted tank top, short summer skirt, thin knit sweater slipping off one shoulder) — no cleavage visible, no nudity,
      environment: cozy bedroom, warm intimate lighting, soft shadows, dim lamp in background,
      mood: flirty, playful, teasing, mysterious — inviting but safe,
      focus: body silhouette, outfit details, playful pose, hair movement, environment atmosphere,
      detail level: very high detail on fabric texture, hair strands, lighting on skin, room depth,
      avoid showing face clearly,
      style: anime illustration, cel shading, muted color palette, warm cinematic lighting with soft rim light,
      no nudity, no explicit content, safe for work, flirty anime aesthetic`,

  3: `seductive artistic photo in bedroom or bathroom, selfie-style composition,
      framing: artistic shot from neck down, or from behind, or from the side with strong shadow,
      face only partially visible: soft side profile in dim shadow, or hair covering the eyes,
      or turned fully away — elegant framing that hides or veils the face,
      pose: confident elegant seductive pose, artistic silhouette, graceful body language,
      one hand on hip or slowly tracing collarbone, subtle arched back, chin lifted slightly,
      outfit: elegant provocative lingerie or minimal but tasteful coverage
              (black lace bralette with silk robe slipping off one shoulder,
               sleek satin slip dress with thin straps,
               delicate lace set with thigh-high stockings,
               silk camisole and high-waist underwear) —
              very revealing but ALWAYS covered, no nudity, no exposed genitalia,
      environment: dim moody bedroom or elegant bathroom, warm intimate lighting,
                   single warm light source (bedside lamp, candle, or window at dusk),
                   soft shadows on skin, silk sheets visible, perfume bottle or wine glass nearby,
      mood: seductive, intimate, artistic, mysterious, tasteful tease —
            sensual but classy, elegant and confident,
      focus: body curves under fabric, elegant posture, lighting on skin and fabric,
             silk texture, lace details, environment atmosphere, artistic shadow play,
      detail level: extremely high detail on fabric, lace, lighting, skin tones, shadow gradients,
      strongly avoid showing face clearly — keep it mysterious,
      style: anime illustration, cel shading, muted color palette,
             dramatic cinematic lighting with rich shadows and warm rim light,
             high detail, best quality,
      no nudity, no explicit content, safe for work, elegant anime aesthetic`,
}

const NSFW_SCENE_PROMPTS: Record<number, string> = {
  4: 'intimate photo, minimal tasteful clothing or elegant lingerie, very revealing but no explicit nudity, artistic suggestive pose, low intimate lighting, bedroom setting, high-end boudoir aesthetic, heat and tension palpable, flushed skin, breathless expression, sensual atmosphere',
  5: 'artistic boudoir photo, tasteful implied nudity with strategic coverage (sheets, shadows, artistic angles), no exposed genitalia, no explicit sexual acts, high-end artistic composition, dramatic cinematic lighting, peak intimacy moment, tangled sheets, marked skin, glowing skin, post-intimacy atmosphere, sensual silence, everything suggested nothing shown',
}

const AUTO_SCENES_FEMALE: Record<number, string> = {
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
// extractMoodFromMessages — 18 moods (devuelve keys cortos)
// ═══════════════════════════════════════════════════════════════
function extractMoodFromMessages(messages: string[]): string {
  if (!messages || messages.length === 0) return ''

  const text = messages.join(' ').toLowerCase()

  if (/\b(jadeo|jadea|respira|suspiro|temblor|tiembla|calor|fuego|húmedo|mojado|acelerado|entrecortad)\b/.test(text)) {
    return 'breathless_passionate'
  }
  if (/\b(hazme|tuyo|tuya|obedec|pide|por favor|tómame|tomame|entrégate|entregate|soy tu)\b/.test(text)) {
    return 'submission_surrender'
  }
  if (/\b(domin|manda|control|orden|obedece|rodillas|sumiso|sumisa|mía|mio)\b/.test(text)) {
    return 'dominant_commanding'
  }
  if (/\b(beso|lento|despacio|cerca|roza|toca|acaricia|susurr|muerde|labio)\b/.test(text)) {
    return 'sensual_slow_burn'
  }
  if (/\b(provoc|broma|jugueto|desaf|atrev|coqueto|pícara|picara|tentaci)\b/.test(text)) {
    return 'playful_teasing'
  }
  if (/\b(amor|quiero|corazón|corazon|tierno|dulce|abrazo)\b/.test(text)) {
    return 'romantic_tender'
  }
  if (/\b(enfadad|enojad|discutir|discusión|discusion|pelea|pelean|celos|celoso|reclama|grita|gritar|furia|furios)\b/.test(text)) {
    return 'tense_argument'
  }
  if (/\b(triste|llorar|llora|lágrimas|lagrimas|melancol|consuelo|consolar|vulnerab)\b/.test(text)) {
    return 'emotional_vulnerable'
  }
  if (/\b(lluvia|llueve|tormenta|tempestad|chaparrón|chaparro|empapad)\b/.test(text)) {
    return 'rainy_intimate'
  }
  if (/\b(playa|arena|olas|atardecer|surf|bikini|traje de baño|oceano|océano|costa|marea)\b/.test(text)) {
    return 'sunset_beach'
  }
  if (/\b(cama|sábanas|sabanas|almohada|acostad|recostad|dormir|dormida|dormido|descansar|despierta)\b/.test(text)) {
    return 'bedroom_intimacy'
  }
  if (/\b(ducha|bañera|banera|vapor|vaporoso|jabón|jabon|agua caliente|espuma|burbujas)\b/.test(text)) {
    return 'bathroom_steamy'
  }
  if (/\b(cocina|cocinar|cocinando|comida|cena|vino|bebida|desayuno|restaurante)\b/.test(text)) {
    return 'kitchen_intimacy'
  }
  if (/\b(fiesta|baile|bailar|bailando|música|musica|club|discoteca|concierto)\b/.test(text)) {
    return 'nightlife_party'
  }
  if (/\b(gym|gimnasio|entrenar|entrenando|deporte|sudor|sudando|ejercicio|pesas|cardio|correr)\b/.test(text)) {
    return 'post_workout'
  }
  if (/\b(auto|coche|carro|manejar|conducir|viaje|carretera|road trip)\b/.test(text)) {
    return 'car_ride'
  }
  if (/\b(noche|luna|estrellas|oscuridad|medianoche|nocturno|misterio|velas)\b/.test(text)) {
    return 'night_mystery'
  }
  if (/\b(risa|ríe|rie|reír|reir|divertid|juego|jugando|sonrisa|sonríe|sonrie|alegre)\b/.test(text)) {
    return 'playful_laughing'
  }

  return ''
}

// ═══════════════════════════════════════════════════════════════
// MOOD_FRAGMENTS — convierte keys a fragmentos de prompt
// ═══════════════════════════════════════════════════════════════
const MOOD_FRAGMENTS: Record<string, string> = {
  breathless_passionate: 'breathless passionate mood, disheveled, intense breathing',
  submission_surrender: 'submission and surrender mood, devoted gaze, yielding posture',
  dominant_commanding: 'dominant commanding mood, intense stare, powerful posture',
  sensual_slow_burn: 'sensual slow burn mood, intimate closeness, tender tension',
  playful_teasing: 'playful teasing mood, challenging gaze, mischievous energy',
  romantic_tender: 'romantic tender mood, warm affectionate gaze',
  tense_argument: 'tense argument mood, flushed face, intense eye contact, raw emotion',
  emotional_vulnerable: 'emotional vulnerable mood, teary eyes, soft comfort, seeking warmth',
  rainy_intimate: 'rainy intimate mood, wet hair, cozy warmth, close proximity, soft droplets',
  sunset_beach: 'sunset beach mood, golden hour lighting, ocean breeze, barefoot intimacy',
  bedroom_intimacy: 'bedroom intimacy mood, tangled sheets, soft morning light, relaxed pose',
  bathroom_steamy: 'bathroom steamy mood, water droplets, warm mist, intimate privacy',
  kitchen_intimacy: 'kitchen intimacy mood, warm lighting, casual closeness, domestic atmosphere',
  nightlife_party: 'nightlife party mood, dancing lights, energetic intimacy, vibrant atmosphere',
  post_workout: 'post-workout mood, athletic glow, sweat sheen, intense energy',
  car_ride: 'car ride intimacy mood, private space, cinematic road atmosphere',
  night_mystery: 'night mystery mood, moonlight, deep shadows, intimate darkness',
  playful_laughing: 'playful laughing mood, genuine smile, relaxed happy energy',
}

function buildR2VariantUrl(
  gender: string,
  archetype: string,
  index: number
): string {
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL
  if (!base) return ''
  const clean = base.replace(/\/$/, '')
  return `${clean}/${gender}_${archetype}_${index}.jpg?v=8`
}

// ✅ Helper: nivel → bucket
function getLevelBucket(level: number): 'sfw' | 'nsfw' {
  return level <= 3 ? 'sfw' : 'nsfw'
}

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

    const character = await getCharacter(character_id, tid)
    if (!character) {
      return NextResponse.json(
        { error: 'Personaje no encontrado' },
        { status: 404 }
      )
    }

    const userMsgCount = await countUserMessages(tid, character_id)
    const level = getLevelFromMessages(userMsgCount || 0)
    const imageCost = getImageCost(level.level)
    const faceVisibility = getFaceVisibility(level.level)

    const seenCount = await getSeenImageCount(tid, character_id)

    const genderKey = character.gender === 'male' ? 'male' : 'female'
    const r2Base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL

    // ═══════════════════════════════════════════════════════════════
    // ROTACIÓN R2 ESTÁTICA
    // ═══════════════════════════════════════════════════════════════
    let r2Index: number | null = null
    let isFree = false

    if (seenCount === 0) {
      r2Index = 1
      isFree = true
    } else if (seenCount === 1) {
      r2Index = 2
    } else if (seenCount === 2 && level.level >= 4) {
      r2Index = 3
    } else if (seenCount === 3 && level.level >= 4) {
      r2Index = 4
    }

    const useR2Static = r2Index !== null && !!r2Base

    // ═══════════════════════════════════════════════════════════════
    // PREMIUM CHECK — solo si NO es gratis
    // ═══════════════════════════════════════════════════════════════
    const purchasedGems = user.purchased_gems || 0

    if (!isFree) {
      if (purchasedGems <= 0) {
        return NextResponse.json(
          {
            error: 'premium_required',
            message:
              user.language === 'en'
                ? 'Image generation is a Premium feature. Buy gems with Stars to unlock it.'
                : 'La generación de imágenes es Premium. Compra gemas con Stars para desbloquearla.',
          },
          { status: 403 }
        )
      }

      if (purchasedGems < imageCost) {
        return NextResponse.json(
          {
            error: 'insufficient_gems',
            message:
              user.language === 'en'
                ? `You need ${imageCost} purchased gems`
                : `Necesitas ${imageCost} gemas compradas`,
            required: imageCost,
            available: purchasedGems,
          },
          { status: 402 }
        )
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // OBTENER IMAGEN
    // ✅ FIX TS: definite assignment assertions (!) para imageUrl, source, modelUsed
    //    TypeScript no puede trazar todos los caminos de asignación con la
    //    lógica compleja de pool + generación + upload.
    // ═══════════════════════════════════════════════════════════════
    let imageUrl!: string
    let source!: 'r2_static' | 'pool' | 'generated'
    let modelUsed!: string
    let promptUsed = ''

    if (useR2Static) {
      // ─── ROTACIÓN R2 ESTÁTICA ───
      imageUrl = buildR2VariantUrl(genderKey, character.archetype, r2Index!)
      source = 'r2_static'
      modelUsed = 'r2'

      try {
        await markImageSeen(tid, character_id, r2Index!, false)
      } catch (markErr) {
        console.warn('[generate-image] markImageSeen failed:', markErr)
      }

      console.log(
        `[generate-image] ✅ R2 static: _${r2Index} (${isFree ? 'FREE' : `${imageCost}g`})`
      )
    } else {
      // ═══════════════════════════════════════════════════════════════
      // ✅ POOL: intentar reutilizar imagen existente
      // ═══════════════════════════════════════════════════════════════
      const mood = extractMoodFromMessages(recent_messages)
      const levelBucket = getLevelBucket(level.level)

      // Si hay userHint, NO usamos pool (es una petición personalizada)
      const usePool = !userHint && !!mood && r2Available

      let poolHit = false

      if (usePool) {
        const tagKey = buildTagKey(character.archetype, genderKey, mood, levelBucket)

        try {
          const existing = await getPoolImageByTag(tagKey)
          if (existing) {
            console.log(
              `[generate-image] ♻️ Pool HIT: ${tagKey} (used ${existing.times_used}x)`
            )
            imageUrl = existing.r2_url
            source = 'pool'
            modelUsed = 'pool'
            promptUsed = existing.prompt_used
            poolHit = true

            // Incrementar contador (fire-and-forget)
            incrementPoolImageUse(tagKey).catch(() => {})
          }
        } catch (poolErr) {
          console.warn('[generate-image] Pool lookup failed (continuing):', poolErr)
        }
      }

      // Si NO hubo pool hit → generar
      if (!poolHit) {
        const autoScenes =
          character.gender === 'male' ? AUTO_SCENES_MALE : AUTO_SCENES_FEMALE
        const sceneHint = userHint || autoScenes[level.level] || autoScenes[1]

        const NO_GENITALIA =
          'tasteful artistic composition, no explicit genitalia, no nudity visible below waist, strategic coverage, high-end boudoir photography aesthetic, safe for platform'

        let imagePrompt: string
        let referenceUrl: string | undefined

        if (level.level <= 3) {
          const dna =
            CHARACTER_DNA[`${character.gender}_${character.archetype}`] ||
            'anime character'
          const scene = SFW_SCENE_PROMPTS[level.level] || SFW_SCENE_PROMPTS[1]

          let faceRule = ''
          if (faceVisibility === 'hidden') {
            faceRule = FACE_HIDDEN_FRAGMENT
          } else if (faceVisibility === 'partial') {
            faceRule = FACE_PARTIAL_FRAGMENT
          }

          const layers = [
            `[CHARACTER: ${dna}]`,
            'highly detailed anime illustration, cel shading, soft cinematic lighting',
            scene,
            sceneHint,
            faceRule,
            'muted color palette, elegant composition, best quality, masterpiece',
            'safe for work, no nudity, no explicit content',
          ].filter((s) => s && s.length > 0)

          imagePrompt = layers.join(', ')
          referenceUrl = undefined
        } else {
          const facePrompt = getCharacterFace(character.archetype, character.gender)
          const clothing = getClothingLevel(level.level)
          const scene = NSFW_SCENE_PROMPTS[level.level] || NSFW_SCENE_PROMPTS[4]
          const archetypeHint =
            ARCHETYPE_IMAGE_HINTS[`${character.gender}_${character.archetype}`] || ''
          const moodFragment = mood ? MOOD_FRAGMENTS[mood] || '' : ''

          const layers = [
            facePrompt,
            'anime style, cel shading, moody atmospheric lighting, deep shadows, muted color palette, cinematic dark tones, detailed anime eyes',
            clothing,
            scene,
            archetypeHint,
            moodFragment,
            sceneHint,
            NO_GENITALIA,
            'beautiful cinematic lighting, 2D illustration, best quality',
          ].filter((s) => s && s.length > 0)

          imagePrompt = layers.join(', ')
          referenceUrl = getCharacterImageUrl(character.archetype, character.gender)
        }

        promptUsed = imagePrompt

        // Generar con IA
        let rawUrl: string
        try {
          rawUrl = await generateImage(imagePrompt, referenceUrl, level.level)
        } catch (imgError) {
          console.error('Image generation error:', imgError)
          return NextResponse.json(
            { error: 'Error al generar la imagen' },
            { status: 500 }
          )
        }

        source = 'generated'
        modelUsed = level.level <= 3 ? 'deepinfra' : 'wiro-v4-5'
        imageUrl = rawUrl

        // ═══════════════════════════════════════════════════════════════
        // ✅ POOL: subir a R2 y guardar en pool (best-effort)
        // ═══════════════════════════════════════════════════════════════
        if (r2Available && !userHint && mood) {
          try {
            const { buffer, contentType } = await downloadImage(rawUrl)
            const r2Key = buildR2Key(character.archetype, genderKey, mood, levelBucket)
            const permanentUrl = await uploadToR2(r2Key, buffer, contentType)

            imageUrl = permanentUrl

            const tagKey = buildTagKey(character.archetype, genderKey, mood, levelBucket)
            await insertPoolImage({
              tag_key: tagKey,
              archetype: character.archetype,
              gender: genderKey,
              mood,
              level_bucket: levelBucket,
              r2_key: r2Key,
              r2_url: permanentUrl,
              prompt_used: imagePrompt,
              first_user_id: tid,
            })

            console.log(`[generate-image] 📤 Subida a R2 + pool: ${tagKey}`)
          } catch (uploadErr) {
            console.warn('[generate-image] R2 upload failed (using temp URL):', uploadErr)
            // Seguimos usando la URL temporal de la IA
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // ✅ FIX PERSISTENCIA: guardar el mensaje de imagen en el chat
    // ═══════════════════════════════════════════════════════════════
    try {
      const imageMessageContent = `*${character.character_name} te envía una foto*\n\n![Selfie](${imageUrl})`
      await insertMessage({
        telegram_id: tid,
        character_id,
        role: 'assistant',
        content: imageMessageContent,
      })
    } catch (persistErr) {
      console.warn('[generate-image] Error guardando mensaje en historial:', persistErr)
      // No bloqueamos la respuesta si falla el guardado
    }

    // ═══════════════════════════════════════════════════════════════
    // COBRAR (solo si no es gratis)
    // ═══════════════════════════════════════════════════════════════
    let newGems = user.gems || 0
    let newPurchasedGems = purchasedGems

    if (!isFree) {
      const rpcData = await decrementGemsAndPurchased(tid, imageCost)
      newGems = rpcData.new_gems
      newPurchasedGems = rpcData.new_purchased

      await insertGemTransaction({
        telegram_id: tid,
        amount: -imageCost,
        transaction_type: 'image',
        description:
          source === 'r2_static'
            ? `Imagen R2 _${r2Index} nivel ${level.level}`
            : source === 'pool'
            ? `Imagen pool nivel ${level.level}`
            : `Imagen generada nivel ${level.level}`,
      })
    }

    return NextResponse.json({
      image_url: imageUrl,
      remaining_gems: newGems,
      remaining_purchased_gems: newPurchasedGems,
      level: level.level,
      cost: isFree ? 0 : imageCost,
      free: isFree,
      source,
      image_index: r2Index,
      face_visibility: faceVisibility,
      model: modelUsed,
    })
  } catch (error: any) {
    console.error('Error generando imagen:', error)
    return NextResponse.json(
      { error: 'Error al generar la imagen' },
      { status: 500 }
    )
  }
}
