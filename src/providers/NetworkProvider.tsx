import { onlineManager } from '@tanstack/react-query'
import * as Network from 'expo-network'
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

import type { NetworkState } from 'expo-network'

onlineManager.setOnline(false)

type NetworkContextValue = {
  isOnline: boolean
  isNetworkResolved: boolean
  networkState: NetworkState | null
}

const NetworkContext = createContext<NetworkContextValue>({
  isOnline: false,
  isNetworkResolved: false,
  networkState: null,
})

const isNetworkOnline = (networkState: NetworkState | null) => {
  if (!networkState || networkState.isConnected !== true) {
    return false
  }

  if (networkState.isInternetReachable === false) {
    return false
  }

  return true
}

export const useNetworkStatus = () => useContext(NetworkContext)

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [networkState, setNetworkState] = useState<NetworkState | null>(null)
  const [isNetworkResolved, setIsNetworkResolved] = useState(false)

  useEffect(() => {
    onlineManager.setOnline(false)

    const applyNetworkState = (nextNetworkState: NetworkState) => {
      setNetworkState(nextNetworkState)
      setIsNetworkResolved(true)
      onlineManager.setOnline(isNetworkOnline(nextNetworkState))
    }

    void Network.getNetworkStateAsync()
      .then(applyNetworkState)
      .catch((error) => {
        console.warn('[Network] Failed to read initial network state', error)
        setIsNetworkResolved(true)
        onlineManager.setOnline(false)
      })

    const subscription = Network.addNetworkStateListener(applyNetworkState)

    return () => {
      subscription.remove()
    }
  }, [])

  const value = useMemo(
    () => ({
      isOnline: isNetworkResolved && isNetworkOnline(networkState),
      isNetworkResolved,
      networkState,
    }),
    [isNetworkResolved, networkState],
  )

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
}
