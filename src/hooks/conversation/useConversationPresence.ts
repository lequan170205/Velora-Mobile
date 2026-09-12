import { useEffect, useState } from 'react'

import { formatLastSeenLabel } from '../../lib/presence'
import { useChatStore } from '../../stores/chatStore'

type RequestPresence = (userIds: string[], options?: { conversationId?: string }) => void

type UseConversationPresenceInput = {
  conversationId: string
  isConnected: boolean
  isGroup: boolean
  otherUserId: string | null
  requestPresence: RequestPresence
  transitionDone: boolean
}

export const useConversationPresence = ({
  conversationId,
  isConnected,
  isGroup,
  otherUserId,
  requestPresence,
  transitionDone,
}: UseConversationPresenceInput) => {
  const onlineUsers = useChatStore((state) => state.onlineUsers)
  const lastSeenByUserId = useChatStore((state) => state.lastSeenByUserId)
  const [presenceTick, setPresenceTick] = useState(() => Date.now())

  const isOnline = otherUserId ? onlineUsers.has(otherUserId) : false
  const lastSeenAt = otherUserId ? (lastSeenByUserId[otherUserId] ?? null) : null
  const presenceLabel = !isConnected
    ? 'Reconnecting…'
    : isOnline
      ? 'Online'
      : formatLastSeenLabel(lastSeenAt, presenceTick)

  useEffect(() => {
    if (!transitionDone) return
    if (!isConnected || !otherUserId || isGroup) return

    requestPresence([otherUserId], { conversationId })
  }, [conversationId, isConnected, isGroup, otherUserId, requestPresence, transitionDone])

  useEffect(() => {
    if (isOnline || !lastSeenAt) {
      return
    }

    const intervalId = setInterval(() => {
      setPresenceTick(Date.now())
    }, 60 * 1000)

    return () => clearInterval(intervalId)
  }, [isOnline, lastSeenAt])

  return { isOnline, presenceLabel }
}
