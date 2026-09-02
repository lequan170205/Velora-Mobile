import { useCallback } from 'react'

import { getCallState } from '../../api/call.api'
import { useCallStore } from '../../stores/callStore'
import { veloraSystemCalls } from '../systemCalls/veloraSystemCalls'

import { isBusyPhase, isRetryableCallStateError } from './callPolicies'

import type { CallSocket } from '../../types/call.types'
import type { NativeCallAction } from '../systemCalls/veloraSystemCalls'

type MutableRef<T> = { current: T }

type NativeCallActionsOptions = {
  isLoading: boolean
  isAuthenticated: boolean
  currentUserId: string | null
  username: string | null
  processingNativeActionIdsRef: MutableRef<Set<string>>
  completedNativeActionIdsRef: MutableRef<Set<string>>
  acceptingIncomingCallIdRef: MutableRef<string | null>
  outgoingStartInFlightRef: MutableRef<boolean>
  nativeActionRetryTimeoutRef: MutableRef<ReturnType<typeof setTimeout> | null>
  clearNativeActionRetryTimeout: () => void
  isCurrentCall: (callId: string) => boolean
  teardownOnce: (reason: string) => Promise<void>
  prepareIncomingCallFromState: (callState: Awaited<ReturnType<typeof getCallState>>) => boolean
  acceptIncomingCall: (source?: 'native' | 'ui') => Promise<void>
  endCall: (reason?: string) => Promise<void>
  ensureCallSocketConnected: (callId: string) => Promise<CallSocket>
  rejectIncomingCall: () => Promise<void>
}

const debugCall = (...args: Parameters<typeof console.warn>) => {
  if (__DEV__) console.warn(...args)
}

