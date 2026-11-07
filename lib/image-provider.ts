// Backend contract: no database, storage or provider-specific options.
export type ImageGenerationRequest = Readonly<{
  prompt: string
  referenceImageUrl: string
  level: number
}>

export interface ImageProvider {
  generate(request: ImageGenerationRequest): Promise<{
    imageUrl: string
  }>
}