// app/api/cron/proactive/route.ts
// Cron diario que envía mensajes proactivos a usuarios inactivos.
// Configurado en vercel.json → ejecuta a las 06:00 UTC.

import { NextResponse } from 'next/server'
import {
  getInactiveUsers,
  markProactiveSent,
  markBotBlocked,
} from '@/lib/db-queries'
import { execute } from '@/lib/turso'
import { PROACTIVE_TEMPLATES } from '@/lib/constants'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const MINI_APP_URL = process.env.MINI_APP_URL || process.env.NEXT_PUBLIC_APP_URL || ''
const CRON_SECRET = process.env.CRON_SECRET

// ✅ FIX #6: Reducido de 200 a 100 para no exceder maxDuration en picos.
const BATCH_LIMIT = 100
// Delay entre mensajes para no saturar la API de Telegram
const DELAY_MS = 60
// ✅ FIX #6: Deadline interno. Si queda menos de esto, paramos el loop.
const DEADLINE_BUFFER_MS = 8_000

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * ✅ FIX #4: Escapa caracteres especiales de Markdown v1 (legacy).
 * Telegram rechaza mensajes con `_`, `*`, `[`, `]`, `` ` `` sin escapar.
 */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]`])/g, '\\$1')
}

/**
 * Elige el template según género del personaje y número de proactivo.
 * proactive_count es el contador ANTES de este envío (0, 1, 2).
 */
function pickTemplate(
  characterGender: string,
  proactiveCount: number,
  lang: 'es' | 'en'
): string {
  const genderKey = characterGender === 'male' ? 'male' : 'female'
  const templates = PROACTIVE_TEMPLATES[genderKey]
  const idx = Math.min(Math.max(0, proactiveCount), templates.length - 1)
  return templates[idx][lang]
}

/**
 * ✅ FIX #1 y #2 (CRÍTICO): Claim atómico ANTES de enviar.
 * Retorna true si este proceso ganó el claim y debe enviar el mensaje.
 * Retorna false si otro proceso ya lo tomó (race condition) o si el usuario
 * ya no califica (por ejemplo, se volvió activo entre la query y el claim).
 *
 * Usa el UPDATE con WHERE que replica las condiciones de getInactiveUsers
 * para garantizar que solo se "claim" usuarios que siguen inactivos.
 */
async function claimProactiveSend(telegramId: string): Promise<boolean> {
  try {
    const result = await execute(
      `UPDATE users
       SET last_proactive_at = datetime('now'),
           proactive_count = COALESCE(proactive_count, 0) + 1,
           updated_at = datetime('now')
       WHERE telegram_id = ?
         AND COALESCE(proactive_count, 0) < 3
         AND (
           last_proactive_at IS NULL
           OR last_proactive_at < datetime('now', '-2 days')
         )`,
      [telegramId]
    )
    return result.rowsAffected > 0
  } catch (e) {
    console.error(`[cron/proactive] claim failed for ${telegramId}:`, e)
    return false
  }
}

/**
 * ✅ FIX #2 (parte 2): Revierte el claim si el envío falló, para que el
 * usuario pueda recibir el mensaje en la próxima ejecución del cron.
 * No revierte si el usuario bloqueó al bot (en ese caso markBotBlocked ya
 * se encargó de excluirlo para siempre).
 */
async function revertProactiveSend(telegramId: string): Promise<void> {
  try {
    await execute(
      `UPDATE users
       SET last_proactive_at = NULL,
           proactive_count = MAX(COALESCE(proactive_count, 0) - 1, 0),
           updated_at = datetime('now')
       WHERE telegram_id = ?`,
      [telegramId]
    )
  } catch (e) {
    // Si el revert falla, log para auditoría manual. El usuario podría perder
    // una oportunidad de mensaje, pero es mejor que un duplicado.
    console.error(`[cron/proactive] revert failed for ${telegramId}:`, e)
  }
}

