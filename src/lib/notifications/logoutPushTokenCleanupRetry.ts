const INITIAL_RETRY_DELAY_MS = 5_000
const MAX_RETRY_DELAY_MS = 60_000

export const getLogoutPushTokenCleanupRetryDelay = (failedAttempts: number) =>
  Math.min(INITIAL_RETRY_DELAY_MS * 2 ** Math.max(0, failedAttempts), MAX_RETRY_DELAY_MS)
