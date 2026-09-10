export const callLifecycleStages = [
  'ringing',
  'answer_requested',
  'server_accepting',
  'active',
  'audio_ready',
  'media_enhancing',
] as const

export const callLifecycleTerminalStates = [
  'cancelled',
  'rejected',
  'expired',
  'failed',
  'answered_elsewhere',
  'ended',
] as const

export type CallLifecycleStage = (typeof callLifecycleStages)[number]
export type CallLifecycleTerminalState = (typeof callLifecycleTerminalStates)[number]
export type CallLifecycleState = CallLifecycleStage | CallLifecycleTerminalState

const lifecycleOrder = new Map(callLifecycleStages.map((stage, index) => [stage, index]))

export const isCallLifecycleTerminal = (
  state: CallLifecycleState,
): state is CallLifecycleTerminalState =>
  (callLifecycleTerminalStates as readonly string[]).includes(state)

/**
 * Accept only forward lifecycle transitions. A terminal result is always
 * authoritative, including when an async success arrives afterwards.
 */
export const reduceCallLifecycle = (
  current: CallLifecycleState,
  next: CallLifecycleState,
): CallLifecycleState => {
  if (isCallLifecycleTerminal(current)) return current
  if (isCallLifecycleTerminal(next)) return next

  const currentOrder = lifecycleOrder.get(current)
  const nextOrder = lifecycleOrder.get(next)
  if (currentOrder === undefined || nextOrder === undefined) return current

  return nextOrder >= currentOrder ? next : current
}

export const callLifecycleTelemetryStage = (state: CallLifecycleState) => `lifecycle:${state}`
