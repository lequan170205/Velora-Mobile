import { useCallback, useMemo, useState } from 'react'

import type { MessageBubbleContextMenuPayload } from '../../components/chat/MessageBubble'
import type { MessageLayout } from '../../lib/messageListState'
import type { Message } from '../../types/conversation.types'

type UseConversationContextMenuRuntimeInput = {
  currentUserId: string | null
  dismissKeyboardForContextMenu: () => void
  layoutById: Map<string, MessageLayout>
  messageById: Map<string, Message>
  prepareContextMenuKeyboardPreservation: () => boolean
  restoreComposerAfterContextMenu: () => void
}

export const useConversationContextMenuRuntime = ({
  currentUserId,
  dismissKeyboardForContextMenu,
  layoutById,
  messageById,
  prepareContextMenuKeyboardPreservation,
  restoreComposerAfterContextMenu,
}: UseConversationContextMenuRuntimeInput) => {
  const [activeContextMenu, setActiveContextMenu] =
    useState<MessageBubbleContextMenuPayload | null>(null)

  const handleOpenContextMenu = useCallback(
    (payload: MessageBubbleContextMenuPayload) => {
      const shouldDismissKeyboard = prepareContextMenuKeyboardPreservation()

      setActiveContextMenu(payload)

      if (shouldDismissKeyboard) {
        dismissKeyboardForContextMenu()
      }
    },
    [dismissKeyboardForContextMenu, prepareContextMenuKeyboardPreservation],
  )

  const closeActiveContextMenu = useCallback(() => {
    setActiveContextMenu(null)
    restoreComposerAfterContextMenu()
  }, [restoreComposerAfterContextMenu])

  const clearActiveContextMenu = useCallback(() => {
    setActiveContextMenu(null)
  }, [])

  const activeContextMenuMessageId = activeContextMenu?.message.id ?? null
  const activeContextMenuMessage = activeContextMenu?.message ?? null
  const activeContextMenuReplyTarget = activeContextMenu?.replyTarget ?? null
  const activeContextMenuPreviewLayout = activeContextMenu?.previewLayout
  const activeContextMenuAnchor = activeContextMenu?.anchor ?? null
  const activeContextMenuConversationId = activeContextMenu?.conversationId
  const activeContextMenuGestureState = activeContextMenu?.gestureState
  const activeContextMenuFallbackGroupedTop = activeContextMenu?.isGroupedTop ?? false
  const activeContextMenuFallbackGroupedBottom = activeContextMenu?.isGroupedBottom ?? false

  const activeContextMenuData = useMemo(() => {
    if (!activeContextMenuMessageId || !activeContextMenuMessage || !activeContextMenuAnchor) {
      return null
    }

    const currentMessage = messageById.get(activeContextMenuMessageId) ?? activeContextMenuMessage
    const currentLayout = layoutById.get(currentMessage.id)

    return {
      message: currentMessage,
      replyTarget: activeContextMenuReplyTarget,
      previewLayout: activeContextMenuPreviewLayout,
      anchor: activeContextMenuAnchor,
      conversationId: activeContextMenuConversationId,
      gestureState: activeContextMenuGestureState,
      isOwn: currentMessage.senderId === currentUserId,
      isGroupedTop: currentLayout?.isGroupedTop ?? activeContextMenuFallbackGroupedTop,
      isGroupedBottom: currentLayout?.isGroupedBottom ?? activeContextMenuFallbackGroupedBottom,
    }
  }, [
    activeContextMenuAnchor,
    activeContextMenuConversationId,
    activeContextMenuGestureState,
    activeContextMenuFallbackGroupedBottom,
    activeContextMenuFallbackGroupedTop,
    activeContextMenuMessage,
    activeContextMenuMessageId,
    activeContextMenuPreviewLayout,
    activeContextMenuReplyTarget,
    currentUserId,
    layoutById,
    messageById,
  ])

  return {
    activeContextMenuData,
    activeContextMenuMessageId,
    clearActiveContextMenu,
    closeActiveContextMenu,
    handleOpenContextMenu,
  }
}
