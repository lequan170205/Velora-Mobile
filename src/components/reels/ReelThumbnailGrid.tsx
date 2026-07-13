import { MaterialIcons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import React from 'react'
import { Pressable, Text, View } from 'react-native'

import { cn } from '../../lib/cn'

import type { Reel } from '../../types/reel.types'

const REEL_GRID_GAP = 2

const getPlaybackBadge = (status?: string | null) => {
  const normalized = status?.trim().toLowerCase()

  if (
    !normalized ||
    normalized === 'ready' ||
    normalized === 'completed' ||
    normalized === 'published'
  ) {
    return null
  }

  if (normalized === 'processing') {
    return 'Processing'
  }

  if (normalized === 'pending') {
    return 'Queued'
  }

  if (normalized === 'failed') {
    return 'Unavailable'
  }

  return null
}

export function ReelThumbnailTile({
  index,
  onPress,
  reel,
  tileSize,
}: {
  index: number
  onPress: () => void
  reel: Reel
  tileSize: number
}) {
  const playbackBadge = getPlaybackBadge(reel.status)
  const thumbnailUri = reel.thumbnailUrl ?? reel.localThumbnailUri

  return (
    <Pressable
      className="overflow-hidden bg-surface-muted"
      onPress={onPress}
      style={{
        width: tileSize,
        height: tileSize,
        marginBottom: REEL_GRID_GAP,
        marginRight: (index + 1) % 3 === 0 ? 0 : REEL_GRID_GAP,
      }}
    >
      {thumbnailUri ? (
        <Image
          source={{ uri: thumbnailUri }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
        />
      ) : (
        <View className="flex-1 items-center justify-center bg-[#141414]">
          <MaterialIcons name="play-arrow" size={28} color="#FFFFFF" />
        </View>
      )}

      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.62)']}
        className="absolute inset-x-0 bottom-0 h-16"
      />

      <View className="absolute bottom-2 left-2 right-2 flex-row items-end justify-between">
        <Text className="flex-1 text-xs2 font-medium text-white" numberOfLines={1}>
          {reel.title?.trim()}
        </Text>
        <MaterialIcons name="play-arrow" size={18} color="#FFFFFF" />
      </View>

      {playbackBadge ? (
        <View className="absolute left-2 top-2 rounded-full bg-black/58 px-2.5 py-1">
          <Text className="text-xs2 font-medium text-white">{playbackBadge}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

export function ReelThumbnailGrid({
  className,
  onReelPress,
  reels,
  tileSize,
}: {
  className?: string
  onReelPress: (reel: Reel) => void
  reels: Reel[]
  tileSize: number
}) {
  return (
    <View className={cn('flex-row flex-wrap', className)}>
      {reels.map((reel, index) => (
        <ReelThumbnailTile
          key={reel.id}
          index={index}
          onPress={() => onReelPress(reel)}
          reel={reel}
          tileSize={tileSize}
        />
      ))}
    </View>
  )
}

export function ReelThumbnailGridSkeleton({
  className,
  count = 6,
  tileSize,
}: {
  className?: string
  count?: number
  tileSize: number
}) {
  return (
    <View className={cn('flex-row flex-wrap', className)}>
      {Array.from({ length: count }).map((_, index) => (
        <View
          key={`reel-skeleton-${index}`}
          className="bg-surface-muted"
          style={{
            width: tileSize,
            height: tileSize,
            marginBottom: REEL_GRID_GAP,
            marginRight: (index + 1) % 3 === 0 ? 0 : REEL_GRID_GAP,
          }}
        />
      ))}
    </View>
  )
}
