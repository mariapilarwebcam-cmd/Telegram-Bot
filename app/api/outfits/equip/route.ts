// app/api/outfits/equip/route.ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/turso'
import { createGiftEventService, GiftError } from '@/lib/gift-events'
import { getOutfitCompatibilityError } from '@/lib/outfits'

function giftingUnavailable() {
  return NextResponse.json({
    error: 'outfit_gifting_temporarily_unavailable',
    message: 'Los nuevos regalos están temporalmente suspendidos. Tu outfit permanece en el inventario. Puedes alternar los outfits ya entregados.',
  }, { status: 403 })
}

export async function POST(request: Request) {
  try {
    const tid = request.headers.get('x-telegram-id-validated')
    if (!tid) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const { character_id, outfit_key, idempotency_key } = body

    if (!character_id || !outfit_key) {
      return NextResponse.json({ error: 'Faltan parámetros' }, { status: 400 })
    }

    const giftingEnabled = process.env.GIFT_EVENTS_ENABLED === 'true'
    const hasIdempotencyKey = idempotency_key !== undefined
    const tx = await db.transaction('write')

    try {
      // 1. Obtener el personaje y su armario actual
      const charRes = await tx.execute({
        sql: `SELECT equipped_outfit, owned_outfits, gender FROM user_characters WHERE id = ? AND telegram_id = ?`,
        args: [character_id, tid]
      })

      if (charRes.rows.length === 0) {
        await tx.rollback()
        return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 })
      }

      // Keyed B1 requests must resolve replay/conflict first in the core. It also
      // validates compatibility transactionally before any new delivery/alternation.
      if (!(giftingEnabled && hasIdempotencyKey)) {
        const compatibilityError = getOutfitCompatibilityError(outfit_key, charRes.rows[0].gender)
        if (compatibilityError) throw new GiftError(compatibilityError)
      }

      let ownedOutfits: string[] = []
      
      try {
        ownedOutfits = JSON.parse(String(charRes.rows[0].owned_outfits || '[]'))
      } catch (e) {
        ownedOutfits = []
      }

      // ✅ CASO A: El usuario ya tiene este outfit en el armario del personaje (solo quiere alternar)
      // Con el flag apagado, la alternancia legacy sigue funcionando.
      // Con clave y flag activo, B1 debe resolver primero el replay/conflicto.
      if (ownedOutfits.includes(outfit_key) &&
          !(giftingEnabled && hasIdempotencyKey)) {
        await tx.execute({
          sql: `UPDATE user_characters SET equipped_outfit = ? WHERE id = ? AND telegram_id = ?`,
          args: [outfit_key, character_id, tid]
        })
        await tx.commit()
        return NextResponse.json({ success: true, message: 'Outfit alternado' })
      }

      // B1 abrirá su propia transacción después de cerrar esta.
      await tx.rollback()
    } catch (txError) {
      await tx.rollback().catch(() => {})
      throw txError
    } finally {
      tx.close()
    }

    if (!giftingEnabled) return giftingUnavailable()

    if (!Number.isSafeInteger(character_id) || character_id <= 0 ||
        typeof outfit_key !== 'string' || outfit_key.trim().length === 0 ||
        outfit_key.length > 200 ||
        typeof idempotency_key !== 'string' ||
        idempotency_key.trim().length === 0 || idempotency_key.length > 200) {
      return NextResponse.json({
        error: 'invalid_gift_request',
        message: 'El regalo requiere un personaje válido, un outfit y una clave de idempotencia estable.',
      }, { status: 400 })
    }

    const service = createGiftEventService(db, {
      generate: async () => {
        throw new GiftError('gift_photo_generation_not_connected')
      },
    }).public

    const result = await service.create({
      userId: tid,
      characterId: character_id,
      outfitKey: outfit_key,
      idempotencyKey: idempotency_key,
    })

    return NextResponse.json({
      success: true,
      message: result.kind === 'alternated'
        ? 'Outfit alternado'
        : 'Regalo registrado',
      gift_result: result.kind,
      gift_event: result.event,
    })
  } catch (error: any) {
    if (error instanceof GiftError) {
      if (error.code === 'gift_events_disabled') return giftingUnavailable()

      const statuses: Record<string, number> = {
        invalid_identity: 400,
        invalid_request: 400,
        unexpected_input: 400,
        character_not_found: 404,
        outfit_unavailable: 409,
        outfit_unknown: 409,
        outfit_gender_incompatible: 409,
        inventory_unavailable: 409,
        idempotency_conflict: 409,
        wardrobe_inconsistent: 409,
        invalid_wardrobe: 409,
        gift_schema_incompatible: 503,
      }
      const status = statuses[error.code]

      if (status !== undefined) {
        return NextResponse.json({ error: error.code }, { status })
      }
    }
    console.error('[outfits/equip] error:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
