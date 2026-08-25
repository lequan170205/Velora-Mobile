import { memo, useCallback } from 'react'
import { Text, View } from 'react-native'

import { useMessageListUiStore } from '../../../stores/messageListUiStore'
import { MessageBubble } from '../MessageBubble'

import type { MessageLayout } from '../../../lib/messageListState'
import type { ChatParticipant, Message } from '../../../types/conversation.types'
import type { ChatMediaViewerOpenPayload } from '../ChatMediaViewer'
import type { MessageBubbleContextMenuPayload } from '../MessageBubble'
import type { Gesture } from 'react-native-gesture-handler'
import type { SharedValue } from 'react-native-reanimated'

type ConversationMessageRowProps = {
  message: Message
  repliedMessage?: Message | null
  layout: MessageLayout
  isOwn: boolean
  primaryStatusLabel: string | null
  readReceiptParticipants: ChatParticipant[]
  timestampRevealGesture?: ReturnType<typeof Gesture.Pan>
  timestampRevealOffset: SharedValue<number>
  timestampRevealProgress: SharedValue<number>
  senderInfo?: ChatParticipant | Message['sender'] | null
  conversationId: string
  isContextMenuActive: boolean
  onPressReplyPreview: (replyToId?: string) => void
  onReply: (message: Message) => void
  onSendSuggestedQuery: (query: string) => void
  onOpenContextMenu: (payload: MessageBubbleContextMenuPayload) => void
  onOpenMedia: (payload: ChatMediaViewerOpenPayload) => void
}

export const ConversationMessageRow = memo(
  function ConversationMessageRow({
    message,
    repliedMessage,
    layout,
    isOwn,
    primaryStatusLabel,
    readReceiptParticipants,
    timestampRevealGesture,
    timestampRevealOffset,
    timestampRevealProgress,
    senderInfo,
    conversationId,
    isContextMenuActive,
    onPressReplyPreview,
    onReply,
    onSendSuggestedQuery,
    onOpenContextMenu,
    onOpenMedia,
  }: ConversationMessageRowProps) {
    const highlightToken = useMessageListUiStore(
      useCallback(
        (state) => state.conversations[conversationId]?.highlightTokens[message.id] ?? 0,
        [conversationId, message.id],
      ),
    )

    const handleReply = useCallback(() => {
      onReply(message)
    }, [message, onReply])

    const handlePressReplyPreview = useCallback(() => {
      onPressReplyPreview(message.replyToId ?? message.reply_to_id)
    }, [message.replyToId, message.reply_to_id, onPressReplyPreview])

    return (
      <View>
        {layout.showDateSeparator ? (
          <View className="my-4 items-center">
            <Text className="text-xs2 text-text-muted">{layout.separatorLabel}</Text>
          </View>
        ) : null}
        <MessageBubble
          message={message}
          repliedMessage={repliedMessage ?? null}
          timeLabel={layout.timeLabel}
          primaryStatusLabel={primaryStatusLabel}
          readReceiptParticipants={readReceiptParticipants}
          timestampRevealGesture={timestampRevealGesture}
          timestampRevealOffset={timestampRevealOffset}
          timestampRevealProgress={timestampRevealProgress}
          isOwn={isOwn}
          showAvatar={layout.showAvatar}
          senderInfo={senderInfo ?? null}
          isGroupedTop={layout.isGroupedTop}
          isGroupedBottom={layout.isGroupedBottom}
          highlightToken={highlightToken}
          isContextMenuActive={isContextMenuActive}
          onPressReplyPreview={handlePressReplyPreview}
          onReply={handleReply}
          onSendSuggestedQuery={onSendSuggestedQuery}
          onOpenContextMenu={onOpenContextMenu}
          onOpenMedia={onOpenMedia}
          conversationId={conversationId}
        />
      </View>
    )
  },
  (prevProps, nextProps) =>
    prevProps.message === nextProps.message &&
    prevProps.repliedMessage === nextProps.repliedMessage &&
    prevProps.layout === nextProps.layout &&
    prevProps.isOwn === nextProps.isOwn &&
    prevProps.primaryStatusLabel === nextProps.primaryStatusLabel &&
    prevProps.readReceiptParticipants === nextProps.readReceiptParticipants &&
    prevProps.timestampRevealGesture === nextProps.timestampRevealGesture &&
    prevProps.timestampRevealOffset === nextProps.timestampRevealOffset &&
    prevProps.timestampRevealProgress === nextProps.timestampRevealProgress &&
    prevProps.senderInfo === nextProps.senderInfo &&
    prevProps.conversationId === nextProps.conversationId &&
    prevProps.isContextMenuActive === nextProps.isContextMenuActive &&
    prevProps.onPressReplyPreview === nextProps.onPressReplyPreview &&
    prevProps.onReply === nextProps.onReply &&
    prevProps.onSendSuggestedQuery === nextProps.onSendSuggestedQuery &&
    prevProps.onOpenContextMenu === nextProps.onOpenContextMenu &&
    prevProps.onOpenMedia === nextProps.onOpenMedia,
)
