import { create } from 'zustand'

import type { CallUiState } from '../types/call.types'

interface CallStore extends CallUiState {
  patch: (patch: Partial<CallUiState>) => void
  setDurationSec: (durationSec: number) => void
  reset: () => void
}

const initialState: CallUiState = {
  phase: 'idle',
  direction: null,
  callId: null,
  conversationId: null,
  peerUserId: null,
  peerName: null,
  peerAvatarUrl: null,
  callType: null,
  muted: false,
  hasMicPermission: null,
  error: null,
  durationSec: 0,
  remoteAudioState: 'idle',
}

export const useCallStore = create<CallStore>((set) => ({
  ...initialState,

  patch: (patch) => set((state) => ({ ...state, ...patch })),

  setDurationSec: (durationSec) => set(() => ({ durationSec })),

  reset: () => set(() => initialState),
}))
