// app/api/cron/maintenance/route.ts
import { NextResponse } from 'next/server'
import { query, execute } from '@/lib/turso'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CRON_SECRET = process.env.CRON_SECRET

export async function GET(request: Request) {
  // 1. Seguridad: Solo Vercel Cron puede ejecutar esto
  if (!CRON_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Configuración incompleta' }, { status: 500 })
    }
  } else {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
  }

  const stats = { expired_photos: 0, negative_tags: 0, decayed_tags: 0, decayed_triggers: 0 }

  try {
    console.log('[cron/maintenance] ▶ Iniciando mantenimiento...')

    // ✅ 2. CASTIGO: Buscar fotos que expiraron y NO fueron compradas
    const expiredPhotos = await query<{ id: number, telegram_id: string, tag_key: string }>(
      `SELECT id, telegram_id, tag_key FROM locked_photos 
       WHERE status = 'locked' AND expires_at < datetime('now')`
    )

    for (const photo of expiredPhotos) {
      // Restar puntos a las etiquetas de esa foto (el usuario la ignoró)
      const tags = photo.tag_key.split('_')
      for (const tag of tags) {
        if (!tag) continue
        await execute(
          `UPDATE user_tag_scores 
           SET score = score - 1, updated_at = unixepoch()
           WHERE user_id = ? AND tag = ?`,
          [photo.telegram_id, tag]
        )
        stats.negative_tags++
      }
    }

    // Marcar todas esas fotos como expiradas
    const markExpired = await execute(
      `UPDATE locked_photos SET status = 'expired' 
       WHERE status = 'locked' AND expires_at < datetime('now')`
    )
    stats.expired_photos = markExpired.rowsAffected

    // ✅ 3. EL OLVIDO: Decaer los puntajes de las etiquetas (5% diario)
    const decayTags = await execute(
      `UPDATE user_tag_scores SET score = score * 0.95 WHERE score != 0`
    )
    stats.decayed_tags = decayTags.rowsAffected

    // ✅ 4. EL OLVIDO: Decaer los triggers de palabras (2% diario)
    const decayTriggers = await execute(
      `UPDATE learned_triggers SET weight = weight * 0.98 WHERE weight > 0`
    )
    stats.decayed_triggers = decayTriggers.rowsAffected

    console.log('[cron/maintenance] ✅ Completado:', stats)

    return NextResponse.json({
      ok: true,
      message: 'Mantenimiento diario completado',
      stats
    })

  } catch (error: any) {
    console.error('[cron/maintenance] ❌ Error:', error)
    return NextResponse.json({ error: 'Error interno', detail: error.message }, { status: 500 })
  }
}