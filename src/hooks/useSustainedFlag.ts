import { useEffect, useState } from 'react'

/** True only once `value` has stayed true for `delayMs`; drops back to false at once. */
export const useSustainedFlag = (value: boolean, delayMs: number) => {
  const [sustained, setSustained] = useState(false)

  useEffect(() => {
    if (!value) {
      setSustained(false)
      return
    }

    const timeoutId = setTimeout(() => setSustained(true), delayMs)

    return () => clearTimeout(timeoutId)
  }, [delayMs, value])

  return sustained
}
