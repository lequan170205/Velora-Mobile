import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs'
import { useLocalSearchParams } from 'expo-router'
import React from 'react'

import { ReelsViewer } from '../../src/components/reels/ReelsViewer'

export default function ReelsScreen() {
  const tabBarHeight = useBottomTabBarHeight()
  const { resetKey } = useLocalSearchParams<{ resetKey?: string | string[] }>()
  const normalizedResetKey = Array.isArray(resetKey) ? resetKey[0] : resetKey

  return <ReelsViewer mode="public" resetKey={normalizedResetKey} tabBarHeight={tabBarHeight} />
}
