import { requireOptionalNativeModule } from 'expo'
import { Platform } from 'react-native'

import type { CallType } from '../../types/call.types'

export type NativeCallPayload = {
  type: 'INCOMING_CALL'
  callId: string
  conversationId: string
  initiatorId: string
  targetUserId: string
  recipientUserId: string
  callType: CallType
  initiatorDisplayName: string
  initiatorAvatarUrl?: string
  ringTimeoutMs: number
  expiresAt: string
}

export type NativeCallAction = NativeCallPayload & {
  action: 'answer' | 'reject' | 'end'
  actionId: string
}

type VeloraSystemCallsModule = {
  setAuthenticatedUserId: (userId?: string | null) => void
  getVoipToken: () => string | null
  getPendingCallAction: () => NativeCallAction | null
  clearPendingCallAction: (actionId?: string | null) => void
  presentIncomingCall: (payload: NativeCallPayload) => void
  registerOutgoingCall: (payload: {
    callId: string
    conversationId: string
    peerName: string
  }) => void
  setCallActive: (callId: string) => void
  endCall: (callId: string) => void
  dismissIncomingCall: (callId: string) => void
}

type VeloraSystemCallsNativeModule = VeloraSystemCallsModule & {
  addListener?: (
    eventName: string,
    listener: (event: unknown) => void,
  ) => {
    remove: () => void
  }
}

const nativeModule = requireOptionalNativeModule<VeloraSystemCallsNativeModule>('VeloraSystemCalls')

export const veloraSystemCalls = {
  isAvailable: Boolean(nativeModule),

  setAuthenticatedUserId(userId?: string | null) {
    nativeModule?.setAuthenticatedUserId(userId ?? null)
  },

  getVoipToken() {
    return nativeModule?.getVoipToken() ?? null
  },

  getPendingCallAction() {
    return nativeModule?.getPendingCallAction() ?? null
  },

  clearPendingCallAction(actionId?: string | null) {
    nativeModule?.clearPendingCallAction(actionId ?? null)
  },

  presentIncomingCall(payload: NativeCallPayload) {
    nativeModule?.presentIncomingCall(payload)
  },

  registerOutgoingCall(payload: { callId: string; conversationId: string; peerName: string }) {
    nativeModule?.registerOutgoingCall(payload)
  },

  setCallActive(callId: string) {
    nativeModule?.setCallActive(callId)
  },

  endCall(callId: string) {
    nativeModule?.endCall(callId)
  },

  dismissIncomingCall(callId: string) {
    nativeModule?.dismissIncomingCall(callId)
  },

  addCallActionListener(listener: (event: NativeCallAction) => void) {
    if (!nativeModule?.addListener) {
      return { remove: () => undefined }
    }

    return nativeModule.addListener('onCallAction', (event) => {
      listener(event as NativeCallAction)
    })
  },

  addVoipTokenListener(listener: (event: { token: string }) => void) {
    if (!nativeModule?.addListener || Platform.OS !== 'ios') {
      return { remove: () => undefined }
    }

    return nativeModule.addListener('onVoipTokenUpdated', (event) => {
      listener(event as { token: string })
    })
  },
}
