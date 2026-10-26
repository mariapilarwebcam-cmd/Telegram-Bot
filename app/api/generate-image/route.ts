// app/api/generate-image/route.ts  

import { NextResponse } from 'next/server'
import sharp from 'sharp' 
import crypto from 'node:crypto' 
import {
  ensureUser, getCharacter, countUserMessages, insertGemTransaction,
  getSeenR2Indices, markImageSeen, getAvailablePoolImage, markPoolImageViewed,
  incrementPoolImageUse, insertPoolImage, insertMessage, getActiveSubscription,
  insertImageGeneration,
  incrementGems,
  getSpendState, updateSpendState,
  saveContentTags, getUserTopTags
} from '@/lib/db-queries'
import {
  getCharacterFace, getCharacterImageUrl, VIP_LIMITS, MAX_GENERATIONS_PER_CONTEXT_PER_USER,
} from '@/lib/constants'
import { generateRunwareImage } from '@/lib/runware'
import { getLevelFromMessages, getImageCost, getClothingLevel, getFaceVisibility } from '@/lib/levels'
import { r2Available, uploadToR2, downloadImage, buildR2Key, buildTagKey } from '@/lib/r2-upload'
import { execute, queryOne, query } from '@/lib/turso'

export const maxDuration = 60

// ═══════════════════════════════════════════════════════════════
// CHARACTER DNA
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
  
  // ✅ CYBORG ACTUALIZADA (Basada en tu imagen)
  female_cyborg_assassin: "beautiful female cyborg assassin, short messy white hair, one glowing red robotic eye, black high-tech tactical suit with exposed cleavage, mechanical robotic left arm with glowing cyan lines, holding a futuristic rifle, cyberpunk city background",
  
  female_best_friends_gf: "young woman, long wavy brunette hair, brown eyes, tight summer dress",
  female_best_friends_sister: "adult young woman, long straight black hair, expressive brown eyes, fitted sweater",
  female_foot_fetish_girl: "beautiful woman, long elegant hair, stunning bare feet, red toenails, elegant legs",
  female_psycho: "unsettling beautiful woman, long straight black hair, wide empty dead eyes, innocent creepy smile, elegant white dress",

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
  
  // ✅ INCUBUS ACTUALIZADO (Basado en tu imagen)
  male_incubus_lord: "dangerously handsome male demon lord, long dark hair, glowing red eyes, large black demon horns, large bat wings, sharp fangs, black and red unbuttoned aristocratic shirt showing muscular chest, dark hellish background",
  
  male_best_friends_bf: "athletic man, short dark hair, blue eyes, confident smirk",
  male_best_friends_brother: "tall muscular man, messy hair, dark eyes, protective",
  male_psycho: "dangerously handsome man, elegant dark suit, cold piercing dark eyes, terrifying smirk, black leather gloves",
}

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
  female_cyborg_assassin: 'neon cyberpunk city, glowing cyan mechanical arm, tactical suit, futuristic assassin',
  female_best_friends_gf: 'guilty pleasure, forbidden tension, looking over shoulder, intimate home setting',
  female_best_friends_sister: 'confident and slightly playful smile, adult elegant look, sitting gracefully on a couch',
  female_foot_fetish_girl: 'focus on foreground bare feet, perfect foot anatomy, five distinct toes, clean smooth soles, high arches, perfectly placed painted toenails on toes, delicate gold anklets, dangling heels, elegant legs crossed, foot fetish aesthetic',
  female_psycho: 'obsessive empty stare, innocent creepy smile, holding a smartphone, dimly lit bedroom, eerie tension, dark psychological atmosphere',

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
  male_incubus_lord: 'hellish red glow, dark aristocratic clothes, demonic wings, dominant presence',
  male_best_friends_bf: 'arrogant smirk, leaning against a wall, dominant energy, expensive clothes',
  male_best_friends_brother: 'protective older brother vibe, intense stare, muscular arms crossed',
  male_psycho: 'dominant vibe, slowly loosening his tie or adjusting his black leather gloves, looking down at the viewer with a terrifying calmness, dark luxury penthouse, shadowy lighting, possessive controlling aura',
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

