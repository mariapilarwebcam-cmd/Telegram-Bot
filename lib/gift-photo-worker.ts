import type { Client } from '@libsql/client'
import { createGiftEventService, GiftError } from '@/lib/gift-events'
import type { Identity } from '@/lib/gift-events'
import { createOperationBudget } from '@/lib/operation-budget'

// Internal backend composition only. No routes, scheduling or automatic retries.
export function createGiftPhotoWorker(
  db: Pick<Client, 'execute' | 'transaction'>,
  options?: { deadlineAt: number }
) {
  return {
    async process(identity: Identity) {
      if (process.env.GIFT_EVENTS_ENABLED !== 'true') {
        throw new GiftError('gift_events_disabled')
      }

      const deadlineAt = Math.min(options?.deadlineAt ?? Infinity, Date.now() + 150_000)
      const budget = createOperationBudget(deadlineAt)
      try {
        budget.check()
        // One service/capability scope and one budget per process invocation.
        const service = createGiftEventService(db, {
          async generate(context) {
            budget.check()
            const [
              { createGiftPhotoGenerator },
              { createWiroImageProvider },
            ] = await Promise.all([
              import('@/lib/gift-photo-generator'),
              import('@/lib/wiro-image-provider'),
            ])
            budget.check()
            const provider = createWiroImageProvider({
              deadlineAt,
              signal: budget.signal,
              startTimeoutMs: 15_000,
              waitTimeoutMs: 90_000,
            })
            return createGiftPhotoGenerator(provider, { deadlineAt, signal: budget.signal })(context)
          },
        })
        const claimed = await service.worker.claim(identity, 240)
        if (claimed.kind !== 'claimed') {
          return { kind: claimed.kind, event: claimed.event }
        }
        // generate() owns failure persistence. Do not call fail() again.
        await service.worker.generate(claimed.capability)
        // Do not publish after the application deadline; retain lease recovery.
        budget.check()
        // A finalize error may be an ambiguous commit. Never retry or fail here.
        const event = await service.worker.finalize(claimed.capability)
        return {
          kind: 'ready' as const,
          event,
        }
      } finally {
        budget.dispose()
      }
    },
  }
}