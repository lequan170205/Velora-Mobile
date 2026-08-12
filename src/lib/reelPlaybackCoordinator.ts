export interface ReelPlaybackPlayer {
  pause: () => void
  play: () => void
  seekTo?: (seconds: number) => void
}

type PendingReelSeek = {
  queuedAt: number
  seconds: number
}

const PENDING_REEL_SEEK_TTL_MS = 30_000
const PENDING_REEL_SEEK_DELAY_MS = 240
const pendingReelSeeks = new Map<string, PendingReelSeek>()

export const queueReelInitialSeek = (reelId: string, seconds: number) => {
  const normalizedReelId = reelId.trim()
  if (!normalizedReelId || !Number.isFinite(seconds) || seconds < 0) {
    return
  }

  pendingReelSeeks.set(normalizedReelId, {
    queuedAt: Date.now(),
    seconds,
  })
}

const getPendingReelSeek = (reelId: string) => {
  const pendingSeek = pendingReelSeeks.get(reelId)
  if (!pendingSeek) {
    return null
  }

  if (Date.now() - pendingSeek.queuedAt > PENDING_REEL_SEEK_TTL_MS) {
    pendingReelSeeks.delete(reelId)
    return null
  }

  return pendingSeek
}

export class ReelPlaybackCoordinator {
  private readonly players = new Map<string, ReelPlaybackPlayer>()
  private readonly pendingSeekTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private desiredReelId: string | null = null
  private playingReelId: string | null = null

  register(reelId: string, player: ReelPlaybackPlayer | null) {
    const existingSeekTimer = this.pendingSeekTimers.get(reelId)
    if (existingSeekTimer) {
      clearTimeout(existingSeekTimer)
      this.pendingSeekTimers.delete(reelId)
    }

    if (!player) {
      this.players.delete(reelId)
      if (this.playingReelId === reelId) {
        this.playingReelId = null
      }
      return
    }

    this.players.set(reelId, player)
    this.schedulePendingSeek(reelId, player)

    if (this.desiredReelId === reelId && this.playingReelId !== reelId) {
      player.play()
      this.playingReelId = reelId
      return
    }

    player.pause()
  }

  transition(nextReelId: string | null) {
    const previousReelId = this.playingReelId

    if (previousReelId && previousReelId !== nextReelId) {
      this.players.get(previousReelId)?.pause()
      this.playingReelId = null
    }

    this.desiredReelId = nextReelId

    if (!nextReelId) {
      return
    }

    const nextPlayer = this.players.get(nextReelId)
    if (!nextPlayer) {
      return
    }

    this.schedulePendingSeek(nextReelId, nextPlayer)

    if (this.playingReelId !== nextReelId) {
      nextPlayer.play()
      this.playingReelId = nextReelId
    }
  }

  pauseAll() {
    this.pendingSeekTimers.forEach((timer) => clearTimeout(timer))
    this.pendingSeekTimers.clear()
    this.players.forEach((player) => player.pause())
    this.desiredReelId = null
    this.playingReelId = null
  }

  getSnapshot() {
    return {
      desiredReelId: this.desiredReelId,
      mountedPlayerIds: Array.from(this.players.keys()),
      playingReelIds: this.playingReelId ? [this.playingReelId] : [],
    }
  }

  private schedulePendingSeek(reelId: string, player: ReelPlaybackPlayer) {
    const pendingSeek = getPendingReelSeek(reelId)
    if (!pendingSeek || typeof player.seekTo !== 'function') {
      return
    }

    const existingTimer = this.pendingSeekTimers.get(reelId)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    const timer = setTimeout(() => {
      this.pendingSeekTimers.delete(reelId)

      if (this.players.get(reelId) !== player) {
        return
      }

      const latestPendingSeek = getPendingReelSeek(reelId)
      if (!latestPendingSeek || typeof player.seekTo !== 'function') {
        return
      }

      player.seekTo(latestPendingSeek.seconds)
      pendingReelSeeks.delete(reelId)
    }, PENDING_REEL_SEEK_DELAY_MS)

    this.pendingSeekTimers.set(reelId, timer)
  }
}

export const deduplicateReelsById = <T extends { id: string }>(reels: T[]) => {
  const seenReelIds = new Set<string>()
  return reels.filter((reel) => {
    if (seenReelIds.has(reel.id)) {
      return false
    }

    seenReelIds.add(reel.id)
    return true
  })
}

export const resolveReelIndexByIdentity = <T extends { id: string }>(
  reels: T[],
  activeReelId: string | null,
  fallbackIndex: number,
) => {
  if (reels.length === 0) {
    return 0
  }

  const activeIndex = activeReelId ? reels.findIndex((reel) => reel.id === activeReelId) : -1
  return Math.max(0, Math.min(reels.length - 1, activeIndex >= 0 ? activeIndex : fallbackIndex))
}

export const isCurrentReelPlayerCallback = (
  reelId: string,
  playerGeneration: number,
  current: { reelId: string; playerGeneration: number },
) => current.reelId === reelId && current.playerGeneration === playerGeneration
