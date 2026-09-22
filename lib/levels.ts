// lib/levels.ts

export type Intensity = 'NORMAL' | 'HIGH' | 'VERY_HIGH' | 'MAXIMUM' | 'ULTRA'

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
  },
  {
    level: 4,
    minMessages: 90,
    maxMessages: 179,
    imageCost: 40,
    audioCost: 20,
    intensity: 'MAXIMUM',
    badgeKey: 'levelIntimate',
    color: '#a855f7',
    clothingLevel: 'minimal clothing, lingerie or swimwear, very revealing, anime aesthetic',
    sceneStyle: 'explicit suggestive pose, low intimate lighting, bedroom setting, anime aesthetic',
  },
  {
    level: 5,
    minMessages: 180,
    maxMessages: null,
    imageCost: 55,
    audioCost: 25,
    intensity: 'ULTRA',
    badgeKey: 'levelSpecial',
    color: '#ec4899',
    clothingLevel: 'extremely revealing or tasteful implied nudity, artistic, anime aesthetic',
    sceneStyle: 'highly explicit artistic composition, dramatic cinematic lighting, intimate, anime aesthetic',
  },
]

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