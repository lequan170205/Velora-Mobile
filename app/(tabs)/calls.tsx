import { MaterialIcons } from '@expo/vector-icons'
import { FlashList as OriginalFlashList } from '@shopify/flash-list'
import React from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { cn } from '../../src/lib/cn'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FlashList = OriginalFlashList as any

const MOCK_CALLS = [
  {
    id: '1',
    name: 'Alice Johnson',
    type: 'VIDEO',
    direction: 'INCOMING',
    date: 'Today, 2:30 PM',
    duration: '5m 20s',
  },
  {
    id: '2',
    name: 'Bob Smith',
    type: 'VOICE',
    direction: 'OUTGOING',
    date: 'Yesterday, 9:15 AM',
    duration: '12m 0s',
  },
  {
    id: '3',
    name: 'Charlie Davis',
    type: 'VIDEO',
    direction: 'MISSED',
    date: 'Monday',
    duration: 'Missed',
  },
]

export default function CallsScreen() {
  const renderItem = ({ item }: { item: (typeof MOCK_CALLS)[0] }) => {
    const isMissed = item.direction === 'MISSED'

    let iconName: keyof typeof MaterialIcons.glyphMap = 'call-received'
    // Dynamic color is a component prop value, not a style prop — not a NativeWind limitation
    let iconColor = '#94a3b8'
    if (isMissed) {
      iconName = 'call-missed'
      iconColor = '#ef4444'
    } else if (item.direction === 'OUTGOING') {
      iconName = 'call-made'
      iconColor = '#94a3b8'
    } else if (item.direction === 'INCOMING') {
      iconName = 'call-received'
      iconColor = '#94a3b8'
    }

    const typeIconName: keyof typeof MaterialIcons.glyphMap =
      item.type === 'VIDEO' ? 'videocam' : 'call'

    return (
      <View className="mx-5">
        <View className="flex-row items-center py-3">
          {/* Avatar */}
          <View className="mr-3">
            <View className="w-14 h-14 rounded-avatar bg-surface-card items-center justify-center">
              <Text className="text-text-primary font-bold text-xl">{item.name.charAt(0)}</Text>
            </View>
          </View>

          {/* Info */}
          <View className="flex-1 justify-center">
            <Text
              className={cn(
                'font-semibold text-md',
                isMissed ? 'text-status-error' : 'text-text-primary',
              )}
              numberOfLines={1}
            >
              {item.name}
            </Text>
            <View className="flex-row items-center mt-1">
              <MaterialIcons
                name={iconName}
                size={16}
                color={iconColor}
                style={{ marginRight: 4 }}
              />
              <Text className="text-text-secondary font-sans text-base2">
                {item.type === 'VIDEO' ? 'Video' : 'Audio'}
              </Text>
            </View>
          </View>

          {/* Right: date + action */}
          <View className="items-end justify-center">
            <Text className="text-text-muted font-sans text-xs2">{item.date}</Text>
            <TouchableOpacity className="w-10 h-10 rounded-full bg-surface-card items-center justify-center mt-1.5">
              <MaterialIcons name={typeIconName} size={24} color="#f8fafc" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-4 z-10">
        <Text className="text-text-primary font-bold text-display">Calls</Text>
      </View>

      {/* List */}
      <View className="flex-1 z-10">
        <FlashList
          data={MOCK_CALLS}
          renderItem={renderItem}
          keyExtractor={(item: (typeof MOCK_CALLS)[0]) => item.id}
          estimatedItemSize={90}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View className="items-center p-8">
              <Text className="text-text-secondary font-sans text-base2">No recent calls.</Text>
            </View>
          }
        />
      </View>
    </SafeAreaView>
  )
}
