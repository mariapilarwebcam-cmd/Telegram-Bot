// lib/validate-telegram.ts
// Validación de initData de Telegram compatible con Edge Runtime
// Usa Web Crypto API nativa (crypto.subtle) — sin dependencias de Node.js

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN

if (!BOT_TOKEN) {
  throw new Error('❌ FATAL: Falta TELEGRAM_BOT_TOKEN')
}

// ── Helpers HMAC ─────────────────────────────────────────────
async function hmacSha256(
  key: BufferSource,
  data: string
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── Tipos ────────────────────────────────────────────────────
export interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
  is_premium?: boolean
  photo_url?: string
}

export interface ValidatedInitData {
  user: TelegramUser
  authDate: Date
  queryId?: string
}

// ── Validador principal ──────────────────────────────────────
/**
 * Valida el initData crudo de Telegram usando HMAC-SHA256.
 * Lanza Error si la firma es inválida o el auth_date expiró.
 *
 * @param initData - String crudo (window.Telegram.WebApp.initData)
 * @param maxAgeSeconds - Máximo tiempo desde auth_date (default 24h)
 */
export async function validateTelegramInitData(
  initData: string,
  maxAgeSeconds = 86400
): Promise<ValidatedInitData> {
  if (!initData || typeof initData !== 'string') {
    throw new Error('initData vacío o inválido')
  }

  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) throw new Error('Falta hash en initData')
  params.delete('hash')

  // 1. Construir data_check_string (pares ordenados por key, unidos por \n)
  const dataCheckString = Array.from(params.entries())
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n')

  // 2. secret_key = HMAC_SHA256("WebAppData", BOT_TOKEN)
  const secretKeyBuffer = await hmacSha256(
    new TextEncoder().encode('WebAppData'),
    BOT_TOKEN!
  )

  // 3. computed_hash = HMAC_SHA256(secret_key, data_check_string)
  const computedHashBuffer = await hmacSha256(secretKeyBuffer, dataCheckString)
  const computedHex = bufferToHex(computedHashBuffer)

  // 4. Comparar con el hash recibido
  if (computedHex !== hash) {
    throw new Error('Firma HMAC inválida')
  }

  // 5. Verificar auth_date
  const authDateRaw = params.get('auth_date')
  if (!authDateRaw) throw new Error('Falta auth_date')

  const authDateUnix = parseInt(authDateRaw, 10)
  if (isNaN(authDateUnix)) throw new Error('auth_date inválido')

  const authDate = new Date(authDateUnix * 1000)
  const ageSeconds = (Date.now() - authDate.getTime()) / 1000

  if (ageSeconds > maxAgeSeconds) {
    throw new Error(`initData expirado (${Math.floor(ageSeconds)}s de antigüedad)`)
  }

  // 6. Extraer user
  const userRaw = params.get('user')
  if (!userRaw) throw new Error('Falta user en initData')

  let user: TelegramUser
  try {
    user = JSON.parse(userRaw)
  } catch {
    throw new Error('user no es JSON válido')
  }

  if (!user?.id) throw new Error('user.id ausente')

  return {
    user,
    authDate,
    queryId: params.get('query_id') || undefined,
  }
}

/**
 * Extrae el initData del header Authorization (formato "tma <initData>")
 */
export function extractInitData(request: Request): string {
  const authHeader = request.headers.get('authorization')
  if (!authHeader) throw new Error('Falta header Authorization')

  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0] !== 'tma') {
    throw new Error('Formato Authorization inválido (debe ser "tma <initData>")')
  }

  return parts[1]
}