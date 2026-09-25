import { useCallback } from 'react'

import { getCallState } from '../../api/call.api'
import { useAuthStore } from '../../stores/authStore'
import { useCallStore } from '../../stores/callStore'
import { veloraSystemCalls } from '../systemCalls/veloraSystemCalls'

import { safeCallErrorCode, shortCallId } from './callDebug'
import { isBusyPhase, isRetryableCallStateError } from './callPolicies'
import { emitAndWaitForEvent } from './callSocket'
import { groupWinnerAction } from './groupWinnerAction'

import type { CallSocket } from '../../types/call.types'
import type { NativeCallAction, NativeCallPayload } from '../systemCalls/veloraSystemCalls'

type MutableRef<T> = { current: T }

type NativeCallActionsOptions = {
  isLoading: boolean
  isAuthenticated: boolean
  currentUserId: string | null
  processingNativeActionIdsRef: MutableRef<Set<string>>
  completedNativeActionIdsRef: MutableRef<Set<string>>
  acceptingIncomingCallIdRef: MutableRef<string | null>
  outgoingStartInFlightRef: MutableRef<boolean>
  nativeActionRetryTimeoutRef: MutableRef<ReturnType<typeof setTimeout> | null>
  clearNativeActionRetryTimeout: () => void
  isCurrentCall: (callId: string) => boolean
  teardownOnce: (reason: string) => Promise<void>
  prepareIncomingCallFromState: (callState: Awaited<ReturnType<typeof getCallState>>) => boolean
  prepareIncomingCallFromPayload: (payload: NativeCallPayload) => boolean
  resumeAcceptedCall: (
    callState: Awaited<ReturnType<typeof getCallState>>,
    answerActionId?: string,
  ) => Promise<boolean>
  acceptIncomingCall: (source?: 'native' | 'ui', actionId?: string) => Promise<void>
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
  processingNativeActionIdsRef,
  completedNativeActionIdsRef,
  acceptingIncomingCallIdRef,
  outgoingStartInFlightRef,
  nativeActionRetryTimeoutRef,
  clearNativeActionRetryTimeout,
  isCurrentCall,
  teardownOnce,
  prepareIncomingCallFromState,
  prepareIncomingCallFromPayload,
  resumeAcceptedCall,
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

      // A native terminal update is cleanup-only. It must win even while the
      // JS app is cold-starting or authentication is still hydrating; waiting
      // for credentials here can leave an obsolete CallKit surface visible.
      if (action.action === 'remote_end') {
        processingNativeActionIdsRef.current.add(action.actionId)
        try {
          const liveUserId = useAuthStore.getState().user?.id
          const belongsToCurrentAccount =
            !action.accountId || !liveUserId || action.accountId === liveUserId

          // A journaled terminal action from another signed-in account may
          // dismiss its own stale native UI, but must never tear down an
          // unrelated in-app call for the current account.
          veloraSystemCalls.dismissIncomingCall(action.callId)
          if (belongsToCurrentAccount && isCurrentCall(action.callId)) {
            await teardownOnce('native_remote_end')
          }
          completeNativeCallAction(action.actionId)
        } finally {
          processingNativeActionIdsRef.current.delete(action.actionId)
        }
        return
      }

      if (isLoading || !isAuthenticated || !currentUserId) return

      try {
        processingNativeActionIdsRef.current.add(action.actionId)

        // `currentUserId` belongs to the render that started this async action.
        // Re-read auth after network boundaries so an account switch cannot let
        // a stale native action prepare media or authenticate a call socket.
        const isActionAccountCurrent = () => {
          const liveAuth = useAuthStore.getState()
          const liveUserId = liveAuth.user?.id

          return Boolean(
            liveAuth.isAuthenticated &&
            liveUserId &&
            liveUserId === currentUserId &&
            (!action.accountId || action.accountId === liveUserId),
          )
        }
        const abandonActionForAccountChange = async () => {
          if (action.action === 'answer') {
            veloraSystemCalls.completePendingAnswer(action.actionId, false, 'account_changed')
          }
          veloraSystemCalls.dismissIncomingCall(action.callId)
          if (isCurrentCall(action.callId)) {
            await teardownOnce('native_action_account_changed')
          }
          completeNativeCallAction(action.actionId)
        }

        if (action.accountId && action.accountId !== currentUserId) {
          await abandonActionForAccountChange()
          return
        }

        if (!isActionAccountCurrent()) {
          await abandonActionForAccountChange()
          return
        }

        const hasConflictingCall = () => {
          const activeState = useCallStore.getState()
          return (
            (outgoingStartInFlightRef.current || isBusyPhase(activeState.phase)) &&
            activeState.callId !== action.callId
          )
        }

        const hasCurrentCallSetup = () => {
          const activeState = useCallStore.getState()
          return (
            activeState.callId === action.callId &&
            (activeState.phase === 'connecting' ||
              activeState.phase === 'active' ||
              activeState.phase === 'reconnecting' ||
              activeState.phase === 'ending')
          )
        }

        if (action.action === 'resume') {
          // CallKit may journal `resume` immediately after `answer` during a
          // cold launch. The answer path already owns media setup for this
          // call; starting a second rejoin here races transport creation and
          // can replace the local video producer. A live setup/recovery also
          // has its own lifecycle handling, so this resume is redundant.
          if (hasCurrentCallSetup()) {
            debugCall(
              '[Call] resume_ignored_existing_setup',
              JSON.stringify({
                callId: shortCallId(action.callId),
                actionId: shortCallId(action.actionId),
              }),
            )
            completeNativeCallAction(action.actionId)
            return
          }

          if (hasConflictingCall()) {
            veloraSystemCalls.dismissIncomingCall(action.callId)
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

          if (!isActionAccountCurrent()) {
            await abandonActionForAccountChange()
            return
          }

          if (callState.status !== 'active' || !prepareIncomingCallFromState(callState)) {
            veloraSystemCalls.dismissIncomingCall(action.callId)
            completeNativeCallAction(action.actionId)
            return
          }

          const resumed = await resumeAcceptedCall(callState, action.answerActionId)
          if (!isActionAccountCurrent()) {
            await abandonActionForAccountChange()
            return
          }
          if (resumed) {
            completeNativeCallAction(action.actionId)
          } else {
            veloraSystemCalls.dismissIncomingCall(action.callId)
            completeNativeCallAction(action.actionId)
          }
          return
        }

        if (hasConflictingCall()) {
          if (action.action === 'answer') {
            veloraSystemCalls.completePendingAnswer(action.actionId, false, 'busy')
          }
          veloraSystemCalls.dismissIncomingCall(action.callId)
          completeNativeCallAction(action.actionId)
          return
        }

        // The PushKit/CallKit payload already carries the signed call identity.
        // Answer through the atomic socket transition first; a REST state read
        // here adds a full cold-start network round trip and races terminal
        // updates that the server transition already resolves deterministically.
        if (action.action === 'answer') {
          if (acceptingIncomingCallIdRef.current === action.callId) {
            veloraSystemCalls.completePendingAnswer(action.actionId, false, 'answer_in_progress')
            completeNativeCallAction(action.actionId)
            return
          }

          if (!isActionAccountCurrent()) {
            await abandonActionForAccountChange()
            return
          }

          if (prepareIncomingCallFromPayload(action)) {
            await acceptIncomingCall('native', action.actionId)
          } else {
            veloraSystemCalls.completePendingAnswer(action.actionId, false, 'unauthenticated')
            veloraSystemCalls.dismissIncomingCall(action.callId)
          }
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

        if (!isActionAccountCurrent()) {
          await abandonActionForAccountChange()
          return
        }

        if (
          callState.status === 'ended' ||
          callState.status === 'cancelled' ||
          callState.status === 'rejected'
        ) {
          if (callState.isGroupCall) {
            void groupWinnerAction.clear(currentUserId, action.callId).catch(() => undefined)
          }
          if (isCurrentCall(action.callId)) {
            await teardownOnce('native_action_terminal_state')
          } else {
            veloraSystemCalls.dismissIncomingCall(action.callId)
          }
          completeNativeCallAction(action.actionId)
          return
        }

        if (action.action === 'end') {
          const state = useCallStore.getState()
          if (state.callId === action.callId && isBusyPhase(state.phase)) {
            await endCall('ended')
          } else if (callState.status === 'active') {
            const socket = await ensureCallSocketConnected(action.callId)
            if (!isActionAccountCurrent()) {
              await abandonActionForAccountChange()
              return
            }
            if (hasConflictingCall()) {
              veloraSystemCalls.dismissIncomingCall(action.callId)
              completeNativeCallAction(action.actionId)
              return
            }
            if (callState.isGroupCall && callState.initiatorId !== currentUserId) {
              const winningActionId =
                action.answerActionId ??
                (await groupWinnerAction.load(currentUserId, action.callId))
              if (!winningActionId) throw new Error('group_winner_action_missing')
              const registry = new Set<() => void>()
              try {
                await emitAndWaitForEvent<'rejoin_call', 'call_rejoined'>(
                  socket,
                  'rejoin_call',
                  { callId: action.callId, actionId: winningActionId },
                  {
                    event: 'call_rejoined',
                    timeoutMs: 10_000,
                    registry,
                    filter: (payload) => payload.callId === action.callId,
                  },
                )
              } catch {
                // A previous leave may have committed while its ACK was lost.
                // Only the server can confirm that state through call_left.
              }
              if (!isActionAccountCurrent()) {
                await abandonActionForAccountChange()
                return
              }
              await emitAndWaitForEvent<'leave_call', 'call_left'>(
                socket,
                'leave_call',
                { callId: action.callId, reason: 'ended' },
                {
                  event: 'call_left',
                  timeoutMs: 10_000,
                  registry,
                  filter: (payload) => payload.callId === action.callId,
                },
              )
              void groupWinnerAction.clear(currentUserId, action.callId).catch(() => undefined)
              if (!isActionAccountCurrent()) {
                await abandonActionForAccountChange()
                return
              }
            } else {
              socket.emit('leave_call', { callId: action.callId, reason: 'ended' })
            }
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
            callId: shortCallId(action.callId),
            action: action.action,
            actionId: shortCallId(action.actionId),
            errorCode: safeCallErrorCode(error),
          }),
        )
        if (action.action === 'answer') {
          veloraSystemCalls.completePendingAnswer(action.actionId, false, 'native_answer_failed')
          completeNativeCallAction(action.actionId)
        }
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
      prepareIncomingCallFromPayload,
      prepareIncomingCallFromState,
      processingNativeActionIdsRef,
      rejectIncomingCall,
      resumeAcceptedCall,
      teardownOnce,
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
          callId: shortCallId(pendingAction.callId),
          action: pendingAction.action,
          actionId: shortCallId(pendingAction.actionId),
        }),
      )
      void processNativeCallAction(pendingAction)
    },
    [processNativeCallAction],
  )

  return { processNativeCallAction, processPendingNativeCallAction }
}
