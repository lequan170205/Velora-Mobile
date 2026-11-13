import React from 'react'
import { View } from 'react-native'

import { colors } from '../../constants/theme'
import { AppPressable, AppText } from '../base'

export type SearchTabKey = 'all' | 'contacts' | 'reels' | 'tags'

const TABS: { key: SearchTabKey; label: string }[] = [
  { key: 'all', label: 'For you' },
  { key: 'contacts', label: 'Accounts' },
  { key: 'reels', label: 'Reels' },
  { key: 'tags', label: 'Tags' },
]

/** Underlined filter tabs shown once the user is searching. */
export function SearchResultTabs({
  onChange,
  selected,
}: {
  onChange: (tab: SearchTabKey) => void
  selected: SearchTabKey
}) {
  return (
    <View className="flex-row border-b border-border-light" accessibilityRole="tablist">
      {TABS.map((tab) => {
        const active = tab.key === selected

        return (
          <AppPressable
            key={tab.key}
            className="min-h-11 flex-1 items-center justify-center px-1"
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${tab.label} search results`}
          >
            <AppText
              className="text-sm2 font-semibold"
              style={{ color: active ? colors.text.primary : colors.text.secondary }}
              numberOfLines={1}
            >
              {tab.label}
            </AppText>
            <View
              className="absolute inset-x-3 bottom-0 h-0.5 rounded-full"
              style={{ backgroundColor: active ? colors.brand.primary : 'transparent' }}
            />
          </AppPressable>
        )
      })}
    </View>
  )
}
