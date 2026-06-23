import React from 'react'
import { Text, View } from 'react-native'

import { typography } from '../../constants/theme'
import { getResolvedMediaPosterUri, getResolvedMediaUri } from '../../lib/chatMedia'
import { cn } from '../../lib/cn'
import { formatDurationLabel } from '../../lib/reels'

import { ChatMediaBubble } from './ChatMediaBubble'
import { ChatMediaFrame } from './ChatMediaFrame'
import { isMessageRecalled } from './MessageContextMenu/helpers'

import type { ChatMediaViewerOpenPayload } from './ChatMediaViewer'
import type { MessageContextMenuTokens } from './MessageContextMenu/constants'
import type { Message } from '../../types/conversation.types'

interface FullVariantHandlers {
  delayLongPress?: number
  onLongPress?: () => void
  onPressIn?: () => void
  onOpenMedia?: (payload: ChatMediaViewerOpenPayload) => void
}

export interface MessageBubbleContentProps {
  message: Message
  isOwn: boolean

  variant: 'full' | 'preview'

  tokens?: MessageContextMenuTokens

  handlers?: FullVariantHandlers
}

const previewImageStyle = {
  borderRadius: 18,
  height: '100%' as const,
  width: '100%' as const,
}

const previewTextStyle = {
  flexShrink: 1,
  fontFamily: typography.fonts.body,
  fontSize: 15,
  lineHeight: 22,
} as const

const previewDurationBadgeStyle = {
  backgroundColor: 'rgba(12,12,13,0.68)',
  borderRadius: 999,
  bottom: 10,
  paddingHorizontal: 8,
  paddingVertical: 4,
  position: 'absolute',
  right: 10,
} as const

const previewDurationTextStyle = {
  color: '#FFFFFF',
  fontSize: 11,
  fontWeight: '600',
} as const

export function MessageBubbleContent({
  message,
  isOwn,
  variant,
  tokens,
  handlers,
}: MessageBubbleContentProps): React.ReactElement | null {
  const isRecalled = isMessageRecalled(message)
  const shouldRenderMediaBubble =
    (message.type === 'image' || message.type === 'video') && !isRecalled

  if (isRecalled) {
    if (variant === 'preview') {
      return (
        <Text
          style={[
            previewTextStyle,
            {
              color: isOwn ? 'rgba(255,255,255,0.72)' : tokens?.textSecondary,
              fontStyle: 'italic',
            },
          ]}
        >
          Tin nhắn đã thu hồi
        </Text>
      )
    }

    return (
      <Text
        className={cn(
          'font-sans text-base italic leading-[22px]',
          isOwn ? 'text-white/60' : 'text-text-muted',
        )}
      >
        Tin nhắn đã thu hồi
      </Text>
    )
  }

  if (shouldRenderMediaBubble) {
    if (variant === 'full') {
      const mediaBubbleHandlers = {
        ...(handlers?.delayLongPress !== undefined
          ? { delayLongPress: handlers.delayLongPress }
          : {}),
        ...(handlers?.onLongPress ? { onLongPress: handlers.onLongPress } : {}),
        ...(handlers?.onOpenMedia ? { onOpenMedia: handlers.onOpenMedia } : {}),
        ...(handlers?.onPressIn ? { onPressIn: handlers.onPressIn } : {}),
      }

      return <ChatMediaBubble message={message} {...mediaBubbleHandlers} />
    }

    const isVideo = message.type === 'video'
    const mediaUri = isVideo
      ? getResolvedMediaPosterUri(message.media)
      : getResolvedMediaUri(message.media)
    const durationLabel = isVideo ? formatDurationLabel(message.media?.durationMs ?? null) : null

    if (!mediaUri) {
      return (
        <Text style={[previewTextStyle, { color: tokens?.textSecondary }]}>
          {isVideo ? 'Video' : 'Photo'}
        </Text>
      )
    }

    return (
      <View style={{ flex: 1, position: 'relative' }}>
        <ChatMediaFrame
          accessibilityLabel={isVideo ? 'Video preview' : 'Photo preview'}
          contentFit="cover"
          disableTransition={true}
          kind={isVideo ? 'video' : 'image'}
          style={previewImageStyle}
          uri={mediaUri}
        />
        {isVideo && durationLabel ? (
          <View style={previewDurationBadgeStyle}>
            <Text style={previewDurationTextStyle}>{durationLabel}</Text>
          </View>
        ) : null}
      </View>
    )
  }

  if (variant === 'preview') {
    const previewTextColor = isOwn ? tokens?.textInverse : tokens?.textPrimary

    return <Text style={[previewTextStyle, { color: previewTextColor }]}>{message.content}</Text>
  }

  return (
    <Text
      className={cn(
        'font-sans text-base leading-[22px]',
        isOwn ? 'text-white' : 'text-text-primary',
      )}
    >
      {message.content}
    </Text>
  )
}
