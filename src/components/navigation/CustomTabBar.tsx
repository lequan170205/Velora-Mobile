import { Ionicons } from '@expo/vector-icons'
import { BlurView } from 'expo-blur'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import { useTheme } from 'react-native-paper'
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { BottomTabBarProps } from '@react-navigation/bottom-tabs'

import { colors } from '../../constants/theme'

import { RoundedPlayTileIcon } from './RoundedPlayTileIcon'

import type { MD3Theme } from 'react-native-paper'

const BAR_H = 60

const REELS_INDEX = 2
export const MESSAGES_TAB_INDEX = 0
export const PROFILE_TAB_INDEX = 4

const THEME_FADE = {
  duration: 180,
  easing: Easing.bezier(0.22, 1, 0.36, 1),
} as const

// Messenger/Instagram-style selection feedback: a fast dip then a crisp
// spring settle on the icon itself. No indicator travels across the bar;
// the glyph swap (outline -> filled) IS the active state.
const POP_SPRING = {
  damping: 17,
  stiffness: 420,
  mass: 0.6,
  overshootClamping: false,
} as const

type TabMeta = {
  name: string
  icon: keyof typeof Ionicons.glyphMap
  activeIcon: keyof typeof Ionicons.glyphMap
  label: string
  size: number
}

const TABS: TabMeta[] = [
  {
    name: 'index',
    icon: 'chatbubble-ellipses-outline',
    activeIcon: 'chatbubble-ellipses',
    label: 'Chats',
    size: 25,
  },
  {
    name: 'search',
    icon: 'search-outline',
    activeIcon: 'search',
    label: 'Search',
    size: 24,
  },
  {
    name: 'reels',
    icon: 'play-outline',
    activeIcon: 'play',
    label: 'Reels',
    size: 24,
  },
  {
    name: 'friends',
    icon: 'people-outline',
    activeIcon: 'people',
    label: 'Friends',
    size: 24,
  },
  {
    name: 'profile',
    icon: 'person-outline',
    activeIcon: 'person',
    label: 'Profile',
    size: 24,
  },
]

type BarTheme = {
  // Translucent tint layered over the blur; the blur supplies the rest.
  overlay: string
  activeIcon: string
  inactiveIcon: string
}

const getTabBarBottomInset = (safeAreaBottom: number) =>
  Platform.OS === 'ios' ? Math.max(safeAreaBottom, 12) : Math.max(safeAreaBottom, 16)

export const getDockedTabBarHeight = (safeAreaBottom: number) =>
  BAR_H + getTabBarBottomInset(safeAreaBottom)

function getCustomTabBarTokens(theme: MD3Theme): { light: BarTheme; dark: BarTheme } {
  return {
    light: {
      overlay: 'rgba(255, 255, 255, 0.92)',
      activeIcon: colors.brand.primary,
      inactiveIcon: theme.colors.onSurfaceVariant,
    },
    dark: {
      // Dark frost over the Reels feed; keeps the bar seamless with the
      // full-bleed video behind it, like Instagram's reels tab bar.
      overlay: 'rgba(5, 5, 5, 0.86)',
      activeIcon: '#FFFFFF',
      inactiveIcon: 'rgba(255,255,255,0.58)',
    },
  }
}

type TabItemProps = {
  tab: TabMeta
  index: number
  active: boolean
  activeColor: string
  inactiveColor: string
  onSelect: (nextIndex: number) => void
}

const TabItem = React.memo(function TabItem({
  tab,
  index,
  active,
  activeColor,
  inactiveColor,
  onSelect,
}: TabItemProps) {
  const scale = useSharedValue(1)
  const reduceMotion = useReducedMotion()
  const mountedRef = useRef(false)

  useEffect(() => {
    // Skip the pop on first mount so the initially selected tab doesn't bounce.
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }

    if (active && !reduceMotion) {
      scale.value = withSequence(
        withTiming(0.86, { duration: 80, easing: Easing.out(Easing.quad) }),
        withSpring(1, POP_SPRING),
      )
    }
  }, [active, reduceMotion, scale])

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  return (
    <Pressable
      accessibilityLabel={tab.label}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPressIn={() => onSelect(index)}
      style={styles.tabSlot}
    >
      <Animated.View style={iconStyle}>
        {tab.name === 'reels' ? (
          <RoundedPlayTileIcon
            active={active}
            color={active ? activeColor : inactiveColor}
            size={tab.size}
          />
        ) : (
          <Ionicons
            allowFontScaling={false}
            color={active ? activeColor : inactiveColor}
            name={active ? tab.activeIcon : tab.icon}
            size={tab.size}
          />
        )}
      </Animated.View>
    </Pressable>
  )
})

