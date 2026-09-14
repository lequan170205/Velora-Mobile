import type {
  CallType,
  LocalVideoSyncState,
  RemoteVideoState,
  VideoStateUpdatedPayload,
} from '../../types/call.types'

export type RemoteVideoProducerEntry = {
  enabled: boolean
  revision: number
  consumerReady: boolean
  closed: boolean
}

export type RemoteVideoRegistry = Map<string, RemoteVideoProducerEntry>

export type LocalVideoToggleIntent = 'activate' | 'deactivate' | 'cancel_activation'

/**
 * Resolve a camera tap from the local state machine rather than from the
 * optimistic UI bit alone. In particular, a failed automatic activation may
 * leave desiredEnabled=true while cameraEnabled is still false; that must be
 * a fresh activation attempt once the user taps again, not an implicit
 * camera-off command. An in-flight activation is cancellable and must never
 * start a second capture/producer path.
 */
export const resolveLocalVideoToggleIntent = ({
  phase,
  callType,
  cameraEnabled,
  desiredEnabled,
  confirmedEnabled,
  hasProducer,
  activationInFlight,
  socketConnected,
}: {
  phase: string
  callType: CallType | null
  cameraEnabled: boolean
  desiredEnabled: boolean
  confirmedEnabled: boolean
  hasProducer: boolean
  activationInFlight: boolean
  socketConnected: boolean
}): LocalVideoToggleIntent | 'noop' => {
  if (phase !== 'active' || callType !== 'VIDEO') return 'noop'
  if (activationInFlight && !cameraEnabled) return 'cancel_activation'
  if (!hasProducer) return 'activate'

  // If the last enable command never received an ACK while the socket is
  // healthy, the user is looking at an off UI and the tap should retry enable.
  // During a socket outage, however, the newest tap is an explicit off intent
  // that must be retained for reconnect reconciliation.
  if (desiredEnabled && !confirmedEnabled && !cameraEnabled && socketConnected) {
    return 'activate'
  }
  if (cameraEnabled || desiredEnabled) return 'deactivate'
  return 'activate'
}

/**
 * Producer ids are unique for the lifetime of a mediasoup producer. Keep a
 * tombstone after producer_closed so a delayed video_state_changed event for
 * that producer cannot recreate a stale registry entry. An authoritative
 * rejoin snapshot or a genuinely new_producer event removes the tombstone.
 */
export const isRemoteVideoProducerCurrent = (
  closedProducerIds: ReadonlySet<string>,
  producerId: string,
) => !closedProducerIds.has(producerId)

export const reconcileRemoteVideoProducerTombstones = (
  closedProducerIds: Set<string>,
  knownProducerIds: Iterable<string>,
  activeProducerIds: ReadonlySet<string>,
) => {
  for (const producerId of knownProducerIds) {
    if (!activeProducerIds.has(producerId)) closedProducerIds.add(producerId)
  }
  for (const producerId of activeProducerIds) closedProducerIds.delete(producerId)
}

/**
 * A revisioned event may only advance a producer's state. Equal revisions are
 * deliberately accepted because a duplicate notification can carry the same
 * authoritative value after a reconnect.
 */
export const shouldApplyRemoteVideoRevision = (
  currentRevision: number | undefined,
  incomingRevision: number,
  currentEnabled?: boolean,
  incomingEnabled?: boolean,
) => {
  if (currentRevision === undefined || incomingRevision > currentRevision) return true
  if (incomingRevision < currentRevision) return false

  // Equal revisions are safe duplicates only when they carry the same
  // authoritative value. A conflicting tie is invalid/stale and must not
  // revive the old last-event-wins behaviour.
  return (
    currentEnabled === undefined ||
    incomingEnabled === undefined ||
    currentEnabled === incomingEnabled
  )
}

export const deriveRemoteVideoStateFromRegistry = ({
  callType,
  snapshotReady,
  registry,
}: {
  callType: CallType | null
  snapshotReady: boolean
  registry: Iterable<RemoteVideoProducerEntry>
}): RemoteVideoState => {
  if (callType !== 'VIDEO') return 'idle'
  if (!snapshotReady) return 'waiting'

  let hasEnabledProducer = false
  for (const producer of registry) {
    if (producer.closed || !producer.enabled) continue
    hasEnabledProducer = true
    if (producer.consumerReady) return 'connected'
  }

  return hasEnabledProducer ? 'waiting' : 'off'
}

export const applyLocalVideoAck = (
  state: LocalVideoSyncState,
  acknowledgement: VideoStateUpdatedPayload,
  actionId: string,
  requestedRevision: number,
) => {
  const isLatestAction = state.pendingActionId === actionId
  const nextState: LocalVideoSyncState = { ...state }

  if (acknowledgement.revision >= state.revision) {
    nextState.revision = acknowledgement.revision
    nextState.confirmedEnabled = acknowledgement.enabled
  }
  if (isLatestAction) nextState.pendingActionId = null
  if (
    isLatestAction &&
    acknowledgement.status === 'stale' &&
    acknowledgement.revision >= requestedRevision
  ) {
    nextState.desiredEnabled = acknowledgement.enabled
  }

  return {
    state: nextState,
    isLatestAction,
    accepted: acknowledgement.status !== 'stale',
    staleAuthoritativeEnabled:
      isLatestAction && acknowledgement.status === 'stale' ? acknowledgement.enabled : undefined,
  }
}

export const boundedRetryDelay = (attempt: number, baseMs: number, maxMs: number) =>
  Math.min(baseMs * 2 ** Math.max(0, attempt), maxMs)
