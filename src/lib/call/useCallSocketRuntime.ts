import { useCallback } from 'react'

import { useAuthStore } from '../../stores/authStore'
import { useCallStore } from '../../stores/callStore'

import { CALL_JOINED_TIMEOUT_MS, SOCKET_CONNECT_TIMEOUT_MS } from './callConstants'
import { authenticateCallSocket, createCallSocket, emitAndWaitForEvent } from './callSocket'

import type { CallWaitRegistry } from './callSocket'
import type { CallTelemetrySession } from './callTelemetry'
import type { CallEndedPayload, CallSocket, CallSocketReadyPayload } from '../../types/call.types'

type MutableRef<T> = { current: T }

type CallSocketRuntimeOptions = {
  socketRef: MutableRef<CallSocket | null>
  waitRegistryRef: MutableRef<CallWaitRegistry>
  activeCallIdRef: MutableRef<string | null>
  telemetrySessionRef: MutableRef<CallTelemetrySession | null>
  acceptingIncomingCallIdRef: MutableRef<string | null>
  authRestorePromiseRef: MutableRef<Promise<void> | null>
  socketConnectPromiseRef: MutableRef<Promise<CallSocket> | null>
  callSocketPromisesRef: MutableRef<Map<string, Promise<CallSocket>>>
  callSocketAuthenticatedRef: MutableRef<boolean>
  handleTerminalCall: (payload: CallEndedPayload, source: 'live' | 'socket_ready_replay') => void
}

const debugCall = (...args: Parameters<typeof console.warn>) => {
  if (__DEV__) console.warn(...args)
}

