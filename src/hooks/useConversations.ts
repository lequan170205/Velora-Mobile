import { useQuery } from '@tanstack/react-query'

import { conversationApi } from '../api/conversation.api'
import { queryKeys } from '../constants/queryKeys'
import { reconcileConversationSnapshot } from '../database/conversationBootstrap'

export const getConversationsQueryOptions = () => ({
  queryKey: queryKeys.conversations.all,
  queryFn: async () => {
    const conversations = await conversationApi.getAll()

    void reconcileConversationSnapshot({ conversations }).catch((error) => {
      console.warn('[Conversations] Failed to reconcile local conversation snapshot', error)
    })

    return conversations
  },
  staleTime: 0,
  refetchOnMount: 'always' as const,
  refetchOnReconnect: true,
})

export function useConversations() {
  return useQuery(getConversationsQueryOptions())
}
