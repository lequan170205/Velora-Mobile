/** Rate while a side of the reel is held, like the hold-to-fast-forward of other short-video apps. */
export const REEL_SPEED_BOOST_RATE = 2

// Each side takes this share of the width; the middle keeps opening the playback options.
const SIDE_ZONE_RATIO = 0.3

export type ReelTouchZone = 'left' | 'middle' | 'right'

/** Which part of the reel a touch at horizontal position `x` (0..width) landed on. */
export const getReelTouchZone = (x: number, width: number): ReelTouchZone => {
  if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) {
    return 'middle'
  }

  if (x < width * SIDE_ZONE_RATIO) return 'left'
  if (x > width * (1 - SIDE_ZONE_RATIO)) return 'right'
  return 'middle'
}

/** Holding a side only speeds the reel up when it is playing and not already at least that fast. */
export const canBoostReelSpeed = (currentSpeed: number, isPausedByUser: boolean): boolean =>
  !isPausedByUser && currentSpeed < REEL_SPEED_BOOST_RATE
