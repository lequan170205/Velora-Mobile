import * as SecureStore from 'expo-secure-store'

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
}

// ponytail: Per-call keys avoid a read/delete race with the next call. A cleanup index
// is only worth adding if abandoned keys from process crashes become measurable.
const keyFor = (accountId: string, callId: string) => {
  if (!/^[a-zA-Z0-9-]+$/.test(accountId) || !/^[a-zA-Z0-9-]+$/.test(callId)) {
    throw new Error('Invalid group call identity')
  }
  return `velora.call.group-winner.${accountId}.${callId}`
}

export const groupWinnerAction = {
  save: (accountId: string, callId: string, actionId: string) =>
    SecureStore.setItemAsync(keyFor(accountId, callId), actionId, options),
  load: (accountId: string, callId: string) =>
    SecureStore.getItemAsync(keyFor(accountId, callId), options),
  clear: (accountId: string, callId: string) =>
    SecureStore.deleteItemAsync(keyFor(accountId, callId), options),
}
