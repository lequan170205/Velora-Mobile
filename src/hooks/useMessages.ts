import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { conversationApi } from '../api/conversation.api'
import { queryKeys } from '../constants/queryKeys'
import { useSocket } from '../providers/SocketProvider'
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
  const { socket } = useSocket()
  const { addOptimisticMessage, enqueueOfflineMessage, replyToMessage } = useChatStore()
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ content, replyToId }: { content: string; replyToId?: string }) => {
      if (!socket) throw new Error('Socket is not connected')

      if (!socket.connected) {
        return Promise.resolve({ pending: true })
      }

      const payload: {
        conversationId: string
        content: string
        type: string
        signalType: number
        replyToId?: string
      } = {
        conversationId,
        content,
        type: 'text',
        signalType: 0,
      }

      if (replyToId) {
        payload.replyToId = replyToId
      }

      socket.emit('send_message', payload)
      return payload
    },
    onMutate: async ({ content, replyToId }) => {
      if (!user) return

      const now = new Date().toISOString()
      const tempId = `temp-${Date.now()}`

      // Build replyPreview from replyToMessage if replying
      let replyPreview: Message['replyPreview'] = undefined
      if (replyToId && replyToMessage) {
        replyPreview = {
          senderName: replyToMessage.sender?.email?.split('@')[0] || 'User',
          content: replyToMessage.content || '',
          type: (replyToMessage.type === 'voice' ? 'text' : replyToMessage.type) as
            | 'text'
            | 'image'
            | 'video'
            | 'file'
            | 'call',
        }
      }

      const tempMessage: Message = {
        id: tempId,
        conversationId,
        senderId: user.id,
        sender: user,
        content,
        type: 'text',
        status: 'SENT',
        createdAt: now,
        updatedAt: now,
        ...(replyToId && { replyToId }),
        ...(replyPreview && { replyPreview }),
      }

      addOptimisticMessage(conversationId, tempMessage)

      if (!socket || !socket.connected) {
        enqueueOfflineMessage({ id: tempId, conversationId, content })
      }

      queryClient.setQueryData<any>(queryKeys.conversations.all, (oldData: any) => {
        if (!oldData) return oldData

        const sortConvs = (convs: any[]) => {
          return convs.sort((a: any, b: any) => {
            const dateA = new Date(a.lastMessageAt || 0).getTime()
            const dateB = new Date(b.lastMessageAt || 0).getTime()
            return dateB - dateA
          })
        }

        if (oldData.pages) {
          let targetConv: any = null

          const newPages = oldData.pages.map((page: any[]) => {
            return page.filter((conv: any) => {
              if (conv.id === conversationId) {
                targetConv = {
                  ...conv,
                  lastMessage: content,
                  lastMessageAt: now,
                }
                return false
              }
              return true
            })
          })

          if (targetConv) {
            if (newPages.length > 0) {
              newPages[0].unshift(targetConv)
              // Sort to ensure correct position
              newPages[0] = sortConvs(newPages[0])
            } else {
              newPages.push([targetConv])
            }
          }
          return { ...oldData, pages: newPages }
        }

        if (Array.isArray(oldData)) {
          const targetConv = oldData.find((c: any) => c.id === conversationId)
          const filteredConvs = oldData.filter((c: any) => c.id !== conversationId)

          if (targetConv) {
            const updatedConv = {
              ...targetConv,
              lastMessage: content,
              lastMessageAt: now,
            }
            return sortConvs([updatedConv, ...filteredConvs])
          }
        }

        return oldData
      })

      return { tempId }
    },
  })
}
