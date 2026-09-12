import * as Haptics from 'expo-haptics'
import { useCallback, useEffect, useMemo } from 'react'
import { Alert } from 'react-native'

import { saveChatMediaToLibrary } from '../../lib/chatMediaSave'
import {
  buildConversationMediaGalleryItems,
  getConversationMediaViewerItems,
} from '../../lib/conversation/conversationPresentationPolicies'
import { useChatMediaViewer } from '../../providers/ChatMediaViewerProvider'
import { useChatVideoPlaybackStore } from '../../stores/chatVideoPlaybackStore'

import type {
  ChatMediaGalleryItem,
  ChatMediaViewerOpenPayload,
} from '../../components/chat/ChatMediaViewer'
import type { Message } from '../../types/conversation.types'

type UseConversationMediaViewerRuntimeInput = {
  clearActiveContextMenu: () => void
  conversationId: string
  conversationTitle: string
  orderedMessages: Message[]
  timelineMode: 'latest' | 'anchor'
}

export const useConversationMediaViewerRuntime = ({
  clearActiveContextMenu,
  conversationId,
  conversationTitle,
  orderedMessages,
  timelineMode,
}: UseConversationMediaViewerRuntimeInput) => {
  const clearConversationInlinePlayback = useChatVideoPlaybackStore(
    (state) => state.clearConversation,
  )
  const { closeViewer: closeMediaViewer, openViewer: openMediaViewer } = useChatMediaViewer()

  const mediaGalleryItems = useMemo<ChatMediaGalleryItem[]>(() => {
    return buildConversationMediaGalleryItems(orderedMessages)
  }, [orderedMessages])

  const handleSaveMedia = useCallback(async (item: ChatMediaGalleryItem) => {
    if (!item.canSave) {
      return
    }

    try {
      await saveChatMediaToLibrary({
        type: item.type,
        uri: item.uri,
        ...(item.message.media?.mimeType ? { mimeType: item.message.media.mimeType } : {}),
      })
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      Alert.alert('Saved', `${item.type === 'video' ? 'Video' : 'Photo'} saved to your library.`)
    } catch (error) {
      Alert.alert(
        'Unable to save media',
        error instanceof Error ? error.message : 'Please try again.',
      )
    }
  }, [])

  const handleOpenMedia = useCallback(
    (payload: ChatMediaViewerOpenPayload) => {
      clearActiveContextMenu()

      const sourceIndex = mediaGalleryItems.findIndex((item) => item.id === payload.messageId)
      if (sourceIndex < 0) {
        return
      }

      const viewerItems = getConversationMediaViewerItems({
        items: mediaGalleryItems,
        sourceIndex,
        timelineMode,
      })

      openMediaViewer({
        autoplayVideo: payload.autoplayVideo,
        conversationTitle,
        items: viewerItems,
        messageId: payload.messageId,
        onSave: handleSaveMedia,
        ...(payload.sourceRef ? { sourceRef: payload.sourceRef } : {}),
      })
    },
    [
      clearActiveContextMenu,
      conversationTitle,
      handleSaveMedia,
      mediaGalleryItems,
      openMediaViewer,
      timelineMode,
    ],
  )

  useEffect(() => {
    clearActiveContextMenu()
    closeMediaViewer()
    clearConversationInlinePlayback(conversationId)

    return () => {
      closeMediaViewer()
      clearConversationInlinePlayback(conversationId)
    }
  }, [clearActiveContextMenu, closeMediaViewer, clearConversationInlinePlayback, conversationId])

  return {
    closeMediaViewer,
    handleOpenMedia,
    handleSaveMedia,
    mediaGalleryItems,
  }
}
