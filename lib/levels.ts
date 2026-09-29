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
  faceVisibility: FaceVisibility
}

export const LEVELS: LevelConfig[] = [
  {
    level: 1,
    minMessages: 0,
    maxMessages: 14,
    imageCost: 15,
    audioCost: 5,
    intensity: 'NORMAL',
    badgeKey: 'levelStranger',
    color: '#8b8b9e',
    clothingLevel: 'casual everyday outfit, fully dressed, cute anime style',
    sceneStyle: 'selfie style, casual daytime environment, soft natural lighting, anime aesthetic',
    faceVisibility: 'hidden',
  },
  {
    level: 2,
    minMessages: 15,
    maxMessages: 39,
    imageCost: 20,
    audioCost: 10,
    intensity: 'HIGH',
    badgeKey: 'levelFriend',
    color: '#22c55e',
    clothingLevel: 'slightly revealing outfit, subtle cleavage, suggestive pose, anime aesthetic',
    sceneStyle: 'bedroom setting, warm cozy lighting, flirty expression, anime aesthetic',
    faceVisibility: 'hidden',
  },
  {
    level: 3,
    minMessages: 40,
    maxMessages: 89,
    imageCost: 30,
    audioCost: 15,
    intensity: 'VERY_HIGH',
    badgeKey: 'levelClose',
    color: '#7c5cff',
    clothingLevel: 'provocative outfit, lingerie, minimal coverage, anime aesthetic',
    sceneStyle: 'seductive pose, dim moody lighting, bedroom or bathroom, anime aesthetic',
    faceVisibility: 'partial',
  },
  {
    level: 4,
    minMessages: 90,
    maxMessages: 179,
    imageCost: 75,
    audioCost: 20,
    intensity: 'MAXIMUM',
    badgeKey: 'levelIntimate',
    color: '#a855f7',
    clothingLevel: 'minimal clothing, lingerie or swimwear, very revealing, anime aesthetic',
    sceneStyle: 'explicit suggestive pose, low intimate lighting, bedroom setting, anime aesthetic',
    faceVisibility: 'full',
  },
  {
    level: 5,
    minMessages: 180,
    maxMessages: null,
    imageCost: 120,
    audioCost: 25,
    intensity: 'ULTRA',
    badgeKey: 'levelSpecial',
    color: '#ec4899',
    clothingLevel: 'extremely revealing or tasteful implied nudity, artistic, anime aesthetic',
    sceneStyle: 'highly explicit artistic composition, dramatic cinematic lighting, intimate, anime aesthetic',
    faceVisibility: 'full',
  },
]

// ============================================================
// ✅ HITOS DE FOTO — Sistema adaptativo
// ────────────────────────────────────────────────────────────
// Fase temprana: siempre muestra el banner (enganche)
// Fase tardía: intervalos crecientes 50 / 60 / 70
// Adaptativo: en hitos tardíos solo se muestra si el usuario
//             tiene gemas suficientes (evita frustración)
// ============================================================

export const PHOTO_MILESTONES_EARLY: number[] = [10, 20, 35, 55, 80, 120, 180, 250]

export const PHOTO_MILESTONE_LATE_START = 250

export const PHOTO_MILESTONE_LATE_INTERVAL_TIERS = [
  { fromMessage: 250, toMessage: 400, interval: 50 },
  { fromMessage: 400, toMessage: 700, interval: 60 },
  { fromMessage: 700, toMessage: Infinity, interval: 70 },
]

function getLateInterval(userMsgCount: number): number {
  for (const tier of PHOTO_MILESTONE_LATE_INTERVAL_TIERS) {
    if (userMsgCount >= tier.fromMessage && userMsgCount < tier.toMessage) {
      return tier.interval
    }
  }
  return 70
}

/**
 * ¿Es un hito (independiente de las gemas del usuario)?
 */
export function isPhotoMilestoneBase(userMsgCount: number): boolean {
  if (PHOTO_MILESTONES_EARLY.includes(userMsgCount)) return true

  if (userMsgCount > PHOTO_MILESTONE_LATE_START) {
    const interval = getLateInterval(userMsgCount)
    return (userMsgCount - PHOTO_MILESTONE_LATE_START) % interval === 0
  }

  return false
}

/**
 * ¿Debe mostrarse el banner ahora?
 *
 * Reglas adaptativas:
 * - Hitos tempranos → SIEMPRE (fase de enganche)
 * - Hitos tardíos   → solo si el usuario tiene gemas suficientes
 *                     (evita mostrar banners frustrantes a usuarios broke)
 */
export function isPhotoMilestone(
  userMsgCount: number,
  hasEnoughGems: boolean = true
): boolean {
  if (!isPhotoMilestoneBase(userMsgCount)) return false

  // Hitos tempranos: siempre
  if (PHOTO_MILESTONES_EARLY.includes(userMsgCount)) return true

  // Hitos tardíos: solo si tiene gemas
  return hasEnoughGems
}

export function getNextPhotoMilestone(userMsgCount: number): number | null {
  const nextEarly = PHOTO_MILESTONES_EARLY.find((m) => m > userMsgCount)
  if (nextEarly !== undefined) return nextEarly

  if (userMsgCount >= PHOTO_MILESTONE_LATE_START) {
    const interval = getLateInterval(userMsgCount)
    const rem = (userMsgCount - PHOTO_MILESTONE_LATE_START) % interval
    if (rem === 0) return userMsgCount + interval
    return userMsgCount + (interval - rem)
  }

  return null
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