type CustomTabBarSurfaceProps = {
  activeIndex: number
  forceDarkTheme?: boolean
  onTabSelect: (nextIndex: number, routeName: string) => boolean | void
}

export const CustomTabBarSurface = React.memo(function CustomTabBarSurface({
  activeIndex,
  forceDarkTheme = false,
  onTabSelect,
}: CustomTabBarSurfaceProps) {
  const paperTheme = useTheme<MD3Theme>()
  const insets = useSafeAreaInsets()

  const bottomInset = getTabBarBottomInset(insets.bottom)

  const tokens = useMemo(() => getCustomTabBarTokens(paperTheme), [paperTheme])
  const lightOverlay = tokens.light.overlay
  const darkOverlay = tokens.dark.overlay

  const shouldUseDarkTheme = forceDarkTheme || activeIndex === REELS_INDEX
  const activeColor = shouldUseDarkTheme ? tokens.dark.activeIcon : tokens.light.activeIcon
  const inactiveColor = shouldUseDarkTheme ? tokens.dark.inactiveIcon : tokens.light.inactiveIcon

  // Optimistic selection: the active glyph follows the touch-down instantly;
  // if navigation vetoes the change we roll back to the authoritative index.
  const [selectedIndex, setSelectedIndex] = useState(activeIndex)

  useEffect(() => {
    setSelectedIndex(activeIndex)
  }, [activeIndex])

  const themeProgress = useSharedValue(shouldUseDarkTheme ? 1 : 0)

  useEffect(() => {
    themeProgress.value = withTiming(shouldUseDarkTheme ? 1 : 0, THEME_FADE)
  }, [shouldUseDarkTheme, themeProgress])

  // Two complete frost layers (blur + tint) crossfading. Keeping a full
  // stack per theme avoids blending a single blur's tint mid-transition.
  const lightLayerStyle = useAnimatedStyle(() => ({
    opacity: 1 - themeProgress.value,
  }))

  const darkLayerStyle = useAnimatedStyle(() => ({
    opacity: themeProgress.value,
  }))

  const handleSelect = useCallback(
    (nextIndex: number) => {
      const tab = TABS[nextIndex]
      if (!tab || nextIndex === selectedIndex) {
        return
      }

      setSelectedIndex(nextIndex)
      const didSelect = onTabSelect(nextIndex, tab.name)
      if (didSelect === false) {
        setSelectedIndex(activeIndex)
      }
    },
    [activeIndex, onTabSelect, selectedIndex],
  )

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrapper, { height: BAR_H + bottomInset, paddingBottom: bottomInset }]}
    >
      <Animated.View pointerEvents="none" style={styles.surface}>
        <Animated.View pointerEvents="none" style={[styles.layer, lightLayerStyle]}>
          <BlurView intensity={28} style={styles.layerFill} tint="light" />
          <View style={[styles.layerFill, { backgroundColor: lightOverlay }]} />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.layer, darkLayerStyle]}>
          <BlurView intensity={22} style={styles.layerFill} tint="dark" />
          <View style={[styles.layerFill, { backgroundColor: darkOverlay }]} />
        </Animated.View>
      </Animated.View>

      <View style={styles.row}>
        {TABS.map((tab, index) => (
          <TabItem
            key={tab.name}
            active={index === selectedIndex}
            activeColor={activeColor}
            inactiveColor={inactiveColor}
            index={index}
            onSelect={handleSelect}
            tab={tab}
          />
        ))}
      </View>
    </View>
  )
})

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const handleTabSelect = useCallback(
    (nextIndex: number) => {
      const route = state.routes[nextIndex]
      if (!route) {
        return false
      }

      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      })

      if (event.defaultPrevented) {
        return false
      }

      navigation.navigate(route.name, route.params)
      return true
    },
    [navigation, state.routes],
  )

  return <CustomTabBarSurface activeIndex={state.index} onTabSelect={handleTabSelect} />
}

export default React.memo(CustomTabBar)

// The bar overlays screen content so the frosted background can blur
// whatever scrolls behind it; the navigator reserves no space for it.
const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
  },
  layerFill: {
    ...StyleSheet.absoluteFillObject,
  },
  row: {
    alignSelf: 'center',
    flex: 1,
    flexDirection: 'row',
    // Pull the icon group inward so the outer tabs keep breathing room from
    // the screen edge; the surface behind stays full-width.
    maxWidth: 420,
    paddingHorizontal: 16,
    width: '100%',
  },
  surface: {
    ...StyleSheet.absoluteFillObject,
  },
  tabSlot: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  wrapper: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
  },
})
