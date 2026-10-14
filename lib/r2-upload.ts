// lib/r2-upload.ts
// Helper para subir imágenes a Cloudflare R2 desde el backend.
// Usa la API S3-compatible de Cloudflare.

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

// ═══════════════════════════════════════════════════════════════
// Configuración desde env vars
// ═══════════════════════════════════════════════════════════════
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME
const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL

// ✅ Flag exportado: permite saber si R2 uploads están disponibles
export const r2Available = !!(
  R2_ACCOUNT_ID &&
  R2_ACCESS_KEY_ID &&
  R2_SECRET_ACCESS_KEY &&
  R2_BUCKET_NAME &&
  R2_PUBLIC_URL
)

if (!r2Available) {
  console.warn(
    '[r2-upload] ⚠️ Faltan credenciales R2. Los uploads al pool estarán deshabilitados.\n' +
    'Variables requeridas: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, NEXT_PUBLIC_R2_PUBLIC_URL'
  )
}

// ═══════════════════════════════════════════════════════════════
// Cliente S3 compatible con R2
// ═══════════════════════════════════════════════════════════════
const s3 = r2Available
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID!,
        secretAccessKey: R2_SECRET_ACCESS_KEY!,
      },
    })
  : null

// ═══════════════════════════════════════════════════════════════
// Subir buffer a R2
// ═══════════════════════════════════════════════════════════════
export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array,
  contentType = 'image/jpeg'
): Promise<string> {
  if (!s3 || !R2_BUCKET_NAME || !R2_PUBLIC_URL) {
    throw new Error('R2 no configurado')
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    })
  )

  const cleanBase = R2_PUBLIC_URL.replace(/\/$/, '')
  return `${cleanBase}/${key}`
}

// ═══════════════════════════════════════════════════════════════
// Descargar imagen desde una URL (para pasar a R2)
// ═══════════════════════════════════════════════════════════════
export async function downloadImage(url: string): Promise<{
  buffer: Buffer
  contentType: string
}> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status}`)
  }

  const arrayBuffer = await res.arrayBuffer()
  const contentType = res.headers.get('content-type') || 'image/jpeg'
  return { buffer: Buffer.from(arrayBuffer), contentType }
}

// ═══════════════════════════════════════════════════════════════
// Genera el key único para guardar en R2
// Formato: generated/{archetype}_{gender}_{mood}_{bucket}_{timestamp}.jpg
// ═══════════════════════════════════════════════════════════════
export function buildR2Key(
  archetype: string,
  gender: string,
  mood: string,
  levelBucket: string
): string {
  // Limpiar: solo caracteres seguros para nombre de archivo
  const safe = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40)

  const parts = [
    safe(archetype),
    safe(gender),
    safe(mood || 'default'),
    safe(levelBucket),
    Date.now(),
  ].filter(Boolean)

  return `generated/${parts.join('_')}.jpg`
}

// ═══════════════════════════════════════════════════════════════
// Genera el tag_key único para el pool (sin timestamp)
// Formato: {archetype}_{gender}_{mood}_{bucket}
// ═══════════════════════════════════════════════════════════════
export function buildTagKey(
  archetype: string,
  gender: string,
  mood: string,
  levelBucket: string
): string {
  const safe = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40)

  return [safe(archetype), safe(gender), safe(mood || 'default'), safe(levelBucket)]
    .filter(Boolean)
    .join('_')
}