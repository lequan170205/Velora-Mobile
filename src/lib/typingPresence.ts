// Typing indicators are best-effort signals, so both ends bound them in time:
// the sender emits typing_start once per heartbeat instead of per keystroke,
// and receivers drop an indicator nobody refreshed for two heartbeats, so a
// lost typing_stop (killed app, dropped socket) cannot leave it stuck.
export const TYPING_IDLE_STOP_MS = 2000
export const TYPING_HEARTBEAT_MS = 3000
export const TYPING_INDICATOR_TTL_MS = TYPING_HEARTBEAT_MS * 2

type Timer = ReturnType<typeof setTimeout>

export const createTypingEmitter = ({
  emitStart,
  emitStop,
  now = Date.now,
}: {
  emitStart: () => void
  emitStop: () => void
  now?: () => number
}) => {
  let lastStartAt: number | null = null
  let idleTimer: Timer | null = null

  const clearIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }

  const stop = () => {
    clearIdleTimer()
    lastStartAt = null
    emitStop()
  }

  return {
    // Call on every composer change.
    onInput: (text: string) => {
      if (!text.trim()) {
        stop()
        return
      }

      const startedAt = now()
      if (lastStartAt === null || startedAt - lastStartAt >= TYPING_HEARTBEAT_MS) {
        lastStartAt = startedAt
        emitStart()
      }

      clearIdleTimer()
      idleTimer = setTimeout(stop, TYPING_IDLE_STOP_MS)
    },
    stop,
    // Forget local typing state without emitting (the caller decides).
    dispose: () => {
      clearIdleTimer()
      lastStartAt = null
    },
  }
}

export const createTypingExpiry = (
  onExpire: (conversationId: string, userId: string) => void,
  ttlMs = TYPING_INDICATOR_TTL_MS,
) => {
  const timers = new Map<string, { conversationId: string; timer: Timer }>()
  const keyOf = (conversationId: string, userId: string) => `${conversationId}\u0000${userId}`

  const cancel = (conversationId: string, userId: string) => {
    const key = keyOf(conversationId, userId)
    const entry = timers.get(key)
    if (!entry) return
    clearTimeout(entry.timer)
    timers.delete(key)
  }

  return {
    refresh: (conversationId: string, userId: string) => {
      cancel(conversationId, userId)
      const key = keyOf(conversationId, userId)
      const timer = setTimeout(() => {
        timers.delete(key)
        onExpire(conversationId, userId)
      }, ttlMs)
      timers.set(key, { conversationId, timer })
    },
    cancel,
    cancelConversation: (conversationId: string) => {
      for (const [key, entry] of timers) {
        if (entry.conversationId !== conversationId) continue
        clearTimeout(entry.timer)
        timers.delete(key)
      }
    },
  }
}
