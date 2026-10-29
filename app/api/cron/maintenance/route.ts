// app/api/cron/maintenance/route.ts
import { NextResponse } from 'next/server'
import { execute, queryOne } from '@/lib/turso'
import { expireOldSubscriptions } from '@/lib/db-queries' // ✅ FIX #1

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CRON_SECRET = process.env.CRON_SECRET

const BATCH_SIZE = 5000
const MAX_BATCHES = 5

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

  const stats = { 
    expired_offers: 0, 
    expired_subscriptions: 0, // ✅ NUEVO
    decayed_tag_batches: 0, 
    decayed_trigger_batches: 0, 
    promoted_photos: 0 
  }

  try {
    // 1. Expirar ofertas
    // ✅ FIX #2: Usar datetime('now', '-1 day') para comparar correctamente strings de fecha
    const expiredResult = await execute(`
      UPDATE photo_offers 
      SET state = 'expired' 
      WHERE state = 'locked' 
        AND created_at < datetime('now', '-1 day')
    `)
    stats.expired_offers = expiredResult.rowsAffected

    // ✅ FIX #1: Expirar suscripciones VIP caducadas
    stats.expired_subscriptions = await expireOldSubscriptions()

    // 2. Decaimiento de Etiquetas (Por lotes)
    for (let i = 0; i < MAX_BATCHES; i++) {
      // ✅ FIX #3: Añadido ORDER BY updated_at ASC y clamp a 0 para no quedar en bucle infinito
      const decayedTags = await execute(`
        UPDATE user_tag_scores 
        SET score = CASE WHEN score * 0.95 < 0.1 THEN 0 ELSE score * 0.95 END,
            updated_at = unixepoch()
        WHERE id IN (
          SELECT id FROM user_tag_scores 
          WHERE score > 0 
          ORDER BY updated_at ASC
          LIMIT ?
        )
      `, [BATCH_SIZE])
      
      if (decayedTags.rowsAffected === 0) break
      stats.decayed_tag_batches++
      
      if (decayedTags.rowsAffected < BATCH_SIZE) break
    }

    // 3. Decaimiento de Learned Triggers (Por lotes)
    for (let i = 0; i < MAX_BATCHES; i++) {
      // ✅ FIX #3: Añadido ORDER BY id ASC y clamp a 0
      const decayedTriggers = await execute(`
        UPDATE learned_triggers 
        SET weight = CASE WHEN weight * 0.98 < 0.1 THEN 0 ELSE weight * 0.98 END
        WHERE id IN (
          SELECT id FROM learned_triggers 
          WHERE weight > 0 
          ORDER BY id ASC
          LIMIT ?
        )
      `, [BATCH_SIZE])
      
      if (decayedTriggers.rowsAffected === 0) break
      stats.decayed_trigger_batches++
      
      if (decayedTriggers.rowsAffected < BATCH_SIZE) break
    }

    // 4. PROMOCIÓN DIFERIDA
    // ✅ FIX #2: Usar datetime('now', '-1 day') para comparar correctamente
    const promote = await execute(`
      UPDATE generated_images 
      SET status = 'active'
      WHERE id IN (
        SELECT id FROM generated_images
        WHERE status = 'candidate' 
          AND reports = 0
          AND created_at < datetime('now', '-1 day')
          AND id NOT IN (
            SELECT image_id FROM photo_offers WHERE state = 'locked'
          )
        LIMIT ?
      )
    `, [BATCH_SIZE])
    stats.promoted_photos = promote.rowsAffected

    return NextResponse.json({ ok: true, stats })

  } catch (error: any) {
    console.error('[cron/maintenance] ❌ Error:', error)
    return NextResponse.json({ error: 'Error interno', detail: error.message }, { status: 500 })
  }
}
