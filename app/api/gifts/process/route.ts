import { NextResponse } from 'next/server'
import { authenticateTelegramRequest } from '@/lib/telegram-auth'
import { GiftError } from '@/lib/gift-events'

export const runtime = 'nodejs'
// Project owner confirmed Hobby + Fluid Compute.
// Application deadline: 150s; platform limit: 180s; claim lease: 240s.
// Local cancellation does not guarantee cancellation of a remote Wiro task.
export const maxDuration = 180

function disabled() {
  return NextResponse.json(
    { error: 'gift_events_disabled' },
    { status: 403 }
  )
}

export async function POST(request: Request) {
  const deadlineAt = Date.now() + 150_000
  try {
    // Never derive identity from client-controlled internal headers or JSON.
    const authentication = await authenticateTelegramRequest(request)
    if (authentication.ok === false) {
      return NextResponse.json(
        { error: authentication.error },
        { status: authentication.status }
      )
    }

    if (process.env.GIFT_EVENTS_ENABLED !== 'true') return disabled()

    const body: unknown = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { error: 'invalid_gift_process_request' },
        { status: 400 }
      )
    }

    const input = body as Record<string, unknown>
    const keys = Object.keys(input)
    const { character_id, event_id } = input
    if (keys.length !== 2 ||
        !keys.every(key => key === 'character_id' || key === 'event_id') ||
        typeof character_id !== 'number' ||
        !Number.isSafeInteger(character_id) || character_id <= 0 ||
        typeof event_id !== 'number' ||
        !Number.isSafeInteger(event_id) || event_id <= 0) {
      return NextResponse.json(
        { error: 'invalid_gift_process_request' },
        { status: 400 }
      )
    }

    // No DB or worker composition before authentication, flag and validation.
    const [{ db }, { createGiftPhotoWorker }] = await Promise.all([
      import('@/lib/turso'),
      import('@/lib/gift-photo-worker'),
    ])

    const result = await createGiftPhotoWorker(db, { deadlineAt }).process({
      userId: authentication.telegramId,
      characterId: character_id,
      eventId: event_id,
    })

    return NextResponse.json(
      {
        success: true,
        gift_result: result.kind,
        gift_event: result.event,
      },
      { status: result.kind === 'busy' ? 202 : 200 }
    )
  } catch (error: unknown) {
    if (error instanceof GiftError) {
      if (error.code === 'gift_events_disabled') return disabled()

      if (error.code === 'character_not_found' ||
          error.code === 'event_not_found') {
        return NextResponse.json(
          { error: 'gift_event_not_found' },
          { status: 404 }
        )
      }

      const statuses: Record<string, number> = {
        invalid_identity: 400,
        claim_lost: 409,
        outfit_unavailable: 409,
        gift_schema_incompatible: 503,
      }
      const status = statuses[error.code]
      if (status !== undefined) {
        return NextResponse.json({ error: error.code }, { status })
      }
    }

    // Provider/storage errors and ambiguous commits are never success.
    // Do not expose upstream details, call fail(), or retry here.
    return NextResponse.json(
      { error: 'gift_photo_processing_failed' },
      { status: 500 }
    )
  }
}