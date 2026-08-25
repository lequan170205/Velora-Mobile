import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { queryKeys } from '../../constants/queryKeys'
import { getConversationHeaderIdentity } from '../../lib/conversation/conversationPresentationPolicies'

import type { ChatParticipant, Conversation } from '../../types/conversation.types'

type UseConversationMetadataInput = {
  conversationId: string
  currentUserId: string | null
}

export const useConversationMetadata = ({
  conversationId,
  currentUserId,
}: UseConversationMetadataInput) => {
  const { data: conversationsCacheData } = useQuery({
    queryKey: queryKeys.conversations.all,
    queryFn: () => Promise.resolve(null),
    enabled: false,
  })

  const allConversations = useMemo(() => {
    if (!conversationsCacheData) return []
    if (Array.isArray(conversationsCacheData)) {
      return conversationsCacheData as Conversation[]
    }
    return (conversationsCacheData as { pages?: Conversation[][] })?.pages?.flat() || []
  }, [conversationsCacheData])

  const currentConversation = useMemo(() => {
    return allConversations.find(
      (conversation: Conversation) => conversation?.id === conversationId,
    )
  }, [allConversations, conversationId])

  const { displayName, avatarUrl, otherUserId } = useMemo(
    () =>
      getConversationHeaderIdentity({
        conversation: currentConversation ?? null,
        currentUserId,
      }),
    [currentConversation, currentUserId],
  )

  const participantsMap = useMemo(() => {
    const map = new Map<string, ChatParticipant>()
    currentConversation?.participants?.forEach((participant: ChatParticipant) => {
      map.set(participant.id, participant)
    })
    return map
  }, [currentConversation?.participants])

  const otherParticipant = useMemo(() => {
    if (currentConversation?.isGroup) {
      return null
    }

    return (
      currentConversation?.participants?.find((participant) => participant.id !== currentUserId) ??
      null
    )
  }, [currentConversation?.isGroup, currentConversation?.participants, currentUserId])

  return {
    avatarUrl,
    currentConversation,
    displayName,
    isGroup: currentConversation?.isGroup === true,
    otherParticipant,
    otherUserId,
    participantsMap,
  }
}
