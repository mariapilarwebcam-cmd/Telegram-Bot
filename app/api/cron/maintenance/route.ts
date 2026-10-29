// app/api/cron/maintenance/route.ts
import { NextResponse } from 'next/server'
import { execute, queryOne } from '@/lib/turso'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CRON_SECRET = process.env.CRON_SECRET

// ✅ Límite de filas a procesar por ejecución para evitar timeouts
const BATCH_SIZE = 5000
const MAX_BATCHES = 5 // Máximo 25,000 filas por tabla por ejecución

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
    decayed_tag_batches: 0, 
    decayed_trigger_batches: 0, 
    promoted_photos: 0 
  }

  try {
    // 1. Expirar ofertas (AHORA EN UNA SOLA QUERY ATÓMICA)
    // En lugar de hacer SELECT y luego un bucle con N updates, lo hacemos de golpe.
    const expiredResult = await execute(`
      UPDATE photo_offers 
      SET state = 'expired' 
      WHERE state = 'locked' 
        AND created_at < unixepoch() - 86400
    `)
    stats.expired_offers = expiredResult.rowsAffected

    // 2. Decaimiento de Etiquetas (Por lotes para no bloquear la BD)
    // Usamos un bucle controlado. Si hay 100k registros, esto procesa 25k por día.
    for (let i = 0; i < MAX_BATCHES; i++) {
      const decayedTags = await execute(`
        UPDATE user_tag_scores 
        SET score = score * 0.95 
        WHERE id IN (
          SELECT id FROM user_tag_scores 
          WHERE score != 0 
          LIMIT ?
        )
      `, [BATCH_SIZE])
      
      if (decayedTags.rowsAffected === 0) break
      stats.decayed_tag_batches++
      
      // Si procesamos menos del límite, significa que ya terminamos
      if (decayedTags.rowsAffected < BATCH_SIZE) break
    }

    // 3. Decaimiento de Learned Triggers (Por lotes)
    for (let i = 0; i < MAX_BATCHES; i++) {
      const decayedTriggers = await execute(`
        UPDATE learned_triggers 
        SET weight = weight * 0.98 
        WHERE id IN (
          SELECT id FROM learned_triggers 
          WHERE weight > 0 
          LIMIT ?
        )
      `, [BATCH_SIZE])
      
      if (decayedTriggers.rowsAffected === 0) break
      stats.decayed_trigger_batches++
      
      if (decayedTriggers.rowsAffected < BATCH_SIZE) break
    }

    // 4. PROMOCIÓN DIFERIDA (Mejorada con límite para no saturar)
    const promote = await execute(`
      UPDATE generated_images 
      SET status = 'active'
      WHERE id IN (
        SELECT id FROM generated_images
        WHERE status = 'candidate' 
          AND reports = 0
          AND created_at < unixepoch() - 86400
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
