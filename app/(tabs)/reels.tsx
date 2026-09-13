import React from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { getDockedTabBarHeight } from '../../src/components/navigation/CustomTabBar'
import { ReelsViewer } from '../../src/components/reels/ReelsViewer'

export default function ReelsScreen() {
  const insets = useSafeAreaInsets()
  const tabBarHeight = getDockedTabBarHeight(insets.bottom)

  return <ReelsViewer mode="public" bottomContentInset={tabBarHeight} tabBarHeight={tabBarHeight} />
}
