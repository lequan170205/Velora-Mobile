import { io } from 'socket.io-client'

import { authApi } from '../../api/auth.api'

import type { CallClientEvents, CallServerEvents, CallSocket } from '../../types/call.types'

type EventCleanup = () => void
export type CallWaitRegistry = Set<EventCleanup>

interface WaitForEventOptions<TPayload> {
  timeoutMs: number
  registry: CallWaitRegistry
  filter?: (payload: TPayload) => boolean
}

const DEFAULT_SOCKET_PATH = '/socket.io'

export const createCallSocket = () => {
  const url = process.env.EXPO_PUBLIC_CALL_WS_URL?.trim()

  if (!url) {
    throw new Error('EXPO_PUBLIC_CALL_WS_URL is not configured')
  }

  return io(url, {
    autoConnect: false,
    forceNew: true,
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    path: DEFAULT_SOCKET_PATH,
    auth: (cb) => {
      void authApi
        .getSocketToken()
        .then(({ accessToken }) => {
          cb({ token: accessToken })
        })
        .catch(() => {
          cb({})
        })
    },
  }) as CallSocket
}

export const clearWaitRegistry = (registry: CallWaitRegistry) => {
  for (const cleanup of [...registry]) {
    cleanup()
  }
}

export const waitForEvent = <TEvent extends keyof CallServerEvents>(
  socket: CallSocket,
  event: TEvent,
  options: WaitForEventOptions<Parameters<CallServerEvents[TEvent]>[0]>,
) => {
  return new Promise<Parameters<CallServerEvents[TEvent]>[0]>((resolve, reject) => {
    const listener = (payload: Parameters<CallServerEvents[TEvent]>[0]) => {
      if (options.filter && !options.filter(payload)) {
        return
      }

      cleanup()
      resolve(payload)
    }

    const timeoutId = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for ${String(event)}`))
    }, options.timeoutMs)

    const cleanup = () => {
      clearTimeout(timeoutId)
      socket.off(event, listener as never)
      options.registry.delete(cleanup)
    }

    options.registry.add(cleanup)
    socket.on(event, listener as never)
  })
}

export const waitForEventWhere = <TEvent extends keyof CallServerEvents>(
  socket: CallSocket,
  event: TEvent,
  options: WaitForEventOptions<Parameters<CallServerEvents[TEvent]>[0]>,
) => {
  return waitForEvent(socket, event, options)
}

export const emitAndWaitForEvent = <
  TEmit extends keyof CallClientEvents,
  TEvent extends keyof CallServerEvents,
>(
  socket: CallSocket,
  emitEvent: TEmit,
  emitPayload: Parameters<CallClientEvents[TEmit]>[0],
  options: WaitForEventOptions<Parameters<CallServerEvents[TEvent]>[0]> & { event: TEvent },
) => {
  const waiter = waitForEvent(socket, options.event, options)
  ;(socket.emit as (event: TEmit, payload: Parameters<CallClientEvents[TEmit]>[0]) => void)(
    emitEvent,
    emitPayload,
  )
  return waiter
}