export const useCallSocketRuntime = ({
  socketRef,
  waitRegistryRef,
  activeCallIdRef,
  telemetrySessionRef,
  acceptingIncomingCallIdRef,
  authRestorePromiseRef,
  socketConnectPromiseRef,
  callSocketPromisesRef,
  callSocketAuthenticatedRef,
  handleTerminalCall,
}: CallSocketRuntimeOptions) => {
  const ensureAuthenticatedSession = useCallback(
    async (callId: string) => {
      const currentAuth = useAuthStore.getState()
      telemetrySessionRef.current?.record('auth_restore_started', { outcome: 'started' })
      debugCall('[Call] auth_restore_started', JSON.stringify({ callId }))

      if (currentAuth.isAuthenticated && currentAuth.user?.id) {
        telemetrySessionRef.current?.record('auth_restore_succeeded', { outcome: 'succeeded' })
        return
      }

      if (!authRestorePromiseRef.current) {
        authRestorePromiseRef.current = currentAuth.hydrateAuth({ silent: true }).then(() => {
          const restoredAuth = useAuthStore.getState()
          if (!restoredAuth.isAuthenticated || !restoredAuth.user?.id) {
            throw new Error('auth_not_restored')
          }
        })
      }

      try {
        await authRestorePromiseRef.current
        telemetrySessionRef.current?.record('auth_restore_succeeded', { outcome: 'succeeded' })
        debugCall('[Call] auth_restore_succeeded', JSON.stringify({ callId }))
      } catch (error) {
        const errorCode =
          useAuthStore.getState().authHydrationError === 'network'
            ? 'network_unavailable'
            : 'auth_not_restored'
        telemetrySessionRef.current?.record('auth_restore_failed', {
          outcome: 'failed',
          error,
          errorCode,
        })
        debugCall('[Call] auth_restore_failed', JSON.stringify({ callId, errorCode }))
        throw new Error(errorCode)
      } finally {
        authRestorePromiseRef.current = null
      }
    },
    [authRestorePromiseRef, telemetrySessionRef],
  )

  const ensureCallSocketConnected = useCallback(
    async (callId: string): Promise<CallSocket> => {
      const existingCallPromise = callSocketPromisesRef.current.get(callId)
      if (existingCallPromise) return existingCallPromise

      const callPromise = (async () => {
        await ensureAuthenticatedSession(callId)

        if (socketConnectPromiseRef.current) return socketConnectPromiseRef.current

        const connectionPromise = (async () => {
          let socket = socketRef.current
          if (!socket) {
            socket = createCallSocket()
            socketRef.current = socket
          }

          if (socket.connected && callSocketAuthenticatedRef.current) return socket

          callSocketAuthenticatedRef.current = false
          telemetrySessionRef.current?.record('socket_connect_started', { outcome: 'started' })
          debugCall('[Call] socket_connect_started', JSON.stringify({ callId }))
          await authenticateCallSocket(socket)

          await new Promise<void>((resolve, reject) => {
            let settled = false
            const settle = (error?: Error) => {
              if (settled) return
              settled = true
              clearTimeout(timeoutId)
              socket.off('call_socket_ready', handleReady)
              socket.off('connect', handleConnect)
              socket.off('connect_error', handleConnectError)
              socket.off('disconnect', handleDisconnect)
              if (error) reject(error)
              else resolve()
            }
            const handleReady = (payload?: CallSocketReadyPayload) => {
              callSocketAuthenticatedRef.current = true
              telemetrySessionRef.current?.record('socket_authenticated', {
                outcome: 'succeeded',
              })
              debugCall('[Call] socket_authenticated', JSON.stringify({ callId }))

              const recentTerminalCalls = payload?.recentTerminalCalls ?? []
              recentTerminalCalls.forEach((terminalCall) => {
                handleTerminalCall(terminalCall, 'socket_ready_replay')
              })
              if (
                callId !== 'runtime' &&
                recentTerminalCalls.some((terminalCall) => terminalCall.callId === callId)
              ) {
                settle(new Error('call_already_ended'))
                return
              }
              settle()
            }
            const handleConnect = () => {
              telemetrySessionRef.current?.record('socket_connected', { outcome: 'succeeded' })
              debugCall('[Call] socket_connected', JSON.stringify({ callId }))
            }
            const handleConnectError = () => settle(new Error('network_unavailable'))
            const handleDisconnect = (reason: string) => {
              settle(
                new Error(
                  reason === 'io server disconnect' ? 'socket_auth_failed' : 'network_unavailable',
                ),
              )
            }
            const timeoutId = setTimeout(
              () => settle(new Error('socket_connect_timeout')),
              SOCKET_CONNECT_TIMEOUT_MS,
            )

            socket.once('call_socket_ready', handleReady)
            socket.once('connect', handleConnect)
            socket.once('connect_error', handleConnectError)
            socket.once('disconnect', handleDisconnect)

            if (socket.connected && callSocketAuthenticatedRef.current) {
              handleReady()
            } else {
              if (socket.connected) socket.disconnect()
              socket.connect()
            }
          })
          return socket
        })()

        socketConnectPromiseRef.current = connectionPromise
        try {
          return await connectionPromise
        } finally {
          socketConnectPromiseRef.current = null
        }
      })()

      callSocketPromisesRef.current.set(callId, callPromise)
      void callPromise.then(
        () => callSocketPromisesRef.current.delete(callId),
        () => callSocketPromisesRef.current.delete(callId),
      )
      return callPromise
    },
    [
      callSocketAuthenticatedRef,
      callSocketPromisesRef,
      ensureAuthenticatedSession,
      handleTerminalCall,
      socketConnectPromiseRef,
      socketRef,
      telemetrySessionRef,
    ],
  )

  const ensureSocketConnected = useCallback(
    () => ensureCallSocketConnected(activeCallIdRef.current ?? 'runtime'),
    [activeCallIdRef, ensureCallSocketConnected],
  )

  const restorePreActiveCallMembership = useCallback(
    async (socket: CallSocket, callId: string) => {
      const state = useCallStore.getState()
      if (state.callId !== callId) return

      const shouldRestoreMembership =
        state.phase === 'outgoing_ringing' ||
        state.phase === 'connecting' ||
        (state.phase === 'incoming_ringing' && acceptingIncomingCallIdRef.current === callId)
      if (!shouldRestoreMembership) return

      await emitAndWaitForEvent<'join_call', 'call_joined'>(
        socket,
        'join_call',
        { callId },
        {
          event: 'call_joined',
          timeoutMs: CALL_JOINED_TIMEOUT_MS,
          registry: waitRegistryRef.current,
          filter: (payload) => payload.callId === callId,
        },
      )
      debugCall(
        '[Call] setup_call_membership_restored',
        JSON.stringify({ callId, phase: state.phase }),
      )
      telemetrySessionRef.current?.record('socket_rejoin_succeeded', { outcome: 'succeeded' })
    },
    [acceptingIncomingCallIdRef, telemetrySessionRef, waitRegistryRef],
  )

  return {
    ensureCallSocketConnected,
    ensureSocketConnected,
    restorePreActiveCallMembership,
  }
}
