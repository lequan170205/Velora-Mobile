import { useEffect } from 'react'

import { prewarmCallSocketCredentials } from '../lib/call/callSocket'
import { veloraSystemCalls } from '../lib/systemCalls/veloraSystemCalls'
import { useAuthStore } from '../stores/authStore'

import type { NativeCallAction } from '../lib/systemCalls/veloraSystemCalls'

type IncomingCallPrewarmBridgeProps = {
  onPendingCallIntentChange: (hasPendingCallIntent: boolean) => void
}

/**
 * Starts only the cold-path work required to replay a persisted native action.
 * It deliberately owns no call UI, media, or long-lived socket connection.
 */
export function IncomingCallPrewarmBridge({
  onPendingCallIntentChange,
}: IncomingCallPrewarmBridgeProps) {
  useEffect(() => {
    let isMounted = true
    let pollInterval: ReturnType<typeof setInterval> | null = null
    const prewarmedActionIds = new Set<string>()

    const prewarmCallIntent = (action: NativeCallAction | null) => {
      if (
        !action ||
        (action.action !== 'answer' && action.action !== 'resume') ||
        prewarmedActionIds.has(action.actionId)
      ) {
        return
      }
      prewarmedActionIds.add(action.actionId)

      void useAuthStore
        .getState()
        .hydrateAuth({ silent: true })
        .then(() => {
          const auth = useAuthStore.getState()
          if (!auth.isAuthenticated || !auth.user?.id) return
          if (action.accountId && action.accountId !== auth.user.id) return
          return prewarmCallSocketCredentials(auth.user.id)
        })
        .catch(() => undefined)
    }

    const refreshPendingIntent = () => {
      const action = veloraSystemCalls.getPendingCallAction()
      if (!isMounted) return

      onPendingCallIntentChange(Boolean(action))
      prewarmCallIntent(action)

      if (action && !pollInterval) {
        pollInterval = setInterval(refreshPendingIntent, 1_000)
      } else if (!action && pollInterval) {
        clearInterval(pollInterval)
        pollInterval = null
      }
    }

    refreshPendingIntent()
    const subscription = veloraSystemCalls.addCallActionListener(() => {
      refreshPendingIntent()
    })

    return () => {
      isMounted = false
      subscription.remove()
      if (pollInterval) clearInterval(pollInterval)
    }
  }, [onPendingCallIntentChange])

  return null
}
