import { useEffect } from 'react'

type RingbackSound = {
  stopAsync: () => Promise<unknown>
  unloadAsync: () => Promise<unknown>
}
type ExpoAv = {
  Audio: {
    Sound: {
      createAsync: (
        source: number,
        status: { isLooping: boolean; volume: number; shouldPlay: boolean },
      ) => Promise<{ sound: RingbackSound }>
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const RINGBACK_SOURCE = require('../../../assets/sounds/ringback.wav') as number

let expoAv: ExpoAv | null | undefined
const getExpoAv = () => {
  if (expoAv !== undefined) return expoAv
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    expoAv = require('expo-av') as ExpoAv
  } catch {
    expoAv = null
  }
  return expoAv
}

/**
 * Plays the ringback tone (the "tu... tu..." the caller hears) while `active` is true: the callee's device
 * is ringing and nobody has answered yet. It never changes the audio session; if the sound cannot load, the call carries on silently.
 */
export function useRingbackTone(active: boolean) {
  useEffect(() => {
    if (!active) return
    const av = getExpoAv()
    if (!av) return

    let cancelled = false
    let sound: RingbackSound | null = null
    void av.Audio.Sound.createAsync(RINGBACK_SOURCE, {
      isLooping: true,
      volume: 0.6,
      shouldPlay: true,
    })
      .then((created) => {
        if (cancelled) {
          void created.sound.unloadAsync().catch(() => undefined)
          return
        }
        sound = created.sound
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
      const current = sound
      sound = null
      if (current) {
        void current
          .stopAsync()
          .catch(() => undefined)
          .then(() => current.unloadAsync())
          .catch(() => undefined)
      }
    }
  }, [active])
}
