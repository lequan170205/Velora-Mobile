import { useQuery } from '@tanstack/react-query'

import { conversationApi } from '../api/conversation.api'
import { queryKeys } from '../constants/queryKeys'

export const getConversationsQueryOptions = () => ({
  queryKey: queryKeys.conversations.all,
  queryFn: () => conversationApi.getAll(),
})

export function useConversations() {
  return useQuery(getConversationsQueryOptions())
}
