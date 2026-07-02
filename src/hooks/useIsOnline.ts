import { useCallback, useEffect, useState } from 'react'
import { AppState } from 'react-native'

import { getIsOnline } from '../lib/network'

import type { AppStateStatus } from 'react-native'

const ONLINE_CHECK_INTERVAL_MS = 5000

export function useIsOnline() {
  const [isOnline, setIsOnline] = useState(true)

  const refreshOnlineState = useCallback(async () => {
    const nextIsOnline = await getIsOnline()
    setIsOnline(nextIsOnline)
  }, [])

  useEffect(() => {
    void refreshOnlineState()

    const timer = setInterval(() => {
      void refreshOnlineState()
    }, ONLINE_CHECK_INTERVAL_MS)

    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        void refreshOnlineState()
      }
    })

    return () => {
      clearInterval(timer)
      subscription.remove()
    }
  }, [refreshOnlineState])

  return isOnline
}