// ✅ PROMPTS SEMI-NSFW (Máximo sugerente, cero explícito)
const NSFW_SCENE_PROMPTS: Record<number, string> = {
  4: `intimate photo, minimal tasteful clothing or elegant lingerie, 
      very revealing but strategically covered at all times, 
      artistic suggestive pose, low intimate lighting, bedroom setting, 
      high-end boudoir aesthetic, magnetic desire in the eyes, 
      parted lips, soft blush, tempting invitation, undeniable chemistry, 
      heat and tension palpable, flushed skin, breathless expression, 
      sensual atmosphere, fabric slipping off one shoulder, 
      sheets loosely draped around body, everything suggested nothing shown, 
      the art of seduction and anticipation, 
      no exposed genitalia, no explicit sexual acts, no full nudity`,

  5: `artistic boudoir photo, tasteful implied coverage with strategic 
      placement of silk sheets and dramatic shadows, 
      elegant artistic angles that conceal and reveal, 
      no exposed genitalia, no explicit sexual acts, no full nudity, 
      high-end artistic composition, dramatic cinematic lighting, 
      peak intimacy and anticipation, longing gaze, magnetic attraction, 
      undeniable chemistry between the subject and the viewer, 
      tangled sheets, glowing skin, post-intimacy atmosphere, 
      sensual silence, maximum suggestion without explicit content, 
      the art of desire, everything suggested nothing shown`,
}

const AUTO_SCENES_FEMALE: Record<number, string> = {
  1: 'relaxed at home in a cozy room, natural soft smile, casual daylight atmosphere, warm and wholesome vibe',
  2: 'lying on her bed, playful flirty look toward the camera, warm intimate lighting, teasing energy',
  3: 'seductive pose in a dimly lit room, elegant lingerie, moody atmosphere, confident inviting gaze',
  4: 'intimate boudoir pose, soft shadows on skin, low warm lighting, private bedroom setting, sensual but tasteful, maximum suggestion without explicit content',
  5: 'artistic intimate composition, cinematic dramatic lighting, elegant and tasteful, high-end boudoir editorial, the art of desire, everything suggested nothing shown',
}

const AUTO_SCENES_MALE: Record<number, string> = {
  1: 'relaxed at home in a cozy room, natural soft smile, casual daylight atmosphere, warm and wholesome vibe',
  2: 'lying on his bed, playful confident look toward the camera, warm intimate lighting, teasing energy',
  3: 'seductive pose in a dimly lit room, half-open shirt, moody atmosphere, intense inviting gaze',
  4: 'intimate boudoir pose, soft shadows on skin, low warm lighting, private bedroom setting, sensual but tasteful, maximum suggestion without explicit content',
  5: 'artistic intimate composition, cinematic dramatic lighting, elegant and tasteful, high-end boudoir editorial, the art of desire, everything suggested nothing shown',
}

// ═══════════════════════════════════════════════════════════════
// 🧠 EL SISTEMA DE APRENDIZAJE DOBLE
// ═══════════════════════════════════════════════════════════════
const STOP_WORDS = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'y', 'o', 'de', 'en', 'que', 'es', 'por', 'para', 'con', 'no', 'si', 'me', 'te', 'se', 'lo', 'mi', 'tu', 'su', 'al', 'del', 'como', 'mas', 'pero'])

function extractTagsFromText(text: string): string[] {
  if (!text) return []
  const words = text.toLowerCase().replace(/[^\w\sáéíóúñ]/g, '').split(/\s+/)
  return Array.from(new Set(words)).filter(w => w.length > 3 && !STOP_WORDS.has(w)).slice(0, 4)
}

