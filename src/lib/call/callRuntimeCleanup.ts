export type CallRuntimeTimeout = ReturnType<typeof setTimeout>
type MutableRef<T> = { current: T }

export const clearTimeoutRef = (ref: MutableRef<CallRuntimeTimeout | null>) => {
  if (!ref.current) return
  clearTimeout(ref.current)
  ref.current = null
}

export const clearTimeoutMap = (timeouts: Map<string, CallRuntimeTimeout>) => {
  for (const timeout of timeouts.values()) clearTimeout(timeout)
  timeouts.clear()
}

export const clearTimeoutMapEntry = (timeouts: Map<string, CallRuntimeTimeout>, key: string) => {
  const timeout = timeouts.get(key)
  if (!timeout) return false
  clearTimeout(timeout)
  timeouts.delete(key)
  return true
}
