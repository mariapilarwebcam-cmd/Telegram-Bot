// Explicit product-approved catalog. Unknown IDs never inherit compatibility from a prefix.
export const OUTFIT_GENDERS = Object.freeze({
  outfit_school: 'female',
  outfit_maid_sexy: 'female',
  outfit_police: 'female',
  outfit_bunny: 'female',
  outfit_red_lace: 'female',
  outfit_sheer_white: 'female',
  outfit_corset_red: 'female',
  outfit_black_leather: 'female',
  outfit_cyber_armor: 'female',
  outfit_latex_black: 'female',
  outfit_nurse: 'female',
  outfit_male_firefighter: 'male',
  outfit_male_dancer: 'male',
  outfit_male_pirate: 'male',
  outfit_male_gladiator: 'male',
  outfit_male_towel: 'male',
} as const)

export function getOutfitCompatibilityError(outfitKey: unknown, characterGender: unknown):
  'outfit_unknown' | 'outfit_gender_incompatible' | null {
  if (typeof outfitKey !== 'string' || !Object.prototype.hasOwnProperty.call(OUTFIT_GENDERS, outfitKey)) {
    return 'outfit_unknown'
  }
  return OUTFIT_GENDERS[outfitKey as keyof typeof OUTFIT_GENDERS] === characterGender
    ? null : 'outfit_gender_incompatible'
}

// Keep the URL convention already used by the gacha showcase.
export function getItemImageUrl(itemId: string, base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL): string {
  if (!base) return ''
  const cleanBase = base.replace(/\/$/, '')
  const folder = cleanBase.endsWith('/item') || cleanBase.endsWith('/items') ? '' : '/item'
  return `${cleanBase}${folder}/${itemId}.jpg`
}

export interface OutfitUnit {
  id: number
  item_key: string
}

export interface OutfitCatalogItem {
  id: string
  name: string
}

export interface OutfitStack {
  item_key: string
  quantity: number
}

// Every input row represents one currently consumable unit, not character ownership.
export function groupOutfitInventory(units: OutfitUnit[]): OutfitStack[] {
  const stacks = new Map<string, OutfitStack>()
  for (const unit of units) {
    const stack = stacks.get(unit.item_key)
    if (stack) stack.quantity++
    else stacks.set(unit.item_key, { item_key: unit.item_key, quantity: 1 })
  }
  return Array.from(stacks.values())
}

export function getOutfitName(key: string, catalog: OutfitCatalogItem[]): string {
  return catalog.find(item => item.id === key)?.name || key.replace(/^outfit_/, '').replace(/_/g, ' ')
}