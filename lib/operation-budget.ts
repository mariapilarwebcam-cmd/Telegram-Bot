// Internal deadlines only. Never populate these values from HTTP input.
export function createOperationBudget(
  deadlineAt: number,
  parentSignal?: AbortSignal
) {
  if (!Number.isFinite(deadlineAt)) {
    throw new Error('invalid_operation_deadline')
  }

  const controller = new AbortController()
  const abort = () => controller.abort()

  if (parentSignal?.aborted || Date.now() >= deadlineAt) {
    abort()
  } else {
    parentSignal?.addEventListener('abort', abort, { once: true })
  }

  const timer = controller.signal.aborted
    ? undefined
    : setTimeout(abort, Math.max(1, deadlineAt - Date.now()))

  return {
    signal: controller.signal,
    check() {
      if (controller.signal.aborted || Date.now() >= deadlineAt) {
        abort()
        throw new Error('operation_deadline_exceeded')
      }
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer)
      parentSignal?.removeEventListener('abort', abort)
    },
  }
}