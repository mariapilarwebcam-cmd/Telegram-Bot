// lib/levels.ts

export type Intensity = 'NORMAL' | 'HIGH' | 'VERY_HIGH' | 'MAXIMUM' | 'ULTRA'

export type FaceVisibility = 'hidden' | 'partial' | 'full'

export interface LevelConfig {
  level: number
  minMessages: number
  maxMessages: number | null
  imageCost: number
  audioCost: number
  intensity: Intensity
  badgeKey: string
  color: string
  clothingLevel: string
  sceneStyle: string
  // ✅ NUEVO: controla si la cara se muestra en las imágenes
  faceVisibility: FaceVisibility
}

export const LEVELS: LevelConfig[] = [
  {
    level: 1,
    minMessages: 0,
    maxMessages: 14,
    imageCost: 15,        // SFW, DeepInfra barato
    audioCost: 5,
    intensity: 'NORMAL',
    badgeKey: 'levelStranger',
    color: '#8b8b9e',
    clothingLevel: 'casual everyday outfit, fully dressed, cute anime style',
    sceneStyle: 'selfie style, casual daytime environment, soft natural lighting, anime aesthetic',
    faceVisibility: 'hidden',   // 🔒 sin cara
  },
  {
    level: 2,
    minMessages: 15,
    maxMessages: 39,
    imageCost: 20,        // SFW, DeepInfra
    audioCost: 10,
    intensity: 'HIGH',
    badgeKey: 'levelFriend',
    color: '#22c55e',
    clothingLevel: 'slightly revealing outfit, subtle cleavage, suggestive pose, anime aesthetic',
    sceneStyle: 'bedroom setting, warm cozy lighting, flirty expression, anime aesthetic',
    faceVisibility: 'hidden',   // 🔒 sin cara
  },
  {
    level: 3,
    minMessages: 40,
    maxMessages: 89,
    imageCost: 30,        // SFW provocativo, DeepInfra
    audioCost: 15,
    intensity: 'VERY_HIGH',
    badgeKey: 'levelClose',
    color: '#7c5cff',
    clothingLevel: 'provocative outfit, lingerie, minimal coverage, anime aesthetic',
    sceneStyle: 'seductive pose, dim moody lighting, bedroom or bathroom, anime aesthetic',
    faceVisibility: 'partial',  // 👁️ parcial (perfil, sombra)
  },
  {
    level: 4,
    minMessages: 90,
    maxMessages: 179,
    imageCost: 75,        // ⬆️ subido: cubre coste Wiro + margen
    audioCost: 20,
    intensity: 'MAXIMUM',
    badgeKey: 'levelIntimate',
    color: '#a855f7',
    clothingLevel: 'minimal clothing, lingerie or swimwear, very revealing, anime aesthetic',
    sceneStyle: 'explicit suggestive pose, low intimate lighting, bedroom setting, anime aesthetic',
    faceVisibility: 'full',     // ✅ cara completa (usa reference Wiro)
  },
  {
    level: 5,
    minMessages: 180,
    maxMessages: null,
    imageCost: 120,       // ⬆️ subido: cubre coste Wiro + margen
    audioCost: 25,
    intensity: 'ULTRA',
    badgeKey: 'levelSpecial',
    color: '#ec4899',
    clothingLevel: 'extremely revealing or tasteful implied nudity, artistic, anime aesthetic',
    sceneStyle: 'highly explicit artistic composition, dramatic cinematic lighting, intimate, anime aesthetic',
    faceVisibility: 'full',     // ✅ cara completa
  },
]

// ✅ NUEVO: hitos de mensajes donde la IA ofrece enviar una foto
export const PHOTO_MILESTONES = [5, 15, 30, 50, 80, 120, 180, 250]

export function isPhotoMilestone(userMsgCount: number): boolean {
  return PHOTO_MILESTONES.includes(userMsgCount)
}

export function getNextPhotoMilestone(userMsgCount: number): number | null {
  const next = PHOTO_MILESTONES.find((m) => m > userMsgCount)
  return next ?? null
}

export function getLevelFromMessages(messageCount: number): LevelConfig {
  let current = LEVELS[0]
  for (const lvl of LEVELS) {
    if (messageCount >= lvl.minMessages) current = lvl
  }
  return current
}

export function getImageCost(level: number): number {
  return LEVELS.find((l) => l.level === level)?.imageCost ?? LEVELS[0].imageCost
}

export function getAudioCost(level: number): number {
  return LEVELS.find((l) => l.level === level)?.audioCost ?? LEVELS[0].audioCost
}

export function getIntensityFromLevel(level: number): Intensity {
  return LEVELS.find((l) => l.level === level)?.intensity ?? 'NORMAL'
}

export function getClothingLevel(level: number): string {
  return LEVELS.find((l) => l.level === level)?.clothingLevel ?? LEVELS[0].clothingLevel
}

export function getSceneStyle(level: number): string {
  return LEVELS.find((l) => l.level === level)?.sceneStyle ?? LEVELS[0].sceneStyle
}

export function getFaceVisibility(level: number): FaceVisibility {
  return LEVELS.find((l) => l.level === level)?.faceVisibility ?? 'hidden'
}
