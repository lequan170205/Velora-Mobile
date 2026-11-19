import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { getConversationHeaderIdentity } from '../../lib/conversation/conversationPresentationPolicies'
import { getConversationsQueryOptions } from '../useConversations'

import type { ChatParticipant, Conversation } from '../../types/conversation.types'

type UseConversationMetadataInput = {
  conversationId: string
  currentUserId: string | null
}

export const useConversationMetadata = ({
  conversationId,
  currentUserId,
}: UseConversationMetadataInput) => {
  // Read-only observer of the shared conversation list. It must reuse the real query options: an
  // observer with its own placeholder `queryFn` (e.g. `() => Promise.resolve(null)`) overwrites the
  // query's fetcher on every render, so a later invalidate/refetch resolved `null` into the cache and
  // crashed list consumers such as the reel share sheet.
  const { data: conversationsCacheData } = useQuery({
    ...getConversationsQueryOptions(),
    enabled: false,
  })

  const allConversations = useMemo(() => {
    if (!conversationsCacheData) return []
    if (Array.isArray(conversationsCacheData)) {
      return conversationsCacheData
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
