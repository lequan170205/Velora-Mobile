import * as Haptics from 'expo-haptics'
import { useCallback, useEffect, useRef } from 'react'

import { useChatStore } from '../../stores/chatStore'
import { useChatMediaUploads } from '../useChatMediaUploads'
import { useRecallMessage } from '../useMessageActions'
import { useSendMessage } from '../useMessages'

import type { MessageInputHandle } from '../../components/chat/MessageInput'
import type { Message } from '../../types/conversation.types'
import type { ImagePickerAsset } from 'expo-image-picker'
import type { RefObject } from 'react'
import type { Socket } from 'socket.io-client'

export type ConversationComposerTimelineActions = {
  cancelOwnSendBottomFollow: () => void
  prepareOwnSendBottomFollow: () => void
  registerPendingOwnMediaBatchScrollTransaction: (batch: {
    batchId: string
    clientMessageIds: string[]
  }) => void
  resetTimestampRevealForReply: () => void
}

type UseConversationComposerRuntimeInput = {
  conversationId: string
  messageInputRef: RefObject<MessageInputHandle | null>
  socket: Socket | null
  timelineActionsRef: RefObject<ConversationComposerTimelineActions | null>
}

const requireTimelineActions = (
  timelineActionsRef: RefObject<ConversationComposerTimelineActions | null>,
) => {
  const timeline = timelineActionsRef.current

  if (!timeline) {
    throw new Error('Conversation timeline actions must be published before composer events')
  }

  return timeline
}

export const useConversationComposerRuntime = ({
  conversationId,
  messageInputRef,
  socket,
  timelineActionsRef,
}: UseConversationComposerRuntimeInput) => {
  const replyToMessage = useChatStore((state) => state.replyToMessage)
  const setReplyToMessage = useChatStore((state) => state.setReplyToMessage)
  const { mutate: sendMessage } = useSendMessage(conversationId)
  const { enqueueMediaAssets } = useChatMediaUploads(conversationId)
  const { mutate: recallMessage } = useRecallMessage(conversationId)
  const typingTimeoutRef = useRef<NodeJS.Timeout | number | null>(null)

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      if (socket?.connected) socket.emit('typing_stop', conversationId)
    }
  }, [conversationId, socket])

  const handleSendMedia = useCallback(
    async (assets: ImagePickerAsset[]) => {
      const timeline = requireTimelineActions(timelineActionsRef)
      const {
        cancelOwnSendBottomFollow,
        prepareOwnSendBottomFollow,
        registerPendingOwnMediaBatchScrollTransaction,
      } = timeline

      prepareOwnSendBottomFollow()

      const queuedMediaBatch = await enqueueMediaAssets(assets, {
        onWillCommitBatch: registerPendingOwnMediaBatchScrollTransaction,
      })

      if (!queuedMediaBatch) {
        cancelOwnSendBottomFollow()
      }
    },
    [enqueueMediaAssets, timelineActionsRef],
  )

  const handleTyping = useCallback(
    (text: string) => {
      if (!socket?.connected) return

      if (!text.trim()) {
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current)
          typingTimeoutRef.current = null
        }
        socket.emit('typing_stop', conversationId)
        return
      }

      socket.emit('typing_start', conversationId)

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
      }

      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('typing_stop', conversationId)
        typingTimeoutRef.current = null
      }, 2000)
    },
    [socket, conversationId],
  )

  const handleReply = useCallback(
    (message: Message) => {
      setReplyToMessage(message)
      const resetTimestampRevealForReply = timelineActionsRef.current?.resetTimestampRevealForReply
      resetTimestampRevealForReply?.()

      requestAnimationFrame(() => {
        messageInputRef.current?.focus()
      })
    },
    [messageInputRef, setReplyToMessage, timelineActionsRef],
  )

  const handleCancelReply = useCallback(() => {
    setReplyToMessage(null)
  }, [setReplyToMessage])

  const handleSendText = useCallback(
    (text: string, replyTo?: Message | null) => {
      const timeline = requireTimelineActions(timelineActionsRef)
      const { prepareOwnSendBottomFollow } = timeline

      prepareOwnSendBottomFollow()

      sendMessage({
        content: text,
        ...(replyTo?.id ? { replyToId: replyTo.id } : {}),
        ...(replyTo ? { replyToMessage: replyTo } : {}),
      })

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
        typingTimeoutRef.current = null
      }
      socket?.emit('typing_stop', conversationId)
    },
    [conversationId, sendMessage, socket, timelineActionsRef],
  )

  const handleSendSuggestedQuery = useCallback(
    (query: string) => {
      handleSendText(query)
    },
    [handleSendText],
  )

  const handleRecall = useCallback(
    (messageId: string) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      recallMessage(messageId)
    },
    [recallMessage],
  )

  return {
    handleCancelReply,
    handleRecall,
    handleReply,
    handleSendMedia,
    handleSendSuggestedQuery,
    handleSendText,
    handleTyping,
    replyToMessage,
  }
}
