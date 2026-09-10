import { io } from 'socket.io-client'

import { authApi } from '../../api/auth.api'

import type { CallClientEvents, CallServerEvents, CallSocket } from '../../types/call.types'

type EventCleanup = (error?: Error) => void
export type CallWaitRegistry = Set<EventCleanup>

export class CallWaitCancelledError extends Error {
  constructor() {
    super('Call socket wait was cancelled')
    this.name = 'CallWaitCancelledError'
  }
}

export const isCallWaitCancelledError = (error: unknown) =>
  error instanceof CallWaitCancelledError ||
  (error instanceof Error && error.name === 'CallWaitCancelledError')

interface WaitForEventOptions<TPayload> {
  timeoutMs: number
  registry: CallWaitRegistry
  filter?: (payload: TPayload) => boolean
  rejectOnException?: boolean
}

const DEFAULT_SOCKET_PATH = '/call/socket.io'
const PREWARMED_SOCKET_TOKEN_TTL_MS = 15_000

let prewarmedSocketToken: {
  userId: string
  token: string
  expiresAt: number
} | null = null
let prewarmedSocketTokenPromise: Promise<string> | null = null
let prewarmedSocketTokenUserId: string | null = null
// Credentials only live in memory, but a logout or account switch can race the
// request that fetches them. The generation prevents a late response from
// putting a credential from the old session back into the prewarm cache.
let prewarmedSocketTokenGeneration = 0

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
    auth: {},
  }) as CallSocket
}

export const prewarmCallSocketCredentials = (userId: string) => {
  const now = Date.now()
  if (prewarmedSocketToken?.userId === userId && prewarmedSocketToken.expiresAt > now) {
    return Promise.resolve(prewarmedSocketToken.token)
  }

  if (prewarmedSocketTokenPromise && prewarmedSocketTokenUserId === userId) {
    return prewarmedSocketTokenPromise
  }

  if (prewarmedSocketToken?.userId !== userId) {
    prewarmedSocketToken = null
  }

  const generation = ++prewarmedSocketTokenGeneration
  prewarmedSocketTokenUserId = userId
  const tokenPromise = authApi
    .getSocketToken()
    .then(({ accessToken }) => {
      if (!accessToken.trim()) throw new Error('socket_auth_failed')
      if (prewarmedSocketTokenGeneration === generation && prewarmedSocketTokenUserId === userId) {
        prewarmedSocketToken = {
          userId,
          token: accessToken,
          expiresAt: Date.now() + PREWARMED_SOCKET_TOKEN_TTL_MS,
        }
      }
      return accessToken
    })
    .finally(() => {
      if (prewarmedSocketTokenPromise === tokenPromise) {
        prewarmedSocketTokenPromise = null
        prewarmedSocketTokenUserId = null
      }
    })

  prewarmedSocketTokenPromise = tokenPromise
  return tokenPromise
}

export const clearPrewarmedCallSocketCredentials = (userId?: string) => {
  const clearsCachedToken = !userId || prewarmedSocketToken?.userId === userId
  const clearsInFlightRequest = !userId || prewarmedSocketTokenUserId === userId
  if (clearsCachedToken || clearsInFlightRequest) {
    prewarmedSocketTokenGeneration += 1
  }
  if (!userId || prewarmedSocketToken?.userId === userId) {
    prewarmedSocketToken = null
  }
  if (!userId || prewarmedSocketTokenUserId === userId) {
    prewarmedSocketTokenPromise = null
    prewarmedSocketTokenUserId = null
  }
}

const takePrewarmedCallSocketToken = (userId?: string | null) => {
  if (!userId || prewarmedSocketToken?.userId !== userId) return null
  if (prewarmedSocketToken.expiresAt <= Date.now()) {
    prewarmedSocketToken = null
    return null
  }

  const token = prewarmedSocketToken.token
  prewarmedSocketToken = null
  return token
}

const takeOrAwaitPrewarmedCallSocketToken = async (userId?: string | null) => {
  const cachedToken = takePrewarmedCallSocketToken(userId)
  if (
    cachedToken ||
    !userId ||
    prewarmedSocketTokenUserId !== userId ||
    !prewarmedSocketTokenPromise
  ) {
    return cachedToken
  }

  try {
    await prewarmedSocketTokenPromise
    return takePrewarmedCallSocketToken(userId)
  } catch {
    return null
  }
}

export const authenticateCallSocket = async (socket: CallSocket, userId?: string | null) => {
  try {
    const accessToken =
      (await takeOrAwaitPrewarmedCallSocketToken(userId)) ??
      (await authApi.getSocketToken()).accessToken
    if (!accessToken.trim()) {
      throw new Error('socket_auth_failed')
    }

    socket.auth = { token: accessToken }
  } catch {
    throw new Error('socket_auth_failed')
  }
}

export const clearWaitRegistry = (registry: CallWaitRegistry) => {
  for (const cleanup of [...registry]) {
    cleanup(new CallWaitCancelledError())
  }
}

export const waitForEvent = <TEvent extends keyof CallServerEvents>(
  socket: CallSocket,
  event: TEvent,
  options: WaitForEventOptions<Parameters<CallServerEvents[TEvent]>[0]>,
) => {
  return new Promise<Parameters<CallServerEvents[TEvent]>[0]>((resolve, reject) => {
    let settled = false
    const cleanupResources = () => {
      clearTimeout(timeoutId)
      socket.off(event, listener as never)
      if (options.rejectOnException) {
        socket.off('exception', exceptionListener as never)
      }
      options.registry.delete(cancel)
    }
    const settle = (
      result:
        | { status: 'resolved'; payload: Parameters<CallServerEvents[TEvent]>[0] }
        | { status: 'rejected'; error: Error },
    ) => {
      if (settled) return
      settled = true
      cleanupResources()
      if (result.status === 'resolved') {
        resolve(result.payload)
      } else {
        reject(result.error)
      }
    }
    const cancel = (error = new CallWaitCancelledError()) => {
      settle({ status: 'rejected', error })
    }
    const listener = (payload: Parameters<CallServerEvents[TEvent]>[0]) => {
      if (options.filter && !options.filter(payload)) {
        return
      }

      settle({ status: 'resolved', payload })
    }

    const exceptionListener = (payload: Parameters<CallServerEvents['exception']>[0]) => {
      settle({
        status: 'rejected',
        error: new Error(
          payload.message || `Call socket exception while waiting for ${String(event)}`,
        ),
      })
    }

    const timeoutId = setTimeout(() => {
      settle({
        status: 'rejected',
        error: new Error(`Timed out waiting for ${String(event)}`),
      })
    }, options.timeoutMs)

    options.registry.add(cancel)
    socket.on(event, listener as never)
    if (options.rejectOnException) {
      socket.on('exception', exceptionListener as never)
    }
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
  const waiter = waitForEvent(socket, options.event, {
    ...options,
    rejectOnException: options.rejectOnException ?? true,
  })
  ;(socket.emit as (event: TEmit, payload: Parameters<CallClientEvents[TEmit]>[0]) => void)(
    emitEvent,
    emitPayload,
  )
  return waiter
}
