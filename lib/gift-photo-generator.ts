import { getCharacterImageUrl } from '@/lib/constants'
import { GiftError } from '@/lib/gift-events'
import type { Artifact, Context } from '@/lib/gift-events'
import type { ImageProvider } from '@/lib/image-provider'
import { storeGeneratedImage } from '@/lib/image-storage'
import { createOperationBudget } from '@/lib/operation-budget'

// Backend composition only. Never select a provider from an HTTP payload.
export function createGiftPhotoGenerator(
  provider: ImageProvider,
  options?: { deadlineAt: number; signal: AbortSignal }
) {
  return async function generateGiftPhoto(
    context: Context
  ): Promise<Artifact> {
    if (process.env.GIFT_EVENTS_ENABLED !== 'true') {
      throw new GiftError('gift_events_disabled')
    }

    const referenceImageUrl = getCharacterImageUrl(
      context.archetype,
      context.gender
    )

    if (!referenceImageUrl) {
      throw new GiftError('gift_photo_reference_unavailable')
    }

    const level = 1
    const genderTag = context.gender === 'male'
      ? '1boy, male'
      : '1girl, female'

    const prompt = [
      'high quality anime illustration, solo, single character',
      genderTag,
      'same character as the reference image, consistent face and hair',
      'fully clothed, showing the gifted outfit, thankful expression',
      context.outfitPrompt,
      'natural pose, soft lighting, safe for work, no nudity, no explicit content',
    ].join(', ')

    const generated = await provider.generate({
      prompt,
      referenceImageUrl,
      level,
    })

    if (!/^https:\/\/[^\s)]+$/.test(generated.imageUrl)) {
      throw new GiftError('gift_photo_invalid_provider_url')
    }

    const stored = await (async () => {
      if (!options) return storeGeneratedImage(generated.imageUrl)
      const storage = createOperationBudget(
        Math.min(options.deadlineAt, Date.now() + 30_000),
        options.signal
      )
      try {
        storage.check()
        const result = await storeGeneratedImage(generated.imageUrl, storage.signal)
        storage.check()
        return result
      } finally {
        storage.dispose()
      }
    })()

    return {
      r2Key: stored.r2Key,
      blurR2Key: stored.blurR2Key,
      imageUrl: stored.imageUrl,
      promptUsed: prompt,
      level,
    }
  }
}