import { onlineManager } from '@tanstack/react-query'
import * as Network from 'expo-network'
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

import type { NetworkState } from 'expo-network'

onlineManager.setOnline(false)

type NetworkContextValue = {
  isOnline: boolean
  isForceOffline: boolean
  isNetworkResolved: boolean
  networkState: NetworkState | null
  setForceOffline: React.Dispatch<React.SetStateAction<boolean>>
}

const NetworkContext = createContext<NetworkContextValue>({
  isOnline: false,
  isForceOffline: false,
  isNetworkResolved: false,
  networkState: null,
  setForceOffline: () => undefined,
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
  const [isForceOffline, setForceOffline] = useState(false)

  useEffect(() => {
    onlineManager.setOnline(false)

    const applyNetworkState = (nextNetworkState: NetworkState) => {
      setNetworkState(nextNetworkState)
      setIsNetworkResolved(true)
    }

    void Network.getNetworkStateAsync()
      .then(applyNetworkState)
      .catch((error) => {
        console.warn('[Network] Failed to read initial network state', error)
        setIsNetworkResolved(true)
      })

    const subscription = Network.addNetworkStateListener(applyNetworkState)

    return () => {
      subscription.remove()
    }
  }, [])

  const isOnline = isNetworkResolved && isNetworkOnline(networkState) && !isForceOffline

  useEffect(() => {
    onlineManager.setOnline(isOnline)
  }, [isOnline])

  const value = useMemo(
    () => ({
      isForceOffline,
      isOnline,
      isNetworkResolved,
      networkState,
      setForceOffline,
    }),
    [isForceOffline, isNetworkResolved, isOnline, networkState],
  )

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
}
