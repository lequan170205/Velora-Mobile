import { create } from 'zustand'

interface CallState {
  isActive: boolean
  callId: string | null // Thêm dòng này
  duration: number
  callerName: string
  avatarUrl: string | null
  isVideo: boolean
  timerInterval: ReturnType<typeof setInterval> | null

  startCall: (id: string, name: string, isVideo: boolean, avatar?: string) => void
  endCall: () => void
  tick: () => void
}

export const useCallStore = create<CallState>((set, get) => ({
  isActive: false,
  callId: null,
  duration: 0,
  callerName: '',
  avatarUrl: null,
  isVideo: false,
  timerInterval: null,

  startCall: (id, name, isVideo, avatar) => {
    if (get().timerInterval) clearInterval(get().timerInterval!)

    const interval = setInterval(() => {
      get().tick()
    }, 1000)

    set({
      isActive: true,
      callId: id, // Lưu lại ID
      duration: 0,
      callerName: name,
      isVideo,
      avatarUrl: avatar || null,
      timerInterval: interval,
    })
  },

  endCall: () => {
    if (get().timerInterval) clearInterval(get().timerInterval!)
    set({ isActive: false, callId: null, duration: 0, timerInterval: null })
  },

  tick: () => set((state) => ({ duration: state.duration + 1 })),
}))
