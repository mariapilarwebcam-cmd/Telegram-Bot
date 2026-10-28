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
    maxMessages: 4,         // ✅ Súper rápido
    imageCost: 15,         
    audioCost: 10,         
    intensity: 'NORMAL',
    badgeKey: 'levelStranger',
    color: '#8b8b9e',
    clothingLevel: 'casual everyday outfit, fully dressed, cute anime style',
    sceneStyle: 'selfie style, casual daytime environment, soft natural lighting, anime aesthetic',
    faceVisibility: 'hidden',
  },
  {
    level: 2,
    minMessages: 5,
    maxMessages: 14,        // ✅ En 15 mensajes ya sube al 3
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
    minMessages: 15,        // ✅ El usuario llega aquí rapidísimo
    maxMessages: 39,
    imageCost: 30,         
    audioCost: 15,         
    intensity: 'VERY_HIGH',
    badgeKey: 'levelClose',
    color: '#7c5cff',
    clothingLevel: 'provocative outfit, delicate lace lingerie, silk robe slipping off shoulder, minimal but covered, alluring, anime aesthetic',
    sceneStyle: 'seductive pose, dim moody lighting, bedroom or bathroom setting, hint of intimacy, soft shadows on skin, anime aesthetic',
    faceVisibility: 'partial',
  },
  {
    level: 4,
    minMessages: 40,
    maxMessages: 89,
    imageCost: 40,         
    audioCost: 20,         
    intensity: 'MAXIMUM',
    badgeKey: 'levelIntimate',
    color: '#a855f7',
    clothingLevel: 'delicate lace lingerie set, sheer fabric, garter belt, thigh-high stockings, micro bikini, thin straps, highly detailed intimate apparel, glossy skin, shiny thighs, barely covered but strategically covered, anime aesthetic',
    sceneStyle: 'from behind looking back over shoulder, arched back, kneeling on bed, hands on hips, mirror selfie, low angle shot, chiaroscuro lighting, rim lighting, dramatic cinematic lighting, highly detailed skin texture, soft shadows, seductive invitation, anime aesthetic',
    faceVisibility: 'full',
  },
  {
    level: 5,
    minMessages: 90,        // ✅ A los 90 mensajes llega al clímax
    maxMessages: null,
    imageCost: 50,         
    audioCost: 25,         
    intensity: 'ULTRA',
    badgeKey: 'levelSpecial',
    color: '#ec4899',
    clothingLevel: 'strategic placement of silk sheets, micro lingerie, sheer lace bodysuit, wet look, oiled glossy skin, tasteful implied nudity, no exposed genitalia, no visible nipples, extreme teasing, anime aesthetic',
    sceneStyle: 'artistic boudoir composition, tangled sheets, dramatic low-key lighting, neon glow accents, extreme close-up on curves, highly detailed skin, sweat drops, maximum tension, post-intimacy atmosphere, everything suggested nothing shown, anime aesthetic',
    faceVisibility: 'full',
  },
]

// ✅ Hitos de fotos actualizados para que coincidan con la nueva velocidad
export const PHOTO_MILESTONES_EARLY: number[] = [5, 15, 30, 50, 90, 150]
export const PHOTO_MILESTONE_LATE_START = 150

export const PHOTO_MILESTONE_LATE_INTERVAL_TIERS = [
  { fromMessage: 150, toMessage: 300, interval: 30 },
  { fromMessage: 300, toMessage: 600, interval: 40 },
  { fromMessage: 600, toMessage: Infinity, interval: 50 },
]

function getLateInterval(userMsgCount: number): number {
  for (const tier of PHOTO_MILESTONE_LATE_INTERVAL_TIERS) {
    if (userMsgCount >= tier.fromMessage && userMsgCount < tier.toMessage) {
      return tier.interval
    }
  }
  return 50
}

export function isPhotoMilestoneBase(userMsgCount: number): boolean {
  if (PHOTO_MILESTONES_EARLY.includes(userMsgCount)) return true

  if (userMsgCount > PHOTO_MILESTONE_LATE_START) {
    const interval = getLateInterval(userMsgCount)
    return (userMsgCount - PHOTO_MILESTONE_LATE_START) % interval === 0
  }

  return false
}

export function isPhotoMilestone(
  userMsgCount: number,
  hasEnoughGems: boolean = true
): boolean {
  if (!isPhotoMilestoneBase(userMsgCount)) return false

  if (PHOTO_MILESTONES_EARLY.includes(userMsgCount)) return true

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

// ✅ Helper: siguiente nivel con los nuevos límites
export function getNextLevelThreshold(currentLevel: number): number | null {
  switch (currentLevel) {
    case 1: return 5
    case 2: return 15
    case 3: return 40
    case 4: return 90
    default: return null
  }
}
