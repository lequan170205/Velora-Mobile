import { requireOptionalNativeModule } from 'expo'
import * as Device from 'expo-device'
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

export type NativeCallAction =
  | (NativeCallPayload & {
      action: 'answer' | 'reject' | 'end'
      actionId: string
      callUuid?: string
      reason?: string
    })
  | {
      action: 'remote_end'
      actionId: string
      callId: string
      callUuid?: string
      reason?: string
      status?: 'active' | 'rejected' | 'ended' | 'cancelled'
      at?: string
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

export type NativeOutgoingCallPayload = {
  callId: string
  conversationId: string
  peerName: string
  callType: CallType
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
  registerOutgoingCall: (payload: NativeOutgoingCallPayload) => Promise<CallKitTransactionResult>
  setCallActive: (callId: string) => boolean
  setCallType: (callId: string, callType: CallType) => boolean
  setSpeakerEnabled: (enabled: boolean) => boolean
  endCall: (callId: string) => Promise<CallKitTransactionResult>
  dismissIncomingCall: (callId: string) => Promise<CallKitTransactionResult>
  activateSimulatorAudioSession: (callId: string) => boolean
  deactivateSimulatorAudioSession: (callId: string) => boolean
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
const isIosSimulator = Platform.OS === 'ios' && !Device.isDevice

const simulatorCallResult = (callId: string): Promise<CallKitTransactionResult> =>
  Promise.resolve({
    success: true,
    callId,
    callUuid: null,
    errorCode: null,
    errorMessage: null,
  })

export const veloraSystemCalls = {
  isAvailable: Boolean(nativeModule),
  isIosSimulator,
  usesNativeCallUi: Boolean(nativeModule) && !isIosSimulator,

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
    if (isIosSimulator) return null
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
    if (isIosSimulator) return simulatorCallResult(payload.callId)
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

  registerOutgoingCall(payload: NativeOutgoingCallPayload): Promise<CallKitTransactionResult> {
    if (isIosSimulator) return simulatorCallResult(payload.callId)
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
    if (isIosSimulator) return true
    return nativeModule?.setCallActive?.(callId) ?? false
  },

  setCallType(callId: string, callType: CallType) {
    if (isIosSimulator) return true
    return nativeModule?.setCallType?.(callId, callType) ?? false
  },

  setSpeakerEnabled(enabled: boolean) {
    return nativeModule?.setSpeakerEnabled?.(enabled) ?? false
  },

  endCall(callId: string): Promise<CallKitTransactionResult> {
    if (isIosSimulator) {
      nativeModule?.deactivateSimulatorAudioSession?.(callId)
      return simulatorCallResult(callId)
    }
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
    if (isIosSimulator) {
      nativeModule?.deactivateSimulatorAudioSession?.(callId)
      return simulatorCallResult(callId)
    }
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

  activateSimulatorAudioSession(callId: string) {
    if (!isIosSimulator) return true
    return nativeModule?.activateSimulatorAudioSession?.(callId) ?? false
  },

  deactivateSimulatorAudioSession(callId: string) {
    if (!isIosSimulator) return true
    return nativeModule?.deactivateSimulatorAudioSession?.(callId) ?? false
  },

  addCallActionListener(listener: (event: NativeCallAction) => void) {
    if (isIosSimulator || !nativeModule?.addListener) {
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
