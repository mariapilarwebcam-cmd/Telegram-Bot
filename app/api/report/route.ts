// app/api/report/route.ts
// Endpoint para reportar contenido inapropiado (requisito de Telegram +18).
// Recibe: { character_id, message_id?, message_content?, reason, details? }

import { NextResponse } from 'next/server'
import { execute } from '@/lib/turso'
import { ensureUser } from '@/lib/db-queries'

// Razones válidas para el reporte
const VALID_REASONS = [
  'inappropriate_content',  // Contenido no apropiado
  'offensive',              // Ofensivo/discriminatorio
  'harassment',             // Acoso
  'non_consensual',         // Contenido no consensuado
  'minor_safety',           // Seguridad de menores (prioridad máxima)
  'spam',                   // Spam
  'other',                  // Otro
] as const

type Reason = (typeof VALID_REASONS)[number]

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const characterId = Number(body?.character_id) || null
    const messageId = Number(body?.message_id) || null
    const messageContent =
      typeof body?.message_content === 'string'
        ? body.message_content.slice(0, 2000)
        : null
    const reason = String(body?.reason || '').trim() as Reason
    const details =
      typeof body?.details === 'string' ? body.details.slice(0, 1000) : null

    // ─── Validaciones ───
    if (!VALID_REASONS.includes(reason)) {
      return NextResponse.json(
        { error: 'Razón de reporte inválida' },
        { status: 400 }
      )
    }

    // Asegurar que el usuario existe (evita reportes fantasma)
    const user = await ensureUser(tid)
    if (!user) {
      return NextResponse.json(
        { error: 'Error cargando tu cuenta' },
        { status: 500 }
      )
    }

    // ─── Anti-spam: máx 5 reportes por hora por usuario ───
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

    const recentReports = await execute(
      `SELECT COUNT(*) AS c FROM reports
       WHERE reporter_id = ? AND created_at > ?`,
      [tid, oneHourAgo]
    ).then((res: any) => {
      // execute no devuelve filas; usamos query directa
      return null
    }).catch(() => null)

    // Hacemos la verificación con query directa
    const { queryOne } = await import('@/lib/turso')
    const recent = await queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM reports
       WHERE reporter_id = ? AND created_at > ?`,
      [tid, oneHourAgo]
    )

    if ((recent?.c ?? 0) >= 5) {
      return NextResponse.json(
        { error: 'Demasiados reportes. Intenta de nuevo más tarde.' },
        { status: 429 }
      )
    }

    // ─── Insertar reporte ───
    await execute(
      `INSERT INTO reports
        (reporter_id, character_id, message_id, message_content, reason, details, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [tid, characterId, messageId, messageContent, reason, details]
    )

    console.log('[report] ✅ Nuevo reporte:', {
      reporter_id: tid,
      character_id: characterId,
      message_id: messageId,
      reason,
    })

    // ─── Prioridad máxima: minor_safety → log de alerta ───
    if (reason === 'minor_safety') {
      console.error('[report] 🚨 ALERTA PRIORITARIA — minor_safety:', {
        reporter_id: tid,
        character_id: characterId,
        message_id: messageId,
        details,
      })
    }

    return NextResponse.json({
      ok: true,
      message:
        'Reporte recibido. Nuestro equipo lo revisará en un plazo máximo de 48 horas.',
    })
  } catch (e: any) {
    console.error('[report] error:', e)
    return NextResponse.json(
      { error: 'Error interno', detail: e?.message || String(e) },
      { status: 500 }
    )
  }
}