async function calculateDynamicHeatScore(messages: string[]): Promise<number> {
  if (!messages || messages.length === 0) return 0
  let score = 0
  const text = messages.join(' ').toLowerCase()
  const baseHotKeywords = /\b(fuego|caliente|excitad|duro|mojado|húmedo|quiero|dame|toca|beso|cama|pasión|pasion|amor|hermosa|preciosa|ahora|ya|rápido|rapido|por favor|más|mas)\b/g
  const matches = text.match(baseHotKeywords)
  if (matches) score += matches.length * 10
  score += (text.match(/!/g) || []).length * 5
  score += (text.match(/\?/g) || []).length * 5
  if (text.length > 50) score += 5
  if (text.length > 150) score += 15
  try {
    const words = text.replace(/[^\w\sáéíóúñ]/g, '').split(/\s+/).filter(w => w.length > 2)
    if (words.length > 0) {
      const placeholders = words.map(() => '?').join(',')
      const triggers = await query<{ weight: number }>(`SELECT weight FROM learned_triggers WHERE word IN (${placeholders})`, words)
      const learnedScore = triggers.reduce((acc, t) => acc + t.weight, 0)
      if (learnedScore > 0) score += learnedScore * 5
    }
  } catch (e) {}
  const hotEmojis = /[🥵😈💦🍆💋❤️🔥]/g
  if (text.match(hotEmojis)) score += text.match(hotEmojis)!.length * 5
  return Math.min(score, 100)
}

async function learnHeatTriggers(messages: string[]) {
  try {
    const text = messages.join(' ').toLowerCase()
    const words = text.replace(/[^\w\sáéíóúñ]/g, '').split(/\s+/)
    const uniqueWords = Array.from(new Set(words)).filter(w => w.length > 2 && !STOP_WORDS.has(w))
    for (const word of uniqueWords) {
      await execute(`INSERT INTO learned_triggers (word, type, weight) VALUES (?, 'heat', 1) ON CONFLICT(word, type) DO UPDATE SET weight = weight + 1`, [word])
    }
  } catch (e) {}
}

function extractMoodFromMessages(messages: string[], heat: number): string {
  if (!messages || messages.length === 0) return ''
  const text = messages.join(' ').toLowerCase()
  if (heat > 65) return 'breathless_passionate' 
  if (/\b(jadeo|jadea|respira|suspiro|temblor|tiembla|calor|fuego|húmedo|mojado|acelerado|entrecortad)\b/.test(text)) return 'breathless_passionate'
  if (/\b(hazme|tuyo|tuya|obedec|pide|por favor|tómame|tomame|entrégate|entregate|soy tu)\b/.test(text)) return 'submission_surrender'
  if (/\b(domin|manda|control|orden|obedece|rodillas|sumiso|sumisa|mía|mio)\b/.test(text)) return 'dominant_commanding'
  if (/\b(beso|lento|despacio|cerca|roza|toca|acaricia|susurr|muerde|labio)\b/.test(text)) return 'sensual_slow_burn'
  if (/\b(provoc|broma|jugueto|desaf|atrev|coqueto|pícara|picara|tentaci)\b/.test(text)) return 'playful_teasing'
  if (/\b(amor|quiero|corazón|corazon|tierno|dulce|abrazo)\b/.test(text)) return 'romantic_tender'
  if (/\b(enfadad|enojad|discutir|discusión|discusion|pelea|pelean|celos|celoso|reclama|grita|gritar|furia|furios)\b/.test(text)) return 'tense_argument'
  if (/\b(triste|llorar|llora|lágrimas|lagrimas|melancol|consuelo|consolar|vulnerab)\b/.test(text)) return 'emotional_vulnerable'
  if (/\b(lluvia|llueve|tormenta|tempestad|chaparrón|chaparro|empapad)\b/.test(text)) return 'rainy_intimate'
  if (/\b(playa|arena|olas|atardecer|surf|bikini|traje de baño|oceano|océano|costa|marea)\b/.test(text)) return 'sunset_beach'
  if (/\b(cama|sábanas|sabanas|almohada|acostad|recostad|dormir|dormida|dormido|descansar|despierta)\b/.test(text)) return 'bedroom_intimacy'
  if (/\b(ducha|bañera|banera|vapor|vaporoso|jabón|jabon|agua caliente|espuma|burbujas)\b/.test(text)) return 'bathroom_steamy'
  if (/\b(cocina|cocinar|cocinando|comida|cena|vino|bebida|desayuno|restaurante)\b/.test(text)) return 'kitchen_intimacy'
  if (/\b(fiesta|baile|bailar|bailando|música|musica|club|discoteca|concierto)\b/.test(text)) return 'nightlife_party'
  if (/\b(gym|gimnasio|entrenar|entrenando|deporte|sudor|sudando|ejercicio|pesas|cardio|correr)\b/.test(text)) return 'post_workout'
  if (/\b(auto|coche|carro|manejar|conducir|viaje|carretera|road trip)\b/.test(text)) return 'car_ride'
  if (/\b(noche|luna|estrellas|oscuridad|medianoche|nocturno|misterio|velas)\b/.test(text)) return 'night_mystery'
  if (/\b(risa|ríe|rie|reír|reir|divertid|juego|jugando|sonrisa|sonríe|sonrie|alegre)\b/.test(text)) return 'playful_laughing'
  return ''
}

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

function buildR2VariantUrl(gender: string, archetype: string, index: number): string {
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL
  if (!base) return ''
  const clean = base.replace(/\/$/, '')
  return `${clean}/${gender}_${archetype}_${index}.jpg?v=8`
}

function getLevelBucket(level: number): 'sfw' | 'nsfw' {
  return level <= 3 ? 'sfw' : 'nsfw'
}

function getContextLimitMessage(lang: 'es' | 'en', characterName: string): string {
  if (lang === 'en') return `*${characterName} smirks and shakes her head*\n\n"Wow, you really love this moment, huh? I think we've already explored this scene enough... let's try something different. Change the mood or the place, and I'll surprise you again."`
  return `*${characterName} sonríe de lado y niega con la cabeza*\n\n"Wow, veo que te encanta este momento, ¿eh? Creo que ya exploramos bastante esta escena... probemos algo diferente. Cambia el mood o el lugar, y te sorprendo otra vez."`
}

// ✅ NUEVA FUNCIÓN: Blur Seguro (24px)
async function makeBlur(buf: Buffer): Promise<Buffer> {
  return sharp(buf)
    .resize(24, 35, { fit: 'cover' })
    .blur(1.2)
    .webp({ quality: 60 })
    .toBuffer()
}

// ✅ NUEVA FUNCIÓN: CONSUMIR TOKEN VIP (Runware)
async function consumeVipPhotoToken(user: any): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000)
  let tokens = user.photo_tokens || 0
  let lastAt = user.photo_tokens_at || now

  // Acumulación: 1 por día, máximo 5
  const daysPassed = Math.floor((now - lastAt) / 86400)
  if (daysPassed > 0) {
    tokens = Math.min(5, tokens + daysPassed)
    lastAt = tokens >= 5 ? now : lastAt + (daysPassed * 86400)
  }

  if (tokens < 1) return false

  await execute(
    `UPDATE users SET photo_tokens = ?, photo_tokens_at = ? WHERE telegram_id = ?`,
    [tokens - 1, lastAt, user.telegram_id]
  )
  
  return true
}

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const character_id = body?.character_id
    const userHint = typeof body?.description === 'string' ? body.description.trim().slice(0, 200) : ''
    const recent_messages: string[] = Array.isArray(body?.recent_messages)
      ? body.recent_messages.filter((m: any) => typeof m === 'string' && m.trim().length > 0).slice(-4)
      : []

    const isDirectRequest = body?.is_direct_request === true
    const isFantasyPass = body?.is_fantasy_pass === true // ✅ NUEVO: Detectar Pase de Fantasía
    const isGiftPhoto = body?.is_gift_photo === true // ✅ NUEVO: Foto de agradecimiento por outfit

    const user = await ensureUser(tid)
    if (!user) return NextResponse.json({ error: 'Error cargando tu cuenta' }, { status: 500 })

    const character = await getCharacter(character_id, tid)
    if (!character) return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })

    const lang: 'es' | 'en' = user.language === 'en' ? 'en' : 'es'
    const userMsgCount = await countUserMessages(tid, character_id)
    let level = getLevelFromMessages(userMsgCount || 0) // Usamos 'let' para poder forzar el nivel 5
    
    if (isFantasyPass) {
      level = getLevelFromMessages(999) // ✅ Forzamos el nivel 5
    }

    const imageCost = getImageCost(level.level)
    const faceVisibility = getFaceVisibility(level.level)

    const vipSub = await getActiveSubscription(tid)
    const isVip = !!vipSub
    const seenIndices = await getSeenR2Indices(tid, character_id)

    // ✅ FRENO DE MANO
    const spendState = await getSpendState(tid)
    if (spendState?.level === 'rest' && !isDirectRequest && !isFantasyPass) {
      return NextResponse.json({ 
        error: 'rest_mode', 
        message: lang === 'es' 
          ? 'Has estado muy activo hoy. Descansa un poco, te esperaré mañana con más energía.' 
          : "You've been very active today. Rest a bit, I'll wait for you tomorrow with more energy." 
      }, { status: 429 })
    }

    let r2Index: number | null = null
    const candidateIndices = level.level <= 3 ? [1, 2] : [1, 3, 4]
    for (const idx of candidateIndices) {
      if (!seenIndices.has(idx)) {
        r2Index = idx
        break
      }
    }

    const genderKey = character.gender === 'male' ? 'male' : 'female'
    const characterKey = `${character.archetype}_${genderKey}`
    const r2Base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL
    const useR2Static = r2Index !== null && !!r2Base && !isFantasyPass // ✅ El pase siempre genera imagen nueva

    let source: 'r2_static' | 'pool' | 'generated' = 'generated'
    let imageUrl: string = ''
    let blurUrl: string = ''
    let modelUsed: string = ''
    let promptUsed = ''
    let imageId: number | null = null
    let fantasyPassId: number | null = null

    // ✅ LÓGICA DEL PASE DE FANTASÍA: Verificar y consumir
    if (isFantasyPass) {
      const pass = await queryOne<{ id: number }>(
        `SELECT id FROM user_inventory WHERE user_id = ? AND item_type = 'fantasy_pass' LIMIT 1`,
        [tid]
      )
      if (!pass) {
        return NextResponse.json({ error: 'No tienes Pases de Fantasía' }, { status: 403 })
      }
      
      // Consumir el pase de forma atómica
      const deleted = await execute(`DELETE FROM user_inventory WHERE id = ?`, [pass.id])
      if (deleted.rowsAffected === 0) {
        return NextResponse.json({ error: 'Error al consumir el pase' }, { status: 500 })
      }
      fantasyPassId = pass.id
    }

    const imgCountRow = await queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM image_generations WHERE telegram_id = ? AND character_id = ?`,
      [tid, character_id]
    )
    const totalImagesSent = imgCountRow?.c || 0

    const heatScore = await calculateDynamicHeatScore(recent_messages)
    
    if (heatScore > 65 && recent_messages.length > 0) {
      await learnHeatTriggers(recent_messages)
    }
    
    let freeChance = 0.15 
    if (heatScore > 60) freeChance = 0.05 
    else if (heatScore < 25 && userMsgCount > 15) freeChance = 0.70 

    let isFree = totalImagesSent === 0 || (totalImagesSent > 0 && Math.random() < freeChance)
    let useVipQuota = false
    let gemsCharged = false

    if (isFantasyPass || isGiftPhoto) {
      // El pase o la foto de regalo anulan cualquier cobro
      isFree = true
      useVipQuota = false
    } else {
      // ✅ LÓGICA VIP: Consumir token si es VIP y no es la primera imagen
      if (isVip && !isFree && !isDirectRequest) {
        const hasToken = await consumeVipPhotoToken(user)
        if (hasToken) {
          useVipQuota = true
        }
      }

      // ✅ LÓGICA DE COBRO (SOLO SI NO ES VIP CON TOKEN NI ES GRATIS)
      if (isDirectRequest && !isFree && !useVipQuota) {
        const charged = await queryOne<{ purchased_gems: number, gems: number }>(
          `UPDATE users SET purchased_gems = purchased_gems - ?, gems = gems - ? WHERE telegram_id = ? AND purchased_gems >= ? RETURNING purchased_gems, gems`,
          [imageCost, imageCost, tid, imageCost]
        )
        
        if (!charged) {
          return NextResponse.json({ error: 'insufficient_gems', message: lang === 'es' ? `Necesitas ${imageCost} gemas compradas.` : `You need ${imageCost} purchased gems.` }, { status: 402 })
        }
        
        gemsCharged = true
        await insertGemTransaction({ telegram_id: tid, amount: -imageCost, transaction_type: 'image', description: `Generación directa nivel ${level.level}` })
        await updateSpendState(tid, imageCost)
        isFree = false 
      } 
      else if (!isDirectRequest && !isFree && !useVipQuota && (user.purchased_gems || 0) < imageCost) {
         return NextResponse.json({ error: 'insufficient_gems', message: `Necesitas ${imageCost} gemas compradas.` }, { status: 402 })
      }
    }

    const mood = extractMoodFromMessages(recent_messages, heatScore)
    const levelBucket = getLevelBucket(level.level)
    const normalizedTagKey = buildTagKey(character.archetype, genderKey, mood || 'default', levelBucket)

    const userTopTags = await getUserTopTags(tid, 3)
    const userTopTagsPrompt = userTopTags.length > 0 ? `user favorite elements: ${userTopTags.join(', ')}` : ''

    if (useR2Static) {
      source = 'r2_static'
      imageUrl = buildR2VariantUrl(genderKey, character.archetype, r2Index!)
      blurUrl = imageUrl 
      modelUsed = 'r2'
      try { await markImageSeen(tid, character_id, r2Index!, false) } catch (markErr) {}
    } else {
      let poolHit = false
      const usePool = !userHint && !!mood && r2Available && !isFantasyPass && !isGiftPhoto // El pase o regalo no usan el pool

      if (usePool) {
        try {
          const available = await getAvailablePoolImage(normalizedTagKey, tid)
          if (available) {
            imageUrl = available.r2_key
            blurUrl = available.blur_r2_key || available.r2_key
            imageId = available.id
            source = 'pool'
            modelUsed = 'pool'
            promptUsed = available.prompt_used
            poolHit = true
            await markPoolImageViewed(available.id, tid, character_id)
            incrementPoolImageUse(available.id).catch(() => {})
          }
        } catch (poolErr) {}
      }

      if (!poolHit) {
        source = 'generated'
        
        const reservation = await execute(
          `INSERT INTO image_generations (telegram_id, character_id, tag_key, model, level)
           SELECT ?, ?, ?, 'runware', ?
           WHERE (
             SELECT COUNT(*) FROM image_generations
             WHERE telegram_id = ? AND tag_key = ? AND created_at >= datetime('now', '-30 days')
           ) < ?`,
          [tid, character_id, normalizedTagKey, level.level, tid, normalizedTagKey, MAX_GENERATIONS_PER_CONTEXT_PER_USER]
        )

        if (reservation.rowsAffected === 0) {
          if (gemsCharged) {
            await incrementGems(tid, imageCost)
            await insertGemTransaction({ telegram_id: tid, amount: imageCost, transaction_type: 'refund', description: 'Reembolso por límite de contexto' })
          }
          return NextResponse.json({ error: 'context_limit_reached', message: getContextLimitMessage(lang, character.character_name) }, { status: 429 })
        }

        const generationId = Number(reservation.lastInsertRowid)

        const autoScenes = character.gender === 'male' ? AUTO_SCENES_MALE : AUTO_SCENES_FEMALE
        const sceneHint = userHint || autoScenes[level.level] || autoScenes[1]
        const NO_GENITALIA = 'tasteful artistic composition, no explicit genitalia, no nudity visible below waist, strategic coverage, high-end boudoir photography aesthetic, safe for platform'

        let imagePrompt: string
        const genderTag = character.gender === 'male' ? '1boy, male' : '1girl, female'
        const QUALITY_CONTROL_PROMPT = `(masterpiece, best quality, highres:1.2), solo, single character, ${genderTag}, only one person in frame, perfect anatomy, perfect hands, five fingers, correct proportions, no mutations, no extra limbs, no missing limbs, no multiple people, no deformed hands, no extra fingers, perfectly sized hands, correct hand size, hand in mid-ground, no giant hands touching the lens, natural pose`

        // ✅ NUEVO: Inyectar Outfit si el personaje tiene uno equipado
        let outfitPrompt = ''
        if (character.equipped_outfit) {
          const outfitData = await queryOne<{ prompt_tag: string }>(
            `SELECT prompt_tag FROM gacha_outfits WHERE id = ?`,
            [character.equipped_outfit]
          )
          if (outfitData) {
            // ✅ FIX: Evitamos duplicar la palabra "wearing"
            outfitPrompt = `${outfitData.prompt_tag}, `
          }
        }

        if (level.level <= 3) {
          const dna = CHARACTER_DNA[`${character.gender}_${character.archetype}`] || 'anime character'
          const scene = SFW_SCENE_PROMPTS[level.level] || SFW_SCENE_PROMPTS[1]
          let faceRule = ''
          if (faceVisibility === 'hidden') faceRule = FACE_HIDDEN_FRAGMENT
          else if (faceVisibility === 'partial') faceRule = FACE_PARTIAL_FRAGMENT
          imagePrompt = [QUALITY_CONTROL_PROMPT, outfitPrompt, `[CHARACTER: ${dna}]`, 'highly detailed anime illustration, cel shading, soft cinematic lighting', scene, sceneHint, faceRule, userTopTagsPrompt, 'muted color palette, elegant composition, best quality, masterpiece', 'safe for work, no nudity, no explicit content'].filter((s) => s && s.length > 0).join(', ')
        } else {
          const facePrompt = getCharacterFace(character.archetype, character.gender)
          const clothing = getClothingLevel(level.level)
          const scene = NSFW_SCENE_PROMPTS[level.level] || NSFW_SCENE_PROMPTS[4]
          const archetypeHint = ARCHETYPE_IMAGE_HINTS[`${character.gender}_${character.archetype}`] || ''
          const moodFragment = mood ? MOOD_FRAGMENTS[mood] || '' : ''
          
          // ✅ PROMPT ESPECIAL PARA EL PASE DE FANTASÍA O FOTO DE REGALO
          const fantasyPrefix = isFantasyPass 
            ? 'ultra rare secret intimate moment, highly exclusive fantasy scene, ultimate seduction, peak desire, cinematic masterpiece, ' 
            : isGiftPhoto 
              ? 'thankful expression, showing off new clothes, exclusive gift, ' 
              : ''

          imagePrompt = [QUALITY_CONTROL_PROMPT, fantasyPrefix, outfitPrompt, facePrompt, 'anime style, cel shading, moody atmospheric lighting, deep shadows, muted color palette, cinematic dark tones, detailed anime eyes', clothing, scene, archetypeHint, moodFragment, sceneHint, userTopTagsPrompt, NO_GENITALIA, 'beautiful cinematic lighting, 2D illustration, best quality'].filter((s) => s && s.length > 0).join(', ')
        }

        promptUsed = imagePrompt
        const seedUrl = getCharacterImageUrl(character.archetype, character.gender)
        let rawUrl: string
        try {
          rawUrl = await generateRunwareImage(imagePrompt, seedUrl, level.level)
        } catch (imgError) {
          await execute(`DELETE FROM image_generations WHERE id = ?`, [generationId])
          if (gemsCharged) {
            await incrementGems(tid, imageCost)
            await insertGemTransaction({ telegram_id: tid, amount: imageCost, transaction_type: 'refund', description: 'Reembolso por fallo en generación' })
          }
          
          // ✅ FIX: Reembolsar el token VIP si se consumió
          if (useVipQuota) {
            await execute(`UPDATE users SET photo_tokens = photo_tokens + 1 WHERE telegram_id = ?`, [tid])
          }

          // ✅ Si falla, devolvemos el Pase de Fantasía
          if (isFantasyPass && fantasyPassId) {
            await execute(`INSERT INTO user_inventory (user_id, item_type, item_key) VALUES (?, 'fantasy_pass', 'level_5')`, [tid])
          }
          return NextResponse.json({ error: 'Error al generar la imagen' }, { status: 500 })
        }

        modelUsed = 'runware-z-image-turbo'
        
        // ✅ CREACIÓN DEL BLUR Y GUARDADO EN R2
        const { buffer } = await downloadImage(rawUrl)
        const blurBuffer = await makeBlur(buffer)
        
        const key = crypto.randomUUID()
        const origKey = `orig/${key}.webp`
        const blurKey = `blur/${key}.webp`
        
        await Promise.all([
          uploadToR2(origKey, buffer, 'image/webp'),
          uploadToR2(blurKey, blurBuffer, 'image/webp')
        ])
        
        imageUrl = origKey
        blurUrl = blurKey

        // Guardar en generated_images
        const ins = await execute(
          `INSERT INTO generated_images (r2_key, blur_r2_key, character_key, max_level, status) VALUES (?, ?, ?, ?, 'candidate')`,
          [origKey, blurKey, characterKey, level.level]
        )
        imageId = Number(ins.lastInsertRowid)
      }
    }

    let newGems = user.gems || 0
    let newPurchasedGems = user.purchased_gems || 0
    
    // ✅ LÓGICA DE OFERTA (photo_offers)
    let offerId: number | null = null
    let publicBlurUrl = ''

    if (isDirectRequest || isFantasyPass || isGiftPhoto) {
      if (gemsCharged) {
        newGems -= imageCost
        newPurchasedGems -= imageCost
      }
      // Si es pase o regalo, no creamos oferta, se muestra nítida directamente
    } else {
      const offerPrice = isFree || useVipQuota ? 0 : imageCost
      const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || ''
      publicBlurUrl = `${base.replace(/\/$/, '')}/${blurUrl}`

      // Insertamos la oferta
      await execute(
        `INSERT OR IGNORE INTO photo_offers (user_id, image_id, character_id, price_gems, source) VALUES (?, ?, ?, ?, ?)`,
        [tid, imageId, character_id, offerPrice, source]
      )
      
      const offer = await queryOne<{ id: number }>(
        `SELECT id FROM photo_offers WHERE user_id = ? AND image_id = ?`,
        [tid, imageId]
      )
      offerId = offer!.id

      // Si es gratis o VIP, se desbloquea automáticamente
      if (offerPrice === 0) {
        await execute(`UPDATE photo_offers SET state = 'unlocked', unlocked_at = unixepoch() WHERE id = ?`, [offerId])
        await execute(`UPDATE generated_images SET status = 'active' WHERE id = ?`, [imageId])
      }
    }

    if (source !== 'generated') {
      await insertImageGeneration({ telegram_id: tid, character_id, tag_key: normalizedTagKey, model: source === 'r2_static' ? 'r2' : 'pool', level: level.level })
    }

    let insertedMsgId: number | undefined
    try {
      const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL || ''
      const fullOrigUrl = `${base.replace(/\/$/, '')}/${imageUrl}`
      
      // ✅ FORMATO DE MENSAJE: locked:ID@URL_BLUR
      const imageMessageContent = (offerId && !isDirectRequest && !isFantasyPass && !isGiftPhoto)
        ? `*${character.character_name} te envía una foto*\n\n![Selfie](locked:${offerId}@${publicBlurUrl})`
        : `*${character.character_name} te envía una foto*\n\n![Selfie](${fullOrigUrl})`

      const inserted = await insertMessage({ telegram_id: tid, character_id, role: 'assistant', content: imageMessageContent })
      insertedMsgId = inserted?.id
    } catch (persistErr) {}

    // ✅ GUARDAR ETIQUETAS PARA RECOMENDACIONES
    if (imageId) {
      const autoTags = [
        ...extractTagsFromText(userHint),
        mood,
        levelBucket,
        character.archetype
      ].filter(Boolean) as string[]
      
      if (autoTags.length > 0) {
        await saveContentTags(imageId, autoTags)
      }
    }

    return NextResponse.json({
      is_locked: !!offerId && !isDirectRequest && !isFantasyPass && !isGiftPhoto,
      offer_id: offerId,
      blur_url: (offerId && !isDirectRequest) ? publicBlurUrl : undefined,
      image_url: (!offerId || isDirectRequest || isFantasyPass || isGiftPhoto) ? `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL?.replace(/\/$/, '')}/${imageUrl}` : undefined,
      remaining_gems: newGems, 
      remaining_purchased_gems: newPurchasedGems,
      level: level.level,
      cost: gemsCharged ? imageCost : 0, 
      free: isFree,
      vip_quota: useVipQuota,
      fantasy_pass_used: isFantasyPass, // ✅ Indicamos que se usó
      gift_photo_used: isGiftPhoto, // ✅ Indicamos que fue regalo
      source,
      image_index: r2Index,
      face_visibility: faceVisibility,
      model: modelUsed,
      heat_score: heatScore,
      message_id: insertedMsgId,
    })
  } catch (error: any) {
    console.error('[generate-image] error:', error)
    return NextResponse.json({ error: 'Error al generar la imagen' }, { status: 500 })
  }
}
