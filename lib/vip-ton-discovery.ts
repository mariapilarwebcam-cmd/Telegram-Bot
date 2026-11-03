/** Bounded discovery with a resumable cursor. Events are hints, never evidence. */
export async function discoverVipTrace(
  fetcher: typeof fetch, recipient: string, reference: string, apiKey: string | undefined,
  cursor: unknown,
) {
  const value = cursor as { beforeLt?: unknown; offset?: unknown } | null
  const beforeLt = typeof value?.beforeLt === 'string' && /^\d{1,30}$/.test(value.beforeLt)
    ? value.beforeLt : undefined
  const offset = Number.isSafeInteger(value?.offset) && Number(value?.offset) >= 0 && Number(value?.offset) <= 100
    ? Number(value?.offset) : 0
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const response = await fetcher(`https://tonapi.io/v2/accounts/${encodeURIComponent(recipient)}/events?limit=100` +
    (beforeLt ? `&before_lt=${beforeLt}` : ''), {
    headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error('discovery_unavailable')
  const data = await response.json()
  if (!Array.isArray(data.events)) throw new Error('invalid_discovery')
  // Advance through ALL events and candidates across requests, not just the
  // first 100 / first two matches. A full pass restarts to revisit finality.
  for (let i = offset; i < data.events.length; i++) {
    const event = data.events[i]
    if (typeof event?.event_id === 'string' && /^[a-fA-F0-9]{64}$/.test(event.event_id) &&
        Array.isArray(event.actions) && event.actions.some((a: any) => a?.JettonTransfer?.comment === reference)) {
      return { traceId: event.event_id as string, cursor: { beforeLt, offset: i + 1 } }
    }
  }
  // TonAPI exposes next_from as int64; reject unsafe JS numbers rather than
  // silently round a logical time. Direct trace_id recovery remains available.
  const next = typeof data.next_from === 'string' ? data.next_from
    : Number.isSafeInteger(data.next_from) ? String(data.next_from) : undefined
  return { traceId: undefined, cursor: next && /^\d+$/.test(next) && next !== '0' && next !== beforeLt
    ? { beforeLt: next, offset: 0 } : null }
}