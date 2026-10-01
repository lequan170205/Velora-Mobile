import * as SecureStore from 'expo-secure-store'

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
}

// ponytail: One JS queue serializes low-volume proof storage; use per-key queues
// only if storage contention becomes measurable. Crashed-call cleanup stays deferred.
let storageQueue = Promise.resolve()
const serial = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = storageQueue.then(operation)
  storageQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

const keyFor = (accountId: string, callId: string) => {
  if (!/^[a-zA-Z0-9-]+$/.test(accountId) || !/^[a-zA-Z0-9-]+$/.test(callId)) {
    throw new Error('Invalid group call identity')
  }
  return `velora.call.group-winner.${accountId}.${callId}`
}

export const groupWinnerAction = {
  save: (accountId: string, callId: string, actionId: string) =>
    serial(() => SecureStore.setItemAsync(keyFor(accountId, callId), actionId, options)),
  load: (accountId: string, callId: string) =>
    serial(() => SecureStore.getItemAsync(keyFor(accountId, callId), options)),
  clear: (accountId: string, callId: string, expectedActionId?: string) =>
    serial(async () => {
      const key = keyFor(accountId, callId)
      if (expectedActionId && (await SecureStore.getItemAsync(key, options)) !== expectedActionId)
        return
      await SecureStore.deleteItemAsync(key, options)
    }),
}
