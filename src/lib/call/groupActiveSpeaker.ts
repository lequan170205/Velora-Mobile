import type { CallUiState, GroupActiveSpeakerPayload } from '../../types/call.types'

// Three missed 500ms SFU samples remove the highlight, including lost silence packets.
export const GROUP_SPEAKER_TTL_MS = 1500

export function getVisibleGroupSpeakerId(
  state: CallUiState,
  currentUserId: string | null | undefined,
  now = Date.now(),
): string | null {
  const speaker = state.groupActiveSpeaker
  if (
    !state.isGroupCall ||
    state.phase !== 'active' ||
    !speaker ||
    speaker.expiresAt <= now ||
    !state.groupParticipantIds.includes(speaker.userId) ||
    state.groupReconnectingUserIds.includes(speaker.userId)
  )
    return null
  if (speaker.userId === currentUserId)
    return !state.muted && !state.groupMicSyncError ? speaker.userId : null
  const mic = state.groupMicStates[speaker.userId]
  return mic?.enabled === true &&
    mic.producerId === speaker.producerId &&
    mic.revision === speaker.micRevision
    ? speaker.userId
    : null
}

export function getGroupSpeakerPatch(
  state: CallUiState,
  payload: GroupActiveSpeakerPayload,
  currentUserId: string | null,
  localProducerId: string | null,
  now = Date.now(),
): Partial<CallUiState> | null {
  if (
    !payload ||
    !state.isGroupCall ||
    state.phase !== 'active' ||
    state.callId !== payload.callId ||
    !Number.isSafeInteger(payload.revision) ||
    payload.revision < 1 ||
    payload.revision <= state.groupSpeakerRevision
  )
    return null
  const speaker = payload.speaker
  const valid =
    speaker &&
    typeof speaker.userId === 'string' &&
    speaker.userId.length > 0 &&
    speaker.userId.length <= 128 &&
    typeof speaker.producerId === 'string' &&
    speaker.producerId.length > 0 &&
    speaker.producerId.length <= 128 &&
    Number.isSafeInteger(speaker.micRevision) &&
    speaker.micRevision >= 0 &&
    (speaker.userId !== currentUserId || speaker.producerId === localProducerId)
  const candidate = valid
    ? {
        userId: speaker.userId,
        producerId: speaker.producerId,
        micRevision: speaker.micRevision,
        expiresAt: now + GROUP_SPEAKER_TTL_MS,
      }
    : null
  return {
    groupSpeakerRevision: payload.revision,
    groupActiveSpeaker: getVisibleGroupSpeakerId(
      { ...state, groupActiveSpeaker: candidate },
      currentUserId,
      now,
    )
      ? candidate
      : null,
  }
}
