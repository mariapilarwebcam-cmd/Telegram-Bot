// lib/validate-telegram.ts
// Validación de initData de Telegram compatible con Edge Runtime
// Usa Web Crypto API nativa (crypto.subtle) — sin dependencias de Node.js

export class TelegramAuthError extends Error {
  readonly status = 401

  constructor() {
    super('No autorizado')
    this.name = 'TelegramAuthError'
  }
}

export class TelegramAuthConfigurationError extends Error {
  readonly status = 503

  constructor() {
    super('Servicio de autenticación no disponible')
    this.name = 'TelegramAuthConfigurationError'
  }
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
 * Lanza TelegramAuthError si las credenciales son inválidas.
 * Lanza TelegramAuthConfigurationError si la configuración es inválida.
 * Los errores inesperados de Web Crypto se propagan sin normalizarlos.
 *
 * @param initData - String crudo (window.Telegram.WebApp.initData)
 * @param maxAgeSeconds - Máximo tiempo desde auth_date (default 24h)
 */
export async function validateTelegramInitData(
  initData: string,
  maxAgeSeconds = 86400
): Promise<ValidatedInitData> {
  // Resolver el token al validar, no durante la importación del módulo.
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  if (
    typeof botToken !== 'string' ||
    !botToken.trim() ||
    !Number.isSafeInteger(maxAgeSeconds) ||
    maxAgeSeconds < 0
  ) {
    throw new TelegramAuthConfigurationError()
  }

  if (!initData || typeof initData !== 'string') {
    throw new TelegramAuthError()
  }

  const params = new URLSearchParams(initData)
  const seen = new Set<string>()

  // URLSearchParams ya ha decodificado las claves: también se rechazan
  // duplicados equivalentes como "user" y "%75ser".
  for (const key of params.keys()) {
    if (!key || seen.has(key)) {
      throw new TelegramAuthError()
    }
    seen.add(key)
  }

  const hash = params.get('hash')
  if (!hash || !/^[a-fA-F0-9]{64}$/.test(hash)) {
    throw new TelegramAuthError()
  }
  params.delete('hash')

  // 1. Construir data_check_string (pares ordenados por key, unidos por \n)
  // Incluir todos los campos recibidos salvo hash.
  params.sort()
  const dataCheckString = Array.from(params.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  // 2. secret_key = HMAC_SHA256(key="WebAppData", data=botToken)
  const secretKeyBuffer = await hmacSha256(
    new TextEncoder().encode('WebAppData'),
    botToken
  )

  // 3. Importar secret_key para verificar HMAC-SHA256(data_check_string).
  const verificationKey = await crypto.subtle.importKey(
    'raw',
    secretKeyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  )

  const signature = new Uint8Array(32)

  for (let index = 0; index < signature.length; index++) {
    signature[index] = Number.parseInt(
      hash.slice(index * 2, index * 2 + 2),
      16
    )
  }

  // 4. Verificar los bytes de la firma mediante Web Crypto.
  const validSignature = await crypto.subtle.verify(
    'HMAC',
    verificationKey,
    signature,
    new TextEncoder().encode(dataCheckString)
  )

  if (!validSignature) {
    throw new TelegramAuthError()
  }

  // 5. Verificar auth_date
  const authDateRaw = params.get('auth_date')
  if (!authDateRaw || !/^\d+$/.test(authDateRaw)) {
    throw new TelegramAuthError()
  }

  const authDateUnix = Number(authDateRaw)
  const authDate = new Date(authDateUnix * 1000)

  if (
    !Number.isSafeInteger(authDateUnix) ||
    !Number.isFinite(authDate.getTime())
  ) {
    throw new TelegramAuthError()
  }

  const now = Date.now()
  if (!Number.isFinite(now)) {
    throw new TelegramAuthConfigurationError()
  }

  const ageSeconds = (now - authDate.getTime()) / 1000

  // Mantener las 24 horas por defecto y admitir como máximo 60 s de futuro.
  if (ageSeconds > maxAgeSeconds || ageSeconds < -60) {
    throw new TelegramAuthError()
  }

  // 6. Extraer user
  const userRaw = params.get('user')
  if (!userRaw) throw new TelegramAuthError()

  let parsedUser: unknown
  try {
    parsedUser = JSON.parse(userRaw)
  } catch {
    throw new TelegramAuthError()
  }

  if (
    !parsedUser ||
    typeof parsedUser !== 'object' ||
    Array.isArray(parsedUser)
  ) {
    throw new TelegramAuthError()
  }

  const candidate = parsedUser as Record<string, unknown>

  if (
    typeof candidate.id !== 'number' ||
    !Number.isSafeInteger(candidate.id) ||
    candidate.id <= 0 ||
    typeof candidate.first_name !== 'string'
  ) {
    throw new TelegramAuthError()
  }

  for (const key of [
    'last_name',
    'username',
    'language_code',
    'photo_url',
  ]) {
    if (candidate[key] !== undefined && typeof candidate[key] !== 'string') {
      throw new TelegramAuthError()
    }
  }

  if (
    candidate.is_premium !== undefined &&
    typeof candidate.is_premium !== 'boolean'
  ) {
    throw new TelegramAuthError()
  }

  const user = parsedUser as TelegramUser

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

  // Rechazar controles antes de interpretar el esquema y las credenciales.
  if (!authHeader || /[\u0000-\u001f\u007f-\u009f]/.test(authHeader)) {
    throw new TelegramAuthError()
  }

  // Un solo espacio separador, sin espacios en las credenciales ni comas
  // que puedan representar valores Authorization combinados.
  const match = authHeader.match(/^tma ([^\s,]+)$/)

  if (!match) {
    throw new TelegramAuthError()
  }

  return match[1]
}