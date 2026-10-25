// app/api/cron/maintenance/route.ts
import { NextResponse } from 'next/server'
import { query, execute } from '@/lib/turso'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CRON_SECRET = process.env.CRON_SECRET

export async function GET(request: Request) {
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

  const stats = { expired_offers: 0, negative_tags: 0, decayed_tags: 0, promoted_photos: 0 }

  try {
    // 1. Expirar ofertas que el usuario no desbloqueó en 24 horas
    // En lugar de locked_photos, usamos photo_offers
    const expiredOffers = await query<{ id: number, user_id: string, image_id: number }>(
      `SELECT id, user_id, image_id FROM photo_offers WHERE state = 'locked' AND created_at < unixepoch() - 86400`
    )
    
    for (const offer of expiredOffers) {
      await execute(`UPDATE photo_offers SET state = 'expired' WHERE id = ?`, [offer.id])
      stats.expired_offers++
    }

    // 2. Decaimiento de etiquetas (El Olvido)
    await execute(`UPDATE user_tag_scores SET score = score * 0.95 WHERE score != 0`)
    await execute(`UPDATE learned_triggers SET weight = weight * 0.98 WHERE weight > 0`)

    // ✅ 3. PROMOCIÓN DIFERIDA (Claude's Rule)
    // Las fotos gratis o con token pasan a 'active' después de 24h si no tienen reportes
    const promote = await execute(`
      UPDATE generated_images 
      SET status = 'active'
      WHERE status = 'candidate' AND reports = 0
        AND id IN (
          SELECT image_id FROM photo_offers
          WHERE state = 'unlocked' 
            AND paid_with IN ('token', 'free')
            AND unlocked_at < unixepoch() - 86400
        )
    `)
    stats.promoted_photos = promote.rowsAffected

    return NextResponse.json({ ok: true, stats })

  } catch (error: any) {
    console.error('[cron/maintenance] ❌ Error:', error)
    return NextResponse.json({ error: 'Error interno', detail: error.message }, { status: 500 })
  }
}
