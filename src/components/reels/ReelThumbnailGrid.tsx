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

const formatViews = (count?: number) => {
  if (!count || count <= 0) return '0'
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(count)
}

export function ReelThumbnailTile({
  index,
  onPress,
  reel,
  tileSize,
  tileHeight,
  disableMargins,
}: {
  index: number
  onPress: () => void
  reel: Reel
  tileSize: number
  tileHeight?: number | undefined
  disableMargins?: boolean | undefined
}) {
  const playbackBadge = getPlaybackBadge(reel.status)
  const thumbnailUri = reel.thumbnailUrl ?? reel.localThumbnailUri
  const resolvedHeight = tileHeight ?? tileSize

  return (
    <Pressable
      className="overflow-hidden bg-surface-muted"
      onPress={onPress}
      style={{
        width: tileSize,
        height: resolvedHeight,
        marginBottom: disableMargins ? 0 : REEL_GRID_GAP,
        marginRight: disableMargins ? 0 : (index + 1) % 3 === 0 ? 0 : REEL_GRID_GAP,
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
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.65)']}
        className="absolute inset-x-0 bottom-0 h-14"
      />

      <View className="absolute bottom-2 left-2 right-2 flex-row items-center">
        <MaterialIcons name="play-arrow" size={15} color="#FFFFFF" />
        <Text className="ml-0.5 text-xs2 font-semibold text-white">
          {formatViews(reel.viewCount)}
        </Text>
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
  tileHeight,
}: {
  className?: string
  onReelPress: (reel: Reel) => void
  reels: Reel[]
  tileSize: number
  tileHeight?: number | undefined
}) {
  const rows: Reel[][] = []
  for (let i = 0; i < reels.length; i += 3) {
    rows.push(reels.slice(i, i + 3))
  }

  return (
    <View className={cn(className)}>
      {rows.map((row, rowIndex) => (
        <View
          key={`reel-row-${rowIndex}`}
          style={{ flexDirection: 'row', gap: REEL_GRID_GAP, marginBottom: REEL_GRID_GAP }}
        >
          {row.map((reel, index) => (
            <ReelThumbnailTile
              key={reel.id}
              index={index}
              onPress={() => onReelPress(reel)}
              reel={reel}
              tileSize={tileSize}
              tileHeight={tileHeight}
              disableMargins
            />
          ))}
          {row.length < 3 &&
            Array.from({ length: 3 - row.length }).map((_, emptyIndex) => (
              <View
                key={`empty-slot-${emptyIndex}`}
                style={{ width: tileSize, height: tileHeight ?? tileSize }}
              />
            ))}
        </View>
      ))}
    </View>
  )
}

export function ReelThumbnailGridSkeleton({
  className,
  count = 6,
  tileSize,
  tileHeight,
}: {
  className?: string
  count?: number
  tileSize: number
  tileHeight?: number | undefined
  disableMargins?: boolean | undefined
}) {
  const resolvedHeight = tileHeight ?? tileSize
  const rowCount = Math.ceil(count / 3)

  return (
    <View className={cn(className)}>
      {Array.from({ length: rowCount }).map((_, rowIndex) => {
        const itemsInRow = Math.min(3, count - rowIndex * 3)

        return (
          <View
            key={`reel-skeleton-row-${rowIndex}`}
            style={{ flexDirection: 'row', gap: REEL_GRID_GAP, marginBottom: REEL_GRID_GAP }}
          >
            {Array.from({ length: itemsInRow }).map((_, colIndex) => (
              <View
                key={`reel-skeleton-${rowIndex}-${colIndex}`}
                className="bg-surface-muted"
                style={{
                  width: tileSize,
                  height: resolvedHeight,
                }}
              />
            ))}
            {itemsInRow < 3 &&
              Array.from({ length: 3 - itemsInRow }).map((_, emptyIndex) => (
                <View
                  key={`empty-skeleton-slot-${emptyIndex}`}
                  style={{ width: tileSize, height: resolvedHeight }}
                />
              ))}
          </View>
        )
      })}
    </View>
  )
}
