import React from 'react'
import { ScrollView, View } from 'react-native'

import { AppPressable, AppText } from '../base'

import type { SearchTagItem } from '../../types/search.types'

function TagChip({
  active,
  accessibilityLabel,
  label,
  onPress,
}: {
  active: boolean
  accessibilityLabel: string
  label: string
  onPress: () => void
}) {
  return (
    <AppPressable
      className={
        active
          ? 'h-9 items-center justify-center rounded-full border border-text-primary bg-text-primary px-4'
          : 'h-9 items-center justify-center rounded-full border border-border-default bg-surface-input px-4'
      }
      // Visually 36pt, but the tap target stays 44pt.
      hitSlop={{ top: 4, bottom: 4 }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={accessibilityLabel}
    >
      <AppText
        className={
          active ? 'text-sm2 font-semibold text-white' : 'font-medium text-sm2 text-text-primary'
        }
        numberOfLines={1}
      >
        {label}
      </AppText>
    </AppPressable>
  )
}

/**
 * Single horizontal rail of topic chips under the search bar. The first chip is
 * always "For you" (personalized recommendations); the rest filter by tag.
 */
export function SearchTagChips({
  activeTag,
  isLoading,
  onSelectForYou,
  onSelectTag,
  tags,
}: {
  activeTag: string | null
  isLoading: boolean
  onSelectForYou: () => void
  onSelectTag: (tag: string) => void
  tags: SearchTagItem[]
}) {
  // A tag opened from elsewhere (e.g. the Tags tab) may not be trending; keep it visible first.
  const visibleTags =
    activeTag && !tags.some((item) => item.tag === activeTag)
      ? [{ tag: activeTag, reelCount: 0 }, ...tags]
      : tags

  return (
    <ScrollView
      horizontal
      // A ScrollView defaults to flexGrow: 1; without this the rail swallows the screen height.
      style={{ flexGrow: 0 }}
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ alignItems: 'center', gap: 8, paddingHorizontal: 16 }}
      accessibilityRole="tablist"
    >
      <TagChip
        active={activeTag === null}
        accessibilityLabel="Show recommended reels for you"
        label="For you"
        onPress={onSelectForYou}
      />

      {visibleTags.map((item) => (
        <TagChip
          key={item.tag}
          active={activeTag === item.tag}
          accessibilityLabel={`Show reels tagged ${item.tag}`}
          label={`#${item.tag}`}
          onPress={() => onSelectTag(item.tag)}
        />
      ))}

      {isLoading && tags.length === 0
        ? [88, 120, 100, 112].map((width) => (
            <View
              key={width}
              className="h-9 rounded-full bg-surface-muted"
              style={{ width }}
              pointerEvents="none"
            />
          ))
        : null}
    </ScrollView>
  )
}
