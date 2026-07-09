import { MaterialIcons } from '@expo/vector-icons'
import React, { memo } from 'react'
import { Image, Pressable, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'

import { useReelDetail } from '../../hooks/useReels'

import type { Message } from '../../types/conversation.types'

type ChatReelCardVariant = 'default' | 'compact'

interface ChatReelCardProps {
  message: Pick<Message, 'content' | 'media'>
  onPress?: () => void
  variant?: ChatReelCardVariant
  width: number
}

export const getChatReelCardThumbnailHeight = (
  width: number,
  variant: ChatReelCardVariant = 'default',
) => {
  return variant === 'compact' ? Math.round(width * (16 / 9)) : Math.round(width * 1.38)
}

export const getChatReelCardHeight = (width: number, variant: ChatReelCardVariant = 'default') => {
  const thumbnailHeight = getChatReelCardThumbnailHeight(width, variant)
  return thumbnailHeight
}

const RoundedPlayIcon = memo(function RoundedPlayIcon({ size = 56 }: { size?: number }) {
  const iconHeight = Math.round(size)
  const iconWidth = Math.round(size)

  return (
    <Svg width={iconWidth} height={iconHeight} viewBox="0 0 56 56">
      <Path
        d="M19 14 L19 42 L42 28 Z"
        fill="#FFFFFF"
        stroke="#FFFFFF"
        strokeLinejoin="round"
        strokeWidth={5}
      />
    </Svg>
  )
})

const getInitialFromLabel = (label: string) =>
  label.replace(/^@+/, '').charAt(0).toUpperCase() || '?'

export const ChatReelCard = memo(function ChatReelCard({
  message,
  onPress,
  variant = 'default',
  width,
}: ChatReelCardProps) {
  const isCompact = variant === 'compact'
  const thumbnailHeight = getChatReelCardThumbnailHeight(width, variant)
  const cardHeight = getChatReelCardHeight(width, variant)
  const canonicalReelId = message.media?.reelId?.trim() || null
  const shouldFetchReelDetail =
    Boolean(canonicalReelId) &&
    (!message.media?.reelOwnerUsername || !message.media?.reelOwnerAvatarUrl)
  const { data: reelDetail } = useReelDetail(canonicalReelId ?? undefined, {
    enabled: shouldFetchReelDetail,
  })

  const thumbnailUri = message.media?.thumbnailUrl || reelDetail?.thumbnailUrl || null
  const reelCreatorUsername = (message.media?.reelOwnerUsername ?? reelDetail?.author?.username)
    ?.trim()
    .replace(/^@+/, '')
  const reelCreatorDisplayName = reelDetail?.author?.displayName?.trim() || null
  const reelCreatorFallbackLabel = reelCreatorDisplayName || 'Velora'
  const reelCreatorLabel = reelCreatorUsername
    ? `@${reelCreatorUsername}`
    : reelCreatorFallbackLabel
  const reelCreatorAvatarUri =
    message.media?.reelOwnerAvatarUrl || reelDetail?.author?.avatarUrl || null
  const hasReelCreatorIdentity = Boolean(
    reelCreatorUsername || reelCreatorDisplayName || reelCreatorAvatarUri,
  )
  const reelCreatorInitial = getInitialFromLabel(reelCreatorLabel)

  const overlayAvatarSize = isCompact ? 18 : 22
  const overlayIconSize = isCompact ? 11 : 13
  const overlayTextSize = isCompact ? 11 : 12
  const overlayHorizontalPadding = isCompact ? 10 : 12
  const overlayVerticalPadding = isCompact ? 10 : 12
  const playIconSize = isCompact ? 40 : 56

  return (
    <Pressable
      className="overflow-hidden rounded-[18px] bg-[#101010]"
      disabled={!onPress}
      onPress={onPress}
      style={{ width, height: cardHeight }}
    >
      <View
        style={{
          width,
          height: thumbnailHeight,
          backgroundColor: '#111111',
        }}
      >
        {thumbnailUri ? (
          <Image
            source={{ uri: thumbnailUri }}
            style={{
              width,
              height: thumbnailHeight,
              backgroundColor: '#111111',
            }}
            resizeMode="cover"
          />
        ) : (
          <View
            style={{
              width,
              height: thumbnailHeight,
              backgroundColor: '#111111',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <RoundedPlayIcon size={playIconSize} />
          </View>
        )}

        {!isCompact ? (
          <View
            pointerEvents="none"
            className="absolute inset-x-0 top-0 flex-row items-center"
            style={{
              paddingHorizontal: overlayHorizontalPadding,
              paddingVertical: overlayVerticalPadding,
            }}
          >
            {reelCreatorAvatarUri ? (
              <Image
                source={{ uri: reelCreatorAvatarUri }}
                style={{
                  width: overlayAvatarSize,
                  height: overlayAvatarSize,
                  borderRadius: overlayAvatarSize / 2,
                  backgroundColor: 'rgba(255,255,255,0.18)',
                }}
                resizeMode="cover"
              />
            ) : (
              <View
                className="items-center justify-center rounded-full bg-white/20"
                style={{ width: overlayAvatarSize, height: overlayAvatarSize }}
              >
                {hasReelCreatorIdentity ? (
                  <Text
                    style={{
                      color: '#FFFFFF',
                      fontSize: isCompact ? 9 : 10,
                      fontWeight: '600',
                    }}
                  >
                    {reelCreatorInitial}
                  </Text>
                ) : (
                  <MaterialIcons name="movie-filter" size={overlayIconSize} color="#FFFFFF" />
                )}
              </View>
            )}
            <Text
              className="ml-2 flex-1 font-semibold text-white"
              numberOfLines={1}
              style={{ fontSize: overlayTextSize }}
            >
              {reelCreatorLabel}
            </Text>
          </View>
        ) : null}

        <View className="absolute inset-0 items-center justify-center">
          <RoundedPlayIcon size={playIconSize} />
        </View>
      </View>
    </Pressable>
  )
})
