import * as Network from 'expo-network'

export const getIsOnline = async () => {
  try {
    const state = await Network.getNetworkStateAsync()

    if (state.isConnected === false) {
      return false
    }

    if (state.isInternetReachable === false) {
      return false
    }

    return true
  } catch {
    return true
  }
}
