import type { ImageProvider } from '@/lib/image-provider'
import { generateWiroImage } from '@/lib/wiro'
import type { WiroImageOptions } from '@/lib/wiro'

export const wiroImageProvider: ImageProvider = {
  async generate(request) {
    const imageUrl = await generateWiroImage(
      request.prompt,
      request.referenceImageUrl,
      request.level
    )

    return { imageUrl }
  },
}

export function createWiroImageProvider(options: WiroImageOptions): ImageProvider {
  return {
    async generate(request) {
      const imageUrl = await generateWiroImage(
        request.prompt,
        request.referenceImageUrl,
        request.level,
        options
      )
      return { imageUrl }
    },
  }
}