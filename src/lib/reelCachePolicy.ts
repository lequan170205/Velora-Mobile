import * as Network from 'expo-network'

import type { NetworkState } from 'expo-network'

const MB = 1024 * 1024

export interface ReelCachePolicy {
  shouldCacheVideo: boolean
  preloadCurrent: boolean
  preloadPrevious: boolean
  preloadAheadCount: number
  maxVideoCacheBytes: number | null
}

const OFFLINE_POLICY: ReelCachePolicy = {
  shouldCacheVideo: false,
  preloadCurrent: false,
  preloadPrevious: false,
  preloadAheadCount: 0,
  maxVideoCacheBytes: null,
}

const WIFI_POLICY: ReelCachePolicy = {
  shouldCacheVideo: true,
  preloadCurrent: true,
  preloadPrevious: true,
  preloadAheadCount: 2,
  maxVideoCacheBytes: 500 * MB,
}

const CELLULAR_POLICY: ReelCachePolicy = {
  shouldCacheVideo: true,
  preloadCurrent: true,
  preloadPrevious: false,
  preloadAheadCount: 1,
  maxVideoCacheBytes: 250 * MB,
}

const EXPENSIVE_POLICY: ReelCachePolicy = {
  shouldCacheVideo: true,
  preloadCurrent: true,
  preloadPrevious: false,
  preloadAheadCount: 0,
  maxVideoCacheBytes: 150 * MB,
}

const isNetworkOnline = (networkState: NetworkState | null) => {
  if (!networkState || networkState.isConnected !== true) {
    return false
  }

  if (networkState.isInternetReachable === false) {
    return false
  }

  return true
}

const getIsConnectionExpensive = (networkState: NetworkState | null) => {
  if (!networkState || typeof networkState !== 'object') {
    return false
  }

  const candidate = networkState as Record<string, unknown>

  if (typeof candidate.isConnectionExpensive === 'boolean') {
    return candidate.isConnectionExpensive
  }

  const details =
    typeof candidate.details === 'object' && candidate.details !== null
      ? (candidate.details as Record<string, unknown>)
      : null

  return typeof details?.isConnectionExpensive === 'boolean' ? details.isConnectionExpensive : false
}

export const getReelCachePolicyForNetworkState = (
  networkState: NetworkState | null,
  options: { isOnline?: boolean } = {},
): ReelCachePolicy => {
  if (options.isOnline === false) {
    return OFFLINE_POLICY
  }

  if (!isNetworkOnline(networkState)) {
    return OFFLINE_POLICY
  }

  if (getIsConnectionExpensive(networkState)) {
    return EXPENSIVE_POLICY
  }

  if (networkState?.type === Network.NetworkStateType.WIFI) {
    return WIFI_POLICY
  }

  if (networkState?.type === Network.NetworkStateType.CELLULAR) {
    return CELLULAR_POLICY
  }

  return CELLULAR_POLICY
}

export const getReelCachePolicy = async (): Promise<ReelCachePolicy> => {
  try {
    const networkState = await Network.getNetworkStateAsync()
    return getReelCachePolicyForNetworkState(networkState)
  } catch {
    return CELLULAR_POLICY
  }
}
