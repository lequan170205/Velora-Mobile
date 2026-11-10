/**
 * The backend emits `bot_reply_failed` to a conversation room when it stored the
 * user's message but could not produce an AI reply. Payload shape (conversation-service
 * `ChatGateway.emitBotReplyFailure`):
 *
 *   { conversationId, userMessageId, clientMessageId,
 *     error: { code, message, retryAfterSeconds? } }
 *
 * `RATE_LIMITED` means the user's AI budget is spent; `AI_BUSY` means the shared model server is saturated.
 * For both, `retryAfterSeconds` says when a retry is likely to work.
 */

export type BotReplyFailureCode =
  'AI_UNAVAILABLE' | 'AI_BUSY' | 'NO_CONTENT' | 'RATE_LIMITED' | 'UNKNOWN'

export interface BotReplyFailure {
  conversationId: string
  code: BotReplyFailureCode
  /** Server-authored text. Used only for codes this client does not know. */
  serverMessage?: string
  retryAfterSeconds?: number
}

const KNOWN_CODES: readonly BotReplyFailureCode[] = [
  'AI_UNAVAILABLE',
  'AI_BUSY',
  'NO_CONTENT',
  'RATE_LIMITED',
  'UNKNOWN',
]
const MAX_SERVER_MESSAGE_CHARS = 200
const MAX_RETRY_AFTER_SECONDS = 60 * 60

const getTrimmedString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

export const normalizeBotReplyFailurePayload = (value: unknown): BotReplyFailure | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const payload = value as Record<string, unknown>
  const conversationId = getTrimmedString(payload.conversationId)
  const error = payload.error
  if (!conversationId || !error || typeof error !== 'object') {
    return null
  }

  const { code, message, retryAfterSeconds } = error as Record<string, unknown>
  const normalizedCode = KNOWN_CODES.find((knownCode) => knownCode === code) ?? 'UNKNOWN'
  const serverMessage = getTrimmedString(message)?.slice(0, MAX_SERVER_MESSAGE_CHARS)
  const retryAfter =
    typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds)
      ? Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil(retryAfterSeconds)))
      : undefined

  return {
    conversationId,
    code: normalizedCode,
    ...(serverMessage ? { serverMessage } : {}),
    ...(retryAfter ? { retryAfterSeconds: retryAfter } : {}),
  }
}

const formatWait = (seconds: number) => {
  if (seconds < 60) {
    return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
  }

  const minutes = Math.ceil(seconds / 60)
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}

/** User-facing text. Known codes use client wording; an unrecognised code falls back to the server's. */
export const describeBotReplyFailure = (failure: BotReplyFailure): string => {
  switch (failure.code) {
    case 'RATE_LIMITED':
      return failure.retryAfterSeconds
        ? `You're asking Velora AI too quickly. Please try again in ${formatWait(failure.retryAfterSeconds)}.`
        : "You're asking Velora AI too quickly. Please wait a moment and try again."
    case 'AI_BUSY':
      // The shared model server is saturated; unlike RATE_LIMITED this is not the user's doing.
      return failure.retryAfterSeconds
        ? `Velora AI is busy right now. Please try again in ${formatWait(failure.retryAfterSeconds)}.`
        : 'Velora AI is busy right now. Please try again in a moment.'
    case 'NO_CONTENT':
      return 'No relevant video content found for this query.'
    case 'AI_UNAVAILABLE':
      return 'Velora AI is temporarily unavailable. Please try again.'
    default:
      return failure.serverMessage ?? 'Velora AI could not answer that. Please try again.'
  }
}
