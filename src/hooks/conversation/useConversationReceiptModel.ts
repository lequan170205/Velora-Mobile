import { useMemo } from 'react'

import { buildConversationReceiptModel } from '../../lib/conversation/conversationPresentationPolicies'

import type { ChatParticipant, Conversation, Message } from '../../types/conversation.types'

type UseConversationReceiptModelInput = {
  conversation: Conversation | null
  currentUserId: string | null
  orderedMessages: Message[]
  otherParticipant: ChatParticipant | null
}

export const useConversationReceiptModel = ({
  conversation,
  currentUserId,
  orderedMessages,
  otherParticipant,
}: UseConversationReceiptModelInput) => {
  return useMemo(
    () =>
      buildConversationReceiptModel({
        conversation,
        currentUserId,
        orderedMessages,
        otherParticipant,
      }),
    [conversation, currentUserId, orderedMessages, otherParticipant],
  )
}
