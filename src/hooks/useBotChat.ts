import { useMutation, useQueryClient } from '@tanstack/react-query'

import { conversationApi } from '../api/conversation.api'
import { queryKeys } from '../constants/queryKeys'
import { useNetworkStatus } from '../providers/NetworkProvider'
import { useSocket } from '../providers/SocketProvider'
import { useChatStore } from '../stores/chatStore'

import { useConversationNavigation } from './useConversationNavigation'

import type { Conversation } from '../types/conversation.types'

const BOT_USER_ID = process.env.EXPO_PUBLIC_BOT_USER_ID
const BOT_OFFLINE_ERROR_MESSAGE = 'No internet connection. Connect to the internet and try again.'

const isBotParticipant = (
  participant:
    | Pick<NonNullable<Conversation['participants']>[number], 'id' | 'email' | 'name' | 'fullName'>
    | undefined,
) => {
  if (!participant) {
    return false
  }

  const normalizedEmail = participant.email?.trim().toLowerCase()
  const normalizedName = (participant.name ?? participant.fullName)?.trim().toLowerCase()

  return (
    Boolean(BOT_USER_ID && participant.id === BOT_USER_ID) ||
    normalizedEmail === 'bot@system.local' ||
    normalizedName === 'system_bot' ||
    normalizedName === 'velora bot'
  )
}

const isBotConversation = (conversation: Conversation, knownBotConversationIds: Set<string>) => {
  if (knownBotConversationIds.has(conversation.id)) {
    return true
  }

  return (
    Boolean(BOT_USER_ID && conversation.participantIds.includes(BOT_USER_ID)) ||
    Boolean(conversation.participants?.some(isBotParticipant))
  )
}

/**
 * Creates or retrieves the direct conversation with the bot.
 * The first user message should be sent from the chat screen via WebSocket.
 */
export function useBotChat() {
  const queryClient = useQueryClient()
  const { isNetworkResolved, isOnline } = useNetworkStatus()
  const { socket } = useSocket()
  const { isBotConversation: isKnownBotConversation, markAsBotConversation } = useChatStore()
  const { openConversation } = useConversationNavigation()

  return useMutation({
    mutationFn: async () => {
      const cachedConversations =
        queryClient.getQueryData<Conversation[] | undefined>(queryKeys.conversations.all) ?? []
      const knownBotConversationIds = new Set(
        cachedConversations
          .map((conversation) => (isKnownBotConversation(conversation.id) ? conversation.id : null))
          .filter((conversationId): conversationId is string => Boolean(conversationId)),
      )
      const existingConversation = cachedConversations.find((conversation) =>
        isBotConversation(conversation, knownBotConversationIds),
      )

      if (existingConversation) {
        if (socket?.connected) {
          socket.emit('join_conversation', existingConversation.id)
        }

        return {
          conversationId: existingConversation.id,
          shouldRefreshConversations: false,
        }
      }

      if (isNetworkResolved && !isOnline) {
        throw new Error(BOT_OFFLINE_ERROR_MESSAGE)
      }

      const conversation = await conversationApi.createBotConversation()
      const conversationId = conversation.id

      if (socket?.connected) {
        socket.emit('join_conversation', conversationId)
      }

      return { conversationId, shouldRefreshConversations: true }
    },
    onSuccess: (data) => {
      const { conversationId, shouldRefreshConversations } = data

      markAsBotConversation(conversationId)

      if (shouldRefreshConversations) {
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
      }

      openConversation(conversationId)
    },
  })
}