export const useNativeCallActions = ({
  isLoading,
  isAuthenticated,
  currentUserId,
  username,
  processingNativeActionIdsRef,
  completedNativeActionIdsRef,
  acceptingIncomingCallIdRef,
  outgoingStartInFlightRef,
  nativeActionRetryTimeoutRef,
  clearNativeActionRetryTimeout,
  isCurrentCall,
  teardownOnce,
  prepareIncomingCallFromState,
  acceptIncomingCall,
  endCall,
  ensureCallSocketConnected,
  rejectIncomingCall,
}: NativeCallActionsOptions) => {
  const completeNativeCallAction = useCallback(
    (actionId: string) => {
      clearNativeActionRetryTimeout()
      veloraSystemCalls.clearPendingCallAction(actionId)

      const completedActionIds = completedNativeActionIdsRef.current
      completedActionIds.add(actionId)
      while (completedActionIds.size > 64) {
        const oldestActionId = completedActionIds.values().next().value
        if (!oldestActionId) break
        completedActionIds.delete(oldestActionId)
      }
    },
    [clearNativeActionRetryTimeout, completedNativeActionIdsRef],
  )

  const processNativeCallAction = useCallback(
    async (action: NativeCallAction) => {
      if (
        completedNativeActionIdsRef.current.has(action.actionId) ||
        processingNativeActionIdsRef.current.has(action.actionId)
      ) {
        return
      }

      if (isLoading || !isAuthenticated || !currentUserId || !username?.trim()) return

      try {
        processingNativeActionIdsRef.current.add(action.actionId)

        if (action.action === 'remote_end') {
          if (isCurrentCall(action.callId)) await teardownOnce('native_remote_end')
          completeNativeCallAction(action.actionId)
          return
        }

        let callState: Awaited<ReturnType<typeof getCallState>>
        try {
          callState = await getCallState(action.callId)
        } catch (error) {
          if (isRetryableCallStateError(error)) {
            clearNativeActionRetryTimeout()
            nativeActionRetryTimeoutRef.current = setTimeout(() => {
              nativeActionRetryTimeoutRef.current = null
              const pendingAction = veloraSystemCalls.getPendingCallAction()
              if (pendingAction?.actionId === action.actionId) {
                void processNativeCallAction(pendingAction)
              }
            }, 1500)
            return
          }

          veloraSystemCalls.dismissIncomingCall(action.callId)
          completeNativeCallAction(action.actionId)
          return
        }

        if (
          callState.status === 'ended' ||
          callState.status === 'cancelled' ||
          callState.status === 'rejected'
        ) {
          if (isCurrentCall(action.callId)) {
            await teardownOnce('native_action_terminal_state')
          } else {
            veloraSystemCalls.dismissIncomingCall(action.callId)
          }
          completeNativeCallAction(action.actionId)
          return
        }

        const hasConflictingCall = () => {
          const activeState = useCallStore.getState()
          return (
            (outgoingStartInFlightRef.current || isBusyPhase(activeState.phase)) &&
            activeState.callId !== action.callId
          )
        }
        if (hasConflictingCall()) {
          veloraSystemCalls.dismissIncomingCall(action.callId)
          completeNativeCallAction(action.actionId)
          return
        }

        if (action.action === 'answer') {
          if (callState.status !== 'initiated' && callState.status !== 'ringing') {
            veloraSystemCalls.dismissIncomingCall(action.callId)
            completeNativeCallAction(action.actionId)
            return
          }

          if (acceptingIncomingCallIdRef.current === action.callId) {
            completeNativeCallAction(action.actionId)
            return
          }

          if (prepareIncomingCallFromState(callState)) await acceptIncomingCall('native')
          completeNativeCallAction(action.actionId)
          return
        }

        if (action.action === 'end') {
          const state = useCallStore.getState()
          if (state.callId === action.callId && isBusyPhase(state.phase)) {
            await endCall('ended')
          } else if (callState.status === 'active') {
            const socket = await ensureCallSocketConnected(action.callId)
            if (hasConflictingCall()) {
              veloraSystemCalls.dismissIncomingCall(action.callId)
              completeNativeCallAction(action.actionId)
              return
            }
            socket.emit('leave_call', { callId: action.callId, reason: 'ended' })
            await teardownOnce('native_end_call')
          } else {
            veloraSystemCalls.dismissIncomingCall(action.callId)
          }
          completeNativeCallAction(action.actionId)
          return
        }

        if (callState.status === 'initiated' || callState.status === 'ringing') {
          prepareIncomingCallFromState(callState)
          await rejectIncomingCall()
        } else {
          veloraSystemCalls.dismissIncomingCall(action.callId)
        }
        completeNativeCallAction(action.actionId)
      } catch (error) {
        console.warn(
          '[Call] Failed to process native call action',
          JSON.stringify({
            callId: action.callId,
            action: action.action,
            actionId: action.actionId,
            error: error instanceof Error ? error.message : 'unknown_error',
          }),
        )
      } finally {
        processingNativeActionIdsRef.current.delete(action.actionId)
      }
    },
    [
      acceptIncomingCall,
      acceptingIncomingCallIdRef,
      clearNativeActionRetryTimeout,
      completeNativeCallAction,
      completedNativeActionIdsRef,
      currentUserId,
      endCall,
      ensureCallSocketConnected,
      isAuthenticated,
      isCurrentCall,
      isLoading,
      nativeActionRetryTimeoutRef,
      outgoingStartInFlightRef,
      prepareIncomingCallFromState,
      processingNativeActionIdsRef,
      rejectIncomingCall,
      teardownOnce,
      username,
    ],
  )

  const processPendingNativeCallAction = useCallback(
    (source: 'auth_ready' | 'app_resume') => {
      const pendingAction = veloraSystemCalls.getPendingCallAction()
      if (!pendingAction) return

      debugCall(
        '[Call] pending_native_action_replayed',
        JSON.stringify({
          source,
          callId: pendingAction.callId,
          action: pendingAction.action,
          actionId: pendingAction.actionId,
        }),
      )
      void processNativeCallAction(pendingAction)
    },
    [processNativeCallAction],
  )

  return { processNativeCallAction, processPendingNativeCallAction }
}
