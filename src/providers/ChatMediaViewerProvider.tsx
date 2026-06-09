import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { measure } from 'react-native-reanimated'
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets'

import {
  ChatMediaViewer,
  type ChatMediaGalleryItem,
  type ChatMediaViewerOpenPayload,
  type ChatMediaViewerPresentationPayload,
  type MediaSourceFrame,
} from '../components/chat/ChatMediaViewer'

interface OpenChatMediaViewerOptions {
  autoplayVideo: boolean
  conversationTitle?: string
  items: ChatMediaGalleryItem[]
  messageId: string
  onSave?: (item: ChatMediaGalleryItem) => Promise<void> | void
  sourceRef?: ChatMediaViewerOpenPayload['sourceRef']
}

interface ChatMediaViewerContextValue {
  closeViewer: () => void
  openViewer: (options: OpenChatMediaViewerOptions) => void
}

interface ViewerSession {
  conversationTitle?: string
  items: ChatMediaGalleryItem[]
  onSave?: (item: ChatMediaGalleryItem) => Promise<void> | void
  payload: ChatMediaViewerPresentationPayload
}

const ChatMediaViewerContext = createContext<ChatMediaViewerContextValue | null>(null)

export function ChatMediaViewerProvider({ children }: { children: React.ReactNode }) {
  const openRequestIdRef = useRef(0)
  const [savingMessageId, setSavingMessageId] = useState<string | null>(null)
  const [session, setSession] = useState<ViewerSession | null>(null)

  const closeViewer = useCallback(() => {
    openRequestIdRef.current += 1
    setSavingMessageId(null)
    setSession(null)
  }, [])

  const openViewer = useCallback((options: OpenChatMediaViewerOptions) => {
    if (!options.items.length) {
      return
    }

    const sourceItemIndex = options.items.findIndex((item) => item.id === options.messageId)
    if (sourceItemIndex < 0) {
      return
    }

    openRequestIdRef.current += 1
    const openRequestId = openRequestIdRef.current
    const presentViewer = (sourceFrame: MediaSourceFrame | null) => {
      if (openRequestIdRef.current !== openRequestId) {
        return
      }

      const payload: ChatMediaViewerPresentationPayload = {
        autoplayVideo: options.autoplayVideo,
        messageId: options.messageId,
        ...(sourceFrame ? { sourceFrame } : {}),
      }

      setSavingMessageId(null)
      setSession({
        items: options.items,
        payload,
        ...(options.conversationTitle ? { conversationTitle: options.conversationTitle } : {}),
        ...(options.onSave ? { onSave: options.onSave } : {}),
      })
    }

    if (!options.sourceRef) {
      presentViewer(null)
      return
    }

    scheduleOnUI((sourceRef) => {
      'worklet'
      const measured = measure(sourceRef)
      scheduleOnRN(
        presentViewer,
        measured
          ? {
              height: measured.height,
              width: measured.width,
              x: measured.pageX,
              y: measured.pageY,
            }
          : null,
      )
    }, options.sourceRef)
  }, [])

  const handleSave = useCallback(
    async (item: ChatMediaGalleryItem) => {
      const onSave = session?.onSave
      if (!onSave) {
        return
      }

      setSavingMessageId(item.id)
      try {
        await onSave(item)
      } finally {
        setSavingMessageId((current) => (current === item.id ? null : current))
      }
    },
    [session?.onSave],
  )

  const value = useMemo<ChatMediaViewerContextValue>(
    () => ({
      closeViewer,
      openViewer,
    }),
    [closeViewer, openViewer],
  )

  return (
    <ChatMediaViewerContext.Provider value={value}>
      {children}
      <ChatMediaViewer
        initialPayload={session?.payload ?? null}
        items={session?.items ?? []}
        onRequestClose={closeViewer}
        savingMessageId={savingMessageId}
        {...(session?.conversationTitle ? { conversationTitle: session.conversationTitle } : {})}
        {...(session?.onSave ? { onSave: handleSave } : {})}
      />
    </ChatMediaViewerContext.Provider>
  )
}

export const useChatMediaViewer = () => {
  const context = useContext(ChatMediaViewerContext)
  if (!context) {
    throw new Error('useChatMediaViewer must be used within a ChatMediaViewerProvider')
  }

  return context
}
