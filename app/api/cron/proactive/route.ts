// app/api/cron/proactive/route.ts
// Cron diario que envía mensajes proactivos a usuarios inactivos.
// Configurado en vercel.json → ejecuta a las 06:00 UTC.

import { NextResponse } from 'next/server'
import {
  getInactiveUsers,
  markProactiveSent,
  markBotBlocked,
} from '@/lib/db-queries'
import { PROACTIVE_TEMPLATES } from '@/lib/constants'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const MINI_APP_URL = process.env.MINI_APP_URL || process.env.NEXT_PUBLIC_APP_URL || ''
const CRON_SECRET = process.env.CRON_SECRET

// Máximo de mensajes a enviar por ejecución (anti-spam de Telegram: 30 msg/seg)
const BATCH_LIMIT = 200
// Delay entre mensajes para no saturar la API de Telegram
const DELAY_MS = 60

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
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
  const idx = Math.min(proactiveCount, templates.length - 1)
  return templates[idx][lang]
}

export async function GET(request: Request) {
  // ═══════════════════════════════════════════════════════════════
  // VALIDACIÓN: solo Vercel Cron puede llamar a este endpoint
  // Vercel manda automáticamente el header:
  //   Authorization: Bearer ${CRON_SECRET}
  // ═══════════════════════════════════════════════════════════════
  if (CRON_SECRET) {
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
      const lang: 'es' | 'en' = user.language === 'en' ? 'en' : 'es'

      const template = pickTemplate(
        user.character_gender,
        user.proactive_count,
        lang
      )

      // Reemplazar placeholders
      const text = template
        .replace(/{name}/g, user.first_name || (lang === 'es' ? 'amor' : 'love'))
        .replace(/{character}/g, user.character_name)

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

        // Usuario bloqueó al bot → no volver a intentar
        if (res.status === 403) {
          console.log(`[cron/proactive] 🚫 Bloqueado: ${user.telegram_id}`)
          await markBotBlocked(user.telegram_id)
          stats.blocked++
          await sleep(DELAY_MS)
          continue
        }

        if (!res.ok) {
          const errBody = await res.text().catch(() => '')
          console.error(
            `[cron/proactive] ❌ Error ${res.status} para ${user.telegram_id}:`,
            errBody.slice(0, 200)
          )
          stats.errors++
          await sleep(DELAY_MS)
          continue
        }

        // Éxito → marcar como enviado
        await markProactiveSent(user.telegram_id)
        stats.sent++
        console.log(
          `[cron/proactive] ✅ Enviado a ${user.telegram_id} (${user.character_name}, proactivo #${user.proactive_count + 1})`
        )
      } catch (e: any) {
        console.error(
          `[cron/proactive] ❌ Excepción con ${user.telegram_id}:`,
          e?.message
        )
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