import { CallSocketExceptionError } from './callSocket'

/**
 * Call diagnostics are safe to print in development builds and safe to copy
 * into a bug report. Media identifiers are redacted; bearer
 * tokens, user identifiers, SDP and RTP parameters never pass through this
 * helper.
 */
export const shortCallId = (value: string | null | undefined) => {
  if (!value) return undefined
  return 'redacted'
}

const SAFE_ERROR_CODES = new Set([
  'econnrefused',
  'econnreset',
  'etimedout',
  'http_404',
  'http_409',
  'audio_route_override_failed',
  'callkit_provider_unavailable',
  'native_answer_confirmation_timeout',
])

const normalizeCode = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return SAFE_ERROR_CODES.has(normalized) ? normalized : undefined
}

/**
 * Convert an Error to a stable category without returning its message. Native
 * WebRTC/AVAudioSession messages can contain SDK internals or user data.
 */
export const safeCallErrorCode = (error: unknown) => {
  const explicitCode = normalizeCode(
    error instanceof CallSocketExceptionError
      ? error.code
      : error && typeof error === 'object'
        ? (error as { code?: unknown }).code
        : undefined,
  )
  if (explicitCode) return explicitCode

  const message = error instanceof Error ? error.message : ''
  if (/timed out|timeout/i.test(message)) return 'timeout'
  if (/cancel/i.test(message)) return 'cancelled'
  if (/permission/i.test(message)) return 'permission_denied'
  if (/audio session/i.test(message)) return 'audio_session_error'
  if (/room|call.*(?:ended|closed|not found)|terminal/i.test(message)) {
    return 'call_terminal'
  }
  if (/producer/i.test(message)) return 'producer_error'
  if (/consumer/i.test(message)) return 'consumer_error'
  if (/transport/i.test(message)) return 'transport_error'
  if (/socket|connect|network/i.test(message)) return 'socket_error'
  return 'unknown_error'
}

export const safeCallErrorDetails = (error: unknown) => ({
  errorCode: safeCallErrorCode(error),
})
