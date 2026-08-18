type ChatTimelineMode = 'latest' | 'anchor'
type ChatTimelineSource = 'local' | 'remote' | 'cache' | 'ui'
type ChatTimelineTrigger =
  | 'edge'
  | 'bottom'
  | 'reply'
  | 'return-latest'
  | 'own-send'
  | 'background-sync'
  | 'retry'
  | 'unknown'

export type ChatTimelineDiagnosticEvent = {
  conversationId: string
  event: string
  mode: ChatTimelineMode
  cursor?: string | null
  source?: ChatTimelineSource
  trigger?: ChatTimelineTrigger
  transactionId?: string
  count?: number
  details?: Record<string, unknown>
}

let nextTimelineTransactionSequence = 0

export const createChatTimelineTransactionId = (prefix: string) => {
  nextTimelineTransactionSequence += 1
  return `${prefix}:${Date.now()}:${nextTimelineTransactionSequence}`
}

export const traceChatTimeline = (event: ChatTimelineDiagnosticEvent) => {
  if (!__DEV__) {
    return
  }

  const { details, ...summary } = event

  // Intentionally never include message content in timeline diagnostics.
  // eslint-disable-next-line no-console
  console.log('[ChatTimeline]', {
    ...summary,
    ...(details ? { details } : {}),
  })
}