export async function GET(request: Request) {
  // ═══════════════════════════════════════════════════════════════
  // VALIDACIÓN: solo Vercel Cron puede llamar a este endpoint
  // Vercel manda automáticamente el header:
  //   Authorization: Bearer ${CRON_SECRET}
  // ═══════════════════════════════════════════════════════════════
  if (!CRON_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[cron/proactive] ❌ CRON_SECRET no configurado en producción')
      return NextResponse.json({ error: 'Configuración incompleta' }, { status: 500 })
    }
  } else {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      console.warn('[cron/proactive] unauthorized attempt')
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
  }

  if (!TELEGRAM_BOT_TOKEN) {
    console.error('[cron/proactive] TELEGRAM_BOT_TOKEN no configurado')
    return NextResponse.json(
      { error: 'Configuración incompleta' },
      { status: 500 }
    )
  }

  if (!MINI_APP_URL) {
    console.error('[cron/proactive] MINI_APP_URL no configurado')
    return NextResponse.json(
      { error: 'Configuración incompleta: MINI_APP_URL' },
      { status: 500 }
    )
  }

  console.log('[cron/proactive] ▶ Iniciando')

  const startTime = Date.now()
  const stats = {
    total: 0,
    sent: 0,
    blocked: 0,
    errors: 0,
    skipped: 0,
    reclaimed: 0, // ✅ FIX #1: cuántos se saltaron por race condition
  }

  try {
    // ─── 1. Obtener usuarios inactivos ───
    const users = await getInactiveUsers(BATCH_LIMIT)
    stats.total = users.length

    console.log(`[cron/proactive] Usuarios elegibles: ${users.length}`)

    if (users.length === 0) {
      return NextResponse.json({
        ok: true,
        duration_ms: Date.now() - startTime,
        stats,
      })
    }

    // ─── 2. Enviar mensajes uno por uno ───
    for (const user of users) {
      // ✅ FIX #6: Deadline check. Si queda poco tiempo, paramos el loop
      // para no ser matados por Vercel a mitad de un envío.
      if (Date.now() - startTime > 60_000 - DEADLINE_BUFFER_MS) {
        console.warn(
          `[cron/proactive] ⏰ Deadline alcanzado. Procesados ${stats.sent + stats.blocked + stats.errors}/${users.length}`
        )
        break
      }

      const lang: 'es' | 'en' = user.language === 'en' ? 'en' : 'es'

      // ✅ FIX #1 (CRÍTICO): Claim atómico ANTES de enviar.
      // Si dos crons corren en paralelo, solo uno gana el claim por usuario.
      const claimed = await claimProactiveSend(user.telegram_id)
      if (!claimed) {
        // Otro proceso ya tomó este usuario, o dejó de calificar.
        stats.reclaimed++
        continue
      }

      const template = pickTemplate(
        user.character_gender,
        user.proactive_count,
        lang
      )

      // ✅ FIX #4: Escapar Markdown en valores interpolados
      const safeName = escapeMarkdown(
        user.first_name || (lang === 'es' ? 'amor' : 'love')
      )
      const safeCharacter = escapeMarkdown(user.character_name)

      const text = template
        .replace(/{name}/g, safeName)
        .replace(/{character}/g, safeCharacter)

      // Botón inline que abre la Mini App directo al chat del personaje
      const replyMarkup = {
        inline_keyboard: [
          [
            {
              text: lang === 'es' ? '💬 Responder' : '💬 Reply',
              web_app: { url: `${MINI_APP_URL}/chat/${user.character_id}` },
            },
          ],
        ],
      }

      try {
        const res = await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: user.telegram_id,
              text,
              parse_mode: 'Markdown',
              reply_markup: replyMarkup,
              disable_notification: false,
            }),
          }
        )

        // ✅ FIX #5: Manejo de 429 (rate limit de Telegram) con retry_after
        if (res.status === 429) {
          const body = await res.json().catch(() => ({}))
          const retryAfter = Number(body?.parameters?.retry_after || 5)
          console.warn(
            `[cron/proactive] ⏳ Rate limit para ${user.telegram_id}, esperando ${retryAfter}s`
          )
          await revertProactiveSend(user.telegram_id)
          await sleep(retryAfter * 1000)
          stats.errors++
          continue
        }

        // Usuario bloqueó al bot → no volver a intentar
        if (res.status === 403) {
          console.log(`[cron/proactive] 🚫 Bloqueado: ${user.telegram_id}`)
          // ✅ FIX #7: markBotBlocked en try/catch para no romper el loop
          try {
            await markBotBlocked(user.telegram_id)
            stats.blocked++
          } catch (markErr) {
            console.error(
              `[cron/proactive] ❌ markBotBlocked failed para ${user.telegram_id}:`,
              markErr
            )
            stats.errors++
            // No revertimos el claim: si el usuario bloqueó, no queremos reintentar.
          }
          await sleep(DELAY_MS)
          continue
        }

        if (!res.ok) {
          const errBody = await res.text().catch(() => '')
          console.error(
            `[cron/proactive] ❌ Error ${res.status} para ${user.telegram_id}:`,
            errBody.slice(0, 200)
          )
          // ✅ FIX #2: Revertir el claim para reintentar en el próximo cron.
          await revertProactiveSend(user.telegram_id)
          stats.errors++
          await sleep(DELAY_MS)
          continue
        }

        // ✅ Éxito: el claim ya marcó el envío. Solo actualizamos stats.
        stats.sent++
        console.log(
          `[cron/proactive] ✅ Enviado a ${user.telegram_id} (${user.character_name}, proactivo #${user.proactive_count + 1})`
        )
      } catch (e: any) {
        console.error(
          `[cron/proactive] ❌ Excepción con ${user.telegram_id}:`,
          e?.message
        )
        // ✅ FIX #2: Revertir el claim si hubo excepción de red.
        await revertProactiveSend(user.telegram_id)
        stats.errors++
      }

      // Delay para no saturar la API
      await sleep(DELAY_MS)
    }

    const duration = Date.now() - startTime
    console.log(`[cron/proactive] ✅ Completado en ${duration}ms`, stats)

    return NextResponse.json({
      ok: true,
      duration_ms: duration,
      stats,
    })
  } catch (e: any) {
    console.error('[cron/proactive] ❌ Error fatal:', e)
    return NextResponse.json(
      {
        error: 'Error interno',
        detail: e?.message || String(e),
        stats,
      },
      { status: 500 }
    )
  }
}
