import { useCallback, useEffect, useState } from 'react'

import {
  DEFAULT_REEL_SAVING_MODE_ENABLED,
  getReelSavingModePreference,
  setReelSavingModePreference,
} from '../lib/reelSavingModePreference'

interface ReelSavingModeState {
  reelSavingModeEnabled: boolean
  isReelSavingModeHydrated: boolean
}

const listeners = new Set<(state: ReelSavingModeState) => void>()

let stateVersion = 0
let hydrationPromise: Promise<void> | null = null
let currentState: ReelSavingModeState = {
  reelSavingModeEnabled: DEFAULT_REEL_SAVING_MODE_ENABLED,
  isReelSavingModeHydrated: false,
}

const emitState = () => {
  listeners.forEach((listener) => {
    listener(currentState)
  })
}

const updateState = (nextState: ReelSavingModeState) => {
  if (
    currentState.reelSavingModeEnabled === nextState.reelSavingModeEnabled &&
    currentState.isReelSavingModeHydrated === nextState.isReelSavingModeHydrated
  ) {
    return
  }

  currentState = nextState
  emitState()
}

const ensureReelSavingModeHydrated = async () => {
  if (currentState.isReelSavingModeHydrated) {
    return
  }

  if (hydrationPromise) {
    await hydrationPromise
    return
  }

  const hydrationVersion = stateVersion

  hydrationPromise = getReelSavingModePreference()
    .then((reelSavingModeEnabled) => {
      if (hydrationVersion !== stateVersion && currentState.isReelSavingModeHydrated) {
        return
      }

      updateState({
        reelSavingModeEnabled,
        isReelSavingModeHydrated: true,
      })
    })
    .catch(() => {
      if (hydrationVersion !== stateVersion && currentState.isReelSavingModeHydrated) {
        return
      }

      updateState({
        reelSavingModeEnabled: currentState.reelSavingModeEnabled,
        isReelSavingModeHydrated: true,
      })
    })
    .finally(() => {
      hydrationPromise = null
    })

  await hydrationPromise
}

const setReelSavingModeEnabledState = async (reelSavingModeEnabled: boolean) => {
  stateVersion += 1

  updateState({
    reelSavingModeEnabled,
    isReelSavingModeHydrated: true,
  })

  try {
    await setReelSavingModePreference(reelSavingModeEnabled)
  } catch (error) {
    console.warn('[Reels] Failed to persist reel saving mode', error)
  }
}

export function useReelSavingMode() {
  const [state, setState] = useState(currentState)

  useEffect(() => {
    listeners.add(setState)
    void ensureReelSavingModeHydrated()

    return () => {
      listeners.delete(setState)
    }
  }, [])

  const setReelSavingModeEnabled = useCallback((reelSavingModeEnabled: boolean) => {
    void setReelSavingModeEnabledState(reelSavingModeEnabled)
  }, [])

  return {
    reelSavingModeEnabled: state.reelSavingModeEnabled,
    isReelSavingModeHydrated: state.isReelSavingModeHydrated,
    setReelSavingModeEnabled,
  }
}
