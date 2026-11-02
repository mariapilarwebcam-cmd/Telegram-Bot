// lib/telegram-auth.ts
// Autenticación mediante initData firmado por Telegram.
// No confía en headers internos de identidad ni consume el body.

import {
  extractInitData,
  validateTelegramInitData,
  TelegramAuthError,
  TelegramAuthConfigurationError,
  type ValidatedInitData,
} from './validate-telegram'

export type TelegramAuthenticationResult =
  | {
      ok: true
      telegramId: string
      data: ValidatedInitData
    }
  | {
      ok: false
      status: 401
      error: 'No autorizado'
    }
  | {
      ok: false
      status: 503
      error: 'Servicio de autenticación no disponible'
    }

/**
 * Autentica exclusivamente mediante Authorization: tma <initData>.
 *
 * La identidad procede del usuario cuya firma ha verificado el validador.
 * No utiliza x-telegram-id-validated, parámetros de URL ni datos del body.
 *
 * Los errores conocidos se traducen a resultados genéricos.
 * Los errores inesperados se propagan sin registrarlos ni serializarlos.
 */
export async function authenticateTelegramRequest(
  request: Request
): Promise<TelegramAuthenticationResult> {
  try {
    const initData = extractInitData(request)
    const data = await validateTelegramInitData(initData)

    return {
      ok: true,
      telegramId: String(data.user.id),
      data,
    }
  } catch (error: unknown) {
    if (error instanceof TelegramAuthError) {
      return {
        ok: false,
        status: 401,
        error: 'No autorizado',
      }
    }

    if (error instanceof TelegramAuthConfigurationError) {
      return {
        ok: false,
        status: 503,
        error: 'Servicio de autenticación no disponible',
      }
    }

    throw error
  }
}