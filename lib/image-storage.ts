// Shared backend storage pipeline. No database writes or provider generation.
import sharp from 'sharp'
import crypto from 'node:crypto'
import { downloadImage, uploadToR2 } from '@/lib/r2-upload'

export async function storeGeneratedImage(rawUrl: string, signal?: AbortSignal): Promise<{
  r2Key: string
  blurR2Key: string
  imageUrl: string
}> {
  signal?.throwIfAborted()
  const { buffer } = signal ? await downloadImage(rawUrl, signal) : await downloadImage(rawUrl)
  signal?.throwIfAborted()
  const blurBuffer = await sharp(buffer)
    .resize(24, 35, { fit: 'cover' })
    .blur(1.2)
    .webp({ quality: 60 })
    .toBuffer()
  signal?.throwIfAborted()

  const key = crypto.randomUUID()
  const r2Key = `orig/${key}.webp`
  const blurR2Key = `blur/${key}.webp`

  if (signal) {
    // Both uploads share one deadline; settle both before returning a failure.
    const uploads = await Promise.allSettled([
      uploadToR2(r2Key, buffer, 'image/webp', signal),
      uploadToR2(blurR2Key, blurBuffer, 'image/webp', signal),
    ])
    const failed = uploads.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
    if (failed) throw failed.reason
    signal.throwIfAborted()
  } else {
    await Promise.all([
      uploadToR2(r2Key, buffer, 'image/webp'),
      uploadToR2(blurR2Key, blurBuffer, 'image/webp'),
    ])
  }

  const r2BaseUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL?.replace(/\/$/, '') || ''
  return {
    r2Key,
    blurR2Key,
    imageUrl: `${r2BaseUrl}/${r2Key}`,
  }
}