export interface ReelPlaybackPlayer {
  pause: () => void
  play: () => void
}

export class ReelPlaybackCoordinator {
  private readonly players = new Map<string, ReelPlaybackPlayer>()
  private desiredReelId: string | null = null
  private playingReelId: string | null = null

  register(reelId: string, player: ReelPlaybackPlayer | null) {
    if (!player) {
      this.players.delete(reelId)
      if (this.playingReelId === reelId) {
        this.playingReelId = null
      }
      return
    }

    this.players.set(reelId, player)

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

    if (this.playingReelId !== nextReelId) {
      nextPlayer.play()
      this.playingReelId = nextReelId
    }
  }

  pauseAll() {
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
