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
  callUuid?: string
  reason?: string
}

export type AudioSessionActivatedEvent = {
  at: string
  timestampMs: number
  category: string
  mode: string
}

export type AudioSessionConfiguredEvent = {
  at: string
  timestampMs: number
  category: string
  mode: string
  outputRouteTypes: string[]
  inputRouteTypes: string[]
  forcedSpeaker: boolean
  errorCode?: string
  routeErrorCode?: string
}

export type AudioSessionConfigurationState = {
  configured: boolean
  category?: string
  mode?: string
  outputRouteTypes?: string[]
  inputRouteTypes?: string[]
  forcedSpeaker?: boolean
  errorCode?: string
  routeErrorCode?: string
}

export type NativeAudioSessionState = {
  isActivated: boolean
  isAudioEnabled: boolean
  activationSequence: number
  activatedAt?: number
  deactivatedAt?: number
  category?: string
  mode?: string
  inputRouteTypes: string[]
  outputRouteTypes: string[]
  forcedSpeaker?: boolean
  callUuid?: string
  errorCode?: string
}

export type VoipRegistrationState = {
  token: string | null
  bundleId: string | null
  apnsEnvironment: 'development' | 'production' | null
  updatedAt: string | null
  invalidatedAt: string | null
  invalidatedToken?: string | null
}

export type CallKitTransactionResult = {
  success: boolean
  callId: string | null
  callUuid: string | null
  errorCode: string | null
  errorMessage: string | null
}

type VeloraSystemCallsModule = {
  setAuthenticatedUserId: (userId?: string | null) => void
  getVoipRegistrationState: () => VoipRegistrationState
  getVoipToken: () => string | null
  getPendingCallAction: () => NativeCallAction | null
  getAudioSessionConfigurationState: () => AudioSessionConfigurationState
  getNativeAudioSessionState: () => Promise<NativeAudioSessionState>
  clearPendingCallAction: (actionId?: string | null) => void
  presentIncomingCall: (payload: NativeCallPayload) => Promise<CallKitTransactionResult>
  registerOutgoingCall: (payload: {
    callId: string
    conversationId: string
    peerName: string
  }) => Promise<CallKitTransactionResult>
  setCallActive: (callId: string) => boolean
  setSpeakerEnabled: (enabled: boolean) => boolean
  endCall: (callId: string) => Promise<CallKitTransactionResult>
  dismissIncomingCall: (callId: string) => Promise<CallKitTransactionResult>
}

type VeloraSystemCallsNativeModule = Partial<VeloraSystemCallsModule> & {
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
    nativeModule?.setAuthenticatedUserId?.(userId ?? null)
  },

  getVoipRegistrationState(): VoipRegistrationState {
    return (
      nativeModule?.getVoipRegistrationState?.() ?? {
        token: null,
        bundleId: null,
        apnsEnvironment: null,
        updatedAt: null,
        invalidatedAt: null,
        invalidatedToken: null,
      }
    )
  },

  getVoipToken() {
    return nativeModule?.getVoipToken?.() ?? null
  },

  getPendingCallAction() {
    return nativeModule?.getPendingCallAction?.() ?? null
  },

  getAudioSessionConfigurationState() {
    return nativeModule?.getAudioSessionConfigurationState?.() ?? { configured: false }
  },

  getNativeAudioSessionState(): Promise<NativeAudioSessionState> {
    const fallbackState: NativeAudioSessionState = {
      isActivated: false,
      isAudioEnabled: false,
      activationSequence: 0,
      inputRouteTypes: [],
      outputRouteTypes: [],
    }

    if (Platform.OS !== 'ios' || typeof nativeModule?.getNativeAudioSessionState !== 'function') {
      return Promise.resolve(fallbackState)
    }

    return nativeModule.getNativeAudioSessionState()
  },

  clearPendingCallAction(actionId?: string | null) {
    nativeModule?.clearPendingCallAction?.(actionId ?? null)
  },

  presentIncomingCall(payload: NativeCallPayload): Promise<CallKitTransactionResult> {
    return (
      nativeModule?.presentIncomingCall?.(payload) ??
      Promise.resolve({
        success: false,
        callId: payload.callId,
        callUuid: null,
        errorCode: 'native_module_unavailable',
        errorMessage: 'VeloraSystemCalls native module is unavailable.',
      })
    )
  },

  registerOutgoingCall(payload: {
    callId: string
    conversationId: string
    peerName: string
  }): Promise<CallKitTransactionResult> {
    return (
      nativeModule?.registerOutgoingCall?.(payload) ??
      Promise.resolve({
        success: false,
        callId: payload.callId,
        callUuid: null,
        errorCode: 'native_module_unavailable',
        errorMessage: 'VeloraSystemCalls native module is unavailable.',
      })
    )
  },

  setCallActive(callId: string) {
    return nativeModule?.setCallActive?.(callId) ?? false
  },

  setSpeakerEnabled(enabled: boolean) {
    return nativeModule?.setSpeakerEnabled?.(enabled) ?? false
  },

  endCall(callId: string): Promise<CallKitTransactionResult> {
    return (
      nativeModule?.endCall?.(callId) ??
      Promise.resolve({
        success: false,
        callId,
        callUuid: null,
        errorCode: 'native_module_unavailable',
        errorMessage: 'VeloraSystemCalls native module is unavailable.',
      })
    )
  },

  dismissIncomingCall(callId: string): Promise<CallKitTransactionResult> {
    return (
      nativeModule?.dismissIncomingCall?.(callId) ??
      Promise.resolve({
        success: false,
        callId,
        callUuid: null,
        errorCode: 'native_module_unavailable',
        errorMessage: 'VeloraSystemCalls native module is unavailable.',
      })
    )
  },

  addCallActionListener(listener: (event: NativeCallAction) => void) {
    if (!nativeModule?.addListener) {
      return { remove: () => undefined }
    }

    return nativeModule.addListener('onCallAction', (event) => {
      listener(event as NativeCallAction)
    })
  },

  addVoipTokenListener(listener: (event: VoipRegistrationState) => void) {
    if (!nativeModule?.addListener || Platform.OS !== 'ios') {
      return { remove: () => undefined }
    }

    return nativeModule.addListener('onVoipTokenUpdated', (event) => {
      listener(event as VoipRegistrationState)
    })
  },

  addAudioSessionActivatedListener(listener: (event: AudioSessionActivatedEvent) => void) {
    if (!nativeModule?.addListener || Platform.OS !== 'ios') {
      return { remove: () => undefined }
    }

    return nativeModule.addListener('onAudioSessionActivated', (event) => {
      listener(event as AudioSessionActivatedEvent)
    })
  },

  addAudioSessionConfiguredListener(listener: (event: AudioSessionConfiguredEvent) => void) {
    if (!nativeModule?.addListener || Platform.OS !== 'ios') {
      return { remove: () => undefined }
    }

    return nativeModule.addListener('onAudioSessionConfigured', (event) => {
      listener(event as AudioSessionConfiguredEvent)
    })
  },
}
