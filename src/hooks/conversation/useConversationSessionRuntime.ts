import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { InteractionManager } from 'react-native'

import { queryKeys } from '../../constants/queryKeys'
import {
  refreshLatestMessagesPageFromLocalStore,
  syncLatestMessagesToLocalStore,
  trimMessagesCache,
} from '../useMessages'

import type { Conversation } from '../../types/conversation.types'
import type { UserSession } from '../../types/user.types'
import type { Socket } from 'socket.io-client'

type UseConversationSessionRuntimeInput = {
  conversation: Conversation | null
  conversationId: string
  currentUser: UserSession | null
  hasLoadedLatestMessagePages: boolean
  isConnected: boolean
  isNearBottom: boolean
  latestSeenFrontierMessageId: string | null
  socket: Socket | null
  timelineMode: 'latest' | 'anchor'
}

export const useConversationSessionRuntime = ({
  conversation,
  conversationId,
  currentUser,
  hasLoadedLatestMessagePages,
  isConnected,
  isNearBottom,
  latestSeenFrontierMessageId,
  socket,
  timelineMode,
}: UseConversationSessionRuntimeInput) => {
  const queryClient = useQueryClient()
  const lastSentSeenFrontierRef = useRef<string | null>(null)
  const previousIsConnectedRef = useRef(isConnected)
  const [transitionDone, setTransitionDone] = useState(false)

  const clearConversationUnread = useCallback(
    (targetConversationId: string) => {
      queryClient.setQueryData<Conversation[] | undefined>(
        queryKeys.conversations.all,
        (oldData) => {
          if (!Array.isArray(oldData)) {
            return oldData
          }

          let hasChanges = false
          const nextConversations = oldData.map((cachedConversation) => {
            if (cachedConversation.id !== targetConversationId || !cachedConversation.unreadCount) {
              return cachedConversation
            }

            hasChanges = true
            return { ...cachedConversation, unreadCount: 0 }
          })

          return hasChanges ? nextConversations : oldData
        },
      )
    },
    [queryClient],
  )

  const emitMarkSeenToFrontier = useCallback(
    (frontierMessageId: string, options?: { force?: boolean }) => {
      if (!socket?.connected) {
        return
      }

      const frontierKey = `${conversationId}:${frontierMessageId}`
      if (!options?.force && lastSentSeenFrontierRef.current === frontierKey) {
        return
      }

      socket.emit('mark_seen', {
        conversationId,
        upToMessageId: frontierMessageId,
      })
      lastSentSeenFrontierRef.current = frontierKey
      clearConversationUnread(conversationId)
    },
    [clearConversationUnread, conversationId, socket],
  )

  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      setTransitionDone(true)
    })
    return () => handle.cancel()
  }, [])

  useEffect(() => {
    if (!transitionDone) return

    const timer = setTimeout(() => {
      if (socket?.connected) {
        socket.emit('join_conversation', conversationId)
      }
    }, 100)

    return () => clearTimeout(timer)
  }, [conversationId, socket, socket?.connected, transitionDone])

  useEffect(() => {
    if (!isConnected) {
      lastSentSeenFrontierRef.current = null
    }
  }, [isConnected])

  useEffect(() => {
    lastSentSeenFrontierRef.current = null
  }, [conversationId])

  useEffect(() => {
    if (
      !transitionDone ||
      timelineMode !== 'latest' ||
      !isConnected ||
      !isNearBottom ||
      !latestSeenFrontierMessageId
    ) {
      return
    }

    emitMarkSeenToFrontier(latestSeenFrontierMessageId)
  }, [
    emitMarkSeenToFrontier,
    isConnected,
    isNearBottom,
    latestSeenFrontierMessageId,
    timelineMode,
    transitionDone,
  ])

  useEffect(() => {
    const wasConnected = previousIsConnectedRef.current
    previousIsConnectedRef.current = isConnected

    if (
      !transitionDone ||
      timelineMode !== 'latest' ||
      !hasLoadedLatestMessagePages ||
      !isConnected ||
      wasConnected
    ) {
      return
    }

    let cancelled = false

    const syncConversationAfterReconnect = async () => {
      try {
        await syncLatestMessagesToLocalStore({
          conversation,
          conversationId,
          currentUser,
        })

        if (cancelled) {
          return
        }

        await refreshLatestMessagesPageFromLocalStore({
          conversation,
          conversationId,
          currentUser,
          queryClient,
        })
      } catch (error) {
        console.warn('[Conversation] Failed to sync latest messages after reconnect', error)
      }
    }

    void syncConversationAfterReconnect()

    return () => {
      cancelled = true
    }
  }, [
    conversation,
    conversationId,
    currentUser,
    hasLoadedLatestMessagePages,
    isConnected,
    queryClient,
    timelineMode,
    transitionDone,
  ])

  useEffect(() => {
    return () => {
      const messagesQueryKey = queryKeys.conversations.messages(conversationId)
      void queryClient.cancelQueries({ queryKey: messagesQueryKey, exact: true })
      trimMessagesCache(queryClient, conversationId)
    }
  }, [conversationId, queryClient, socket])

  return { transitionDone }
}
