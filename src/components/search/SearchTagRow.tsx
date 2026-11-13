import { MaterialIcons } from '@expo/vector-icons'
import React from 'react'
import { View } from 'react-native'

import { colors } from '../../constants/theme'
import { AppPressable, AppText } from '../base'

import type { SearchTagItem } from '../../types/search.types'

const formatReelCount = (count: number) => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(count)
}

export function SearchTagRow({
  item,
  onPress,
}: {
  item: SearchTagItem
  onPress: (tag: string) => void
}) {
  return (
    <AppPressable
      className="flex-row items-center px-5 py-3"
      onPress={() => onPress(item.tag)}
      accessibilityRole="button"
      accessibilityLabel={`Browse reels tagged ${item.tag}`}
    >
      <View className="h-12 w-12 items-center justify-center rounded-full border border-brand-soft bg-surface-accent">
        <MaterialIcons name="tag" size={22} color={colors.brand.tertiary} />
      </View>

      <View className="ml-3 min-w-0 flex-1 pr-3">
        <AppText className="font-medium text-md text-text-primary" numberOfLines={1}>
          #{item.tag}
        </AppText>
        {item.reelCount > 0 ? (
          <AppText className="font-sans mt-0.5 text-sm2 text-text-secondary" numberOfLines={1}>
            {formatReelCount(item.reelCount)} {item.reelCount === 1 ? 'reel' : 'reels'}
          </AppText>
        ) : null}
      </View>

      <MaterialIcons color="#9B958C" name="chevron-right" size={20} />
    </AppPressable>
  )
}
