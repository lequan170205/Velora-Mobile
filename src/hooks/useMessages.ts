import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { conversationApi } from '../api/conversation.api'
import { queryKeys } from '../constants/queryKeys'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'
import type { Message } from '../types/conversation.types'

export function useMessages(conversationId: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.conversations.messages(conversationId),
    queryFn: ({ pageParam = undefined }) =>
      conversationApi.getMessages(conversationId, pageParam ? { cursor: pageParam as string } : {}),
    getNextPageParam: (lastPage) => {
      if (!lastPage || lastPage.length === 0) {
        return undefined
      }

      return lastPage[0].id
    },
    initialPageParam: undefined as string | undefined,
  })
}

export function useSendMessage(conversationId: string) {
  const queryClient = useQueryClient()
  const { addOptimisticMessage, removeOptimisticMessage, confirmMessage } = useChatStore()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: (content: string) =>
      conversationApi.sendMessage(conversationId, { content, type: 'TEXT' }),
    onMutate: async (content) => {
      if (!user) return

      const tempId = `temp-${Date.now()}`
      const tempMessage: Message = {
        id: tempId,
        conversationId,
        senderId: user.id,
        sender: user,
        content,
        type: 'TEXT',
        status: 'SENT',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      addOptimisticMessage(conversationId, tempMessage)

      return { tempId }
    },
    onSuccess: (realMessage, _variables, context) => {
      if (context?.tempId) {
        confirmMessage(context.tempId, realMessage)
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.messages(conversationId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
    },
    onError: (_err, _variables, context) => {
      if (context?.tempId) {
        removeOptimisticMessage(conversationId, context.tempId)
      }
    },
  })
}
