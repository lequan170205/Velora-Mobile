import { create } from 'zustand'

interface ProfileUiState {
  pendingFeedbackMessage: string | null
  clearPendingFeedbackMessage: () => void
  setPendingFeedbackMessage: (message: string) => void
}

export const useProfileUiStore = create<ProfileUiState>((set) => ({
  pendingFeedbackMessage: null,
  clearPendingFeedbackMessage: () => {
    set({ pendingFeedbackMessage: null })
  },
  setPendingFeedbackMessage: (message) => {
    set({ pendingFeedbackMessage: message })
  },
}))
