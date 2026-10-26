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

    // ✅ 3. PROMOCIÓN DIFERIDA (Mejorada)
    // Promovemos imágenes 'candidate' que tengan más de 24h, no tengan reportes,
    // y que NO estén esperando ser desbloqueadas (es decir, que no estén en ofertas 'locked').
    // Esto incluye fotos gratis, de regalo, pases de fantasía y peticiones directas.
    const promote = await execute(`
      UPDATE generated_images 
      SET status = 'active'
      WHERE status = 'candidate' 
        AND reports = 0
        AND created_at < unixepoch() - 86400
        AND id NOT IN (
          SELECT image_id FROM photo_offers WHERE state = 'locked'
        )
    `)
    stats.promoted_photos = promote.rowsAffected

    return NextResponse.json({ ok: true, stats })

  } catch (error: any) {
    console.error('[cron/maintenance] ❌ Error:', error)
    return NextResponse.json({ error: 'Error interno', detail: error.message }, { status: 500 })
  }
}
