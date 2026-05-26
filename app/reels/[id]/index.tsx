import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useCallback } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  CustomTabBarSurface,
  getDockedTabBarHeight,
  PROFILE_TAB_INDEX,
} from '../../../src/components/navigation/CustomTabBar'
import { ReelsViewer } from '../../../src/components/reels/ReelsViewer'

export default function ReelContextScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id, source, returnTo, returnUsername } = useLocalSearchParams<{
    id?: string | string[]
    source?: string | string[]
    returnTo?: string | string[]
    returnUsername?: string | string[]
  }>()
  const reelId = Array.isArray(id) ? id[0] : id
  const contextSource = Array.isArray(source) ? source[0] : source
  const normalizedReturnTo = Array.isArray(returnTo) ? returnTo[0] : returnTo
  const normalizedReturnUsername = Array.isArray(returnUsername)
    ? returnUsername[0]
    : returnUsername
  const tabBarHeight = getDockedTabBarHeight(insets.bottom)
  const handleTabSelect = useCallback(
    (_nextIndex: number, routeName: string) => {
      if (routeName === 'index') {
        router.replace('/')
        return true
      }

      router.replace(`/${routeName}` as never)
      return true
    },
    [router],
  )

  if (!reelId) {
    return <ReelsViewer mode="public" />
  }

  return (
    <View className="flex-1 bg-[#050505]">
      <ReelsViewer
        mode="context"
        reelId={reelId}
        contextSource={contextSource === 'public' ? 'public' : 'profile'}
        returnTo={normalizedReturnTo}
        returnUsername={normalizedReturnUsername}
        bottomContentInset={tabBarHeight}
        tabBarHeight={tabBarHeight}
      />

      <View pointerEvents="box-none" style={styles.tabBarOverlay}>
        <CustomTabBarSurface
          activeIndex={PROFILE_TAB_INDEX}
          forceDarkTheme
          forceDockedLayout
          onTabSelect={handleTabSelect}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  tabBarOverlay: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
  },
})
