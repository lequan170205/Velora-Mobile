import type { Message, MessageMedia } from '../types/conversation.types'

/** The slice of a socket.io client the send needs, so the flow can be tested with a fake. */
// socket.io's own listener signature is `(...args: any[]) => void`, so the fake must match it.
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface MessageSocket {
  connected: boolean
  emit: (event: string, payload: unknown) => unknown
  on: (event: string, listener: (...args: any[]) => void) => unknown
  off: (event: string, listener: (...args: any[]) => void) => unknown
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface SocketMessagePayload {
  conversationId: string
  clientMessageId: string
  content: string
  type: string
  media?: MessageMedia
  replyToId?: string
}

export const SOCKET_SEND_ACK_TIMEOUT_MS = 15000

/**
 * Sends one message over the websocket and resolves with the saved message once the server's
 * `message_synced` for this `clientMessageId` arrives. Rejects when the server answers
 * `message_failed`, the socket drops, or no answer comes in time; the caller retries with the same
 * `clientMessageId`, which the server deduplicates.
 */
export function sendMessageOverSocket(
  socket: MessageSocket,
  payload: SocketMessagePayload,
  timeoutMs: number = SOCKET_SEND_ACK_TIMEOUT_MS,
): Promise<Message> {
  return new Promise<Message>((resolve, reject) => {
    if (!socket.connected) {
      reject(new Error('socket is not connected'))
      return
    }

    let timer: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      socket.off('message_synced', onSynced)
      socket.off('message_failed', onFailed)
      socket.off('disconnect', onDisconnect)
    }

    const onSynced = (message: Message) => {
      if (message?.clientMessageId !== payload.clientMessageId) return
      cleanup()
      resolve(message)
    }

    const onFailed = (failed: { clientMessageId?: string } | string) => {
      const failedId = typeof failed === 'string' ? failed : failed?.clientMessageId
      if (failedId !== payload.clientMessageId) return
      cleanup()
      reject(new Error('server rejected the message'))
    }

    const onDisconnect = () => {
      cleanup()
      reject(new Error('socket disconnected before the server answered'))
    }

    socket.on('message_synced', onSynced)
    socket.on('message_failed', onFailed)
    socket.on('disconnect', onDisconnect)
    timer = setTimeout(() => {
      cleanup()
      reject(new Error('socket send timed out waiting for the server'))
    }, timeoutMs)

    socket.emit('send_message', payload)
  })
}
