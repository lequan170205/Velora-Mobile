import { MaterialIcons } from '@expo/vector-icons'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dimensions, Platform, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useTheme } from 'react-native-paper'
import Animated, {
  Easing,
  Extrapolation,
  type SharedValue,
  clamp,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { scheduleOnRN } from 'react-native-worklets'

import type { BottomTabBarProps } from '@react-navigation/bottom-tabs'

import type { MD3Theme } from 'react-native-paper'

const SCREEN_W = Dimensions.get('window').width
const FLOATING_BAR_W = Math.min(Math.round(SCREEN_W * 0.86), 360)
const DOCKED_BAR_W = SCREEN_W
const PILL_H = 60
const NUM_TABS = 5

const CIRCLE_SIZE = 60
const CIRCLE_RADIUS = CIRCLE_SIZE / 2
const CIRCLE_TOP = 0
const CUTOUT_GAP = 6
const BASE_CUTOUT_RADIUS = CIRCLE_RADIUS + CUTOUT_GAP
const FLOAT_LIFT = 14

const REELS_INDEX = 2

const DOCK_EASING = Easing.bezier(0.22, 1, 0.36, 1)

const POSITION_SPRING = {
  damping: 18,
  stiffness: 240,
  mass: 0.85,
  overshootClamping: false,
} as const

const PRESS_SPRING = {
  damping: 12,
  stiffness: 260,
  mass: 0.58,
  overshootClamping: false,
} as const

type TrackTheme = {
  pill: string
  border: string
  inactive: string
}

type CustomTabBarTokens = {
  accent: string
  iconOnAccent: string
  light: TrackTheme
  dark: TrackTheme
}

type TabMeta = {
  name: string
  icon: keyof typeof MaterialIcons.glyphMap
  size: number
}

type TabIconSlotProps = {
  icon: keyof typeof MaterialIcons.glyphMap
  size: number
  slotIndex: number
  slotWidth: SharedValue<number>
  activeCenterX: SharedValue<number>
  themeProgress: SharedValue<number>
  activeIconColor: string
  lightInactiveColor: string
  darkInactiveColor: string
}

const TABS: TabMeta[] = [
  { name: 'index', icon: 'chat-bubble-outline', size: 24 },
  { name: 'contacts', icon: 'people-outline', size: 26 },
  { name: 'reels', icon: 'play-circle-outline', size: 26 },
  { name: 'calls', icon: 'call', size: 23 },
  { name: 'profile', icon: 'person-outline', size: 25 },
]

const REELS_DARK_THEME: TrackTheme = {
  pill: '#111214',
  border: 'transparent',
  inactive: 'rgba(255,255,255,0.58)',
}

function getCustomTabBarTokens(theme: MD3Theme): CustomTabBarTokens {
  return {
    accent: theme.colors.primary,
    iconOnAccent: theme.colors.onPrimary,
    light: {
      pill: theme.colors.elevation.level1,
      border: theme.colors.outline,
      inactive: theme.colors.onSurfaceVariant,
    },
    dark: REELS_DARK_THEME,
  }
}

const TabIconSlot = React.memo(function TabIconSlot({
  icon,
  size,
  slotIndex,
  slotWidth,
  activeCenterX,
  themeProgress,
  activeIconColor,
  lightInactiveColor,
  darkInactiveColor,
}: TabIconSlotProps) {
  const slotCenterX = useDerivedValue(() => slotWidth.value * slotIndex + slotWidth.value / 2)

  const smoothFocus = useDerivedValue(() => {
    const distance = Math.abs(activeCenterX.value - slotCenterX.value)
    const focus = interpolate(distance, [0, slotWidth.value], [1, 0], Extrapolation.CLAMP)

    return focus * focus * (3 - 2 * focus)
  })

  const activeStyle = useAnimatedStyle(() => {
    return {
      opacity: smoothFocus.value,
      transform: [{ scale: 0.92 + smoothFocus.value * 0.08 }],
    }
  })

  const lightInactiveStyle = useAnimatedStyle(() => {
    const inactiveOpacity = 1 - smoothFocus.value
    const inactiveScale = 1 - smoothFocus.value * 0.04

    return {
      opacity: inactiveOpacity * (1 - themeProgress.value),
      transform: [{ scale: inactiveScale }],
    }
  })

  const darkInactiveStyle = useAnimatedStyle(() => {
    const inactiveOpacity = 1 - smoothFocus.value
    const inactiveScale = 1 - smoothFocus.value * 0.04

    return {
      opacity: inactiveOpacity * themeProgress.value,
      transform: [{ scale: inactiveScale }],
    }
  })

  return (
    <View style={styles.slot}>
      <Animated.View pointerEvents="none" style={[styles.iconLayer, lightInactiveStyle]}>
        <MaterialIcons color={lightInactiveColor} name={icon} size={size} />
      </Animated.View>

      <Animated.View pointerEvents="none" style={[styles.iconLayer, darkInactiveStyle]}>
        <MaterialIcons color={darkInactiveColor} name={icon} size={size} />
      </Animated.View>

      <Animated.View pointerEvents="none" style={[styles.iconLayer, activeStyle]}>
        <MaterialIcons color={activeIconColor} name={icon} size={size} />
      </Animated.View>
    </View>
  )
})

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const paperTheme = useTheme<MD3Theme>()
  const insets = useSafeAreaInsets()
  const bottomInset =
    Platform.OS === 'ios' ? Math.max(insets.bottom, 12) : Math.max(insets.bottom, 16)
  const tokens = useMemo(() => getCustomTabBarTokens(paperTheme), [paperTheme])
  const accentColor = tokens.accent
  const iconOnAccentColor = tokens.iconOnAccent
  const lightInactiveColor = tokens.light.inactive
  const darkInactiveColor = tokens.dark.inactive
  const lightPillColor = tokens.light.pill
  const darkPillColor = tokens.dark.pill
  const lightBorderColor = tokens.light.border
  const darkBorderColor = tokens.dark.border

  const isReelsActive = state.index === REELS_INDEX
  const [isDockedLayout, setIsDockedLayout] = useState(isReelsActive)

  const wrapperHeight = isDockedLayout ? PILL_H + bottomInset : PILL_H + bottomInset + FLOAT_LIFT

  const activeIndexPosition = useSharedValue(state.index)
  const pressProgress = useSharedValue(0)
  const dockProgress = useSharedValue(isReelsActive ? 1 : 0)
  const themeProgress = useSharedValue(isReelsActive ? 1 : 0)

  const previousIndexRef = useRef(state.index)

  const barWidth = useDerivedValue(() =>
    interpolate(dockProgress.value, [0, 1], [FLOATING_BAR_W, DOCKED_BAR_W], Extrapolation.CLAMP),
  )

  const slotWidth = useDerivedValue(() => barWidth.value / NUM_TABS)

  const activeCenterX = useDerivedValue(
    () => activeIndexPosition.value * slotWidth.value + slotWidth.value / 2,
  )

  const cutoutRadius = useDerivedValue(
    () =>
      interpolate(
        dockProgress.value,
        [0, 1],
        [BASE_CUTOUT_RADIUS + 1, BASE_CUTOUT_RADIUS - 2],
        Extrapolation.CLAMP,
      ) +
      pressProgress.value * 2,
  )

  const barStageStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(dockProgress.value, [0, 1], [-FLOAT_LIFT, 0], Extrapolation.CLAMP),
      },
    ],
    width: barWidth.value,
  }))

  const bubbleThemeStyle = useMemo(
    () => ({
      backgroundColor: accentColor,
    }),
    [accentColor],
  )

  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: activeCenterX.value - CIRCLE_RADIUS },
      { translateY: -pressProgress.value * 1.5 },
      { scaleX: 1 - pressProgress.value * 0.04 },
      { scaleY: 1 - pressProgress.value * 0.04 },
    ],
  }))

  const leftSegmentStyle = useAnimatedStyle(() => {
    const segmentEnd = clamp(activeCenterX.value - cutoutRadius.value, 0, barWidth.value)

    return {
      left: 0,
      opacity: segmentEnd > 1 ? 1 : 0,
      width: segmentEnd,
    }
  })

  const rightSegmentStyle = useAnimatedStyle(() => {
    const segmentStart = clamp(activeCenterX.value + cutoutRadius.value, 0, barWidth.value)
    const segmentWidth = Math.max(0, barWidth.value - segmentStart)

    return {
      left: segmentStart,
      opacity: segmentWidth > 1 ? 1 : 0,
      width: segmentWidth,
    }
  })

  const wrapperSurfaceStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(themeProgress.value, [0, 1], [lightPillColor, darkPillColor]),
    opacity: dockProgress.value,
  }))

  const trackSegmentThemeStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(themeProgress.value, [0, 1], [lightPillColor, darkPillColor]),
    borderColor: interpolateColor(themeProgress.value, [0, 1], [lightBorderColor, darkBorderColor]),
  }))

  const triggerPressPulse = useCallback(() => {
    pressProgress.value = 0
    pressProgress.value = withSequence(withTiming(1, { duration: 70 }), withSpring(0, PRESS_SPRING))
  }, [pressProgress])

  useEffect(() => {
    dockProgress.value = withTiming(isDockedLayout ? 1 : 0, {
      duration: isDockedLayout ? 320 : 260,
      easing: DOCK_EASING,
    })
  }, [dockProgress, isDockedLayout])

  useEffect(() => {
    if (state.index === REELS_INDEX) {
      setIsDockedLayout(true)
      return
    }

    setIsDockedLayout(false)
  }, [state.index])

  useEffect(() => {
    if (previousIndexRef.current === state.index) {
      return
    }

    previousIndexRef.current = state.index
    activeIndexPosition.value = withSpring(state.index, POSITION_SPRING)
    themeProgress.value = withTiming(isReelsActive ? 1 : 0, {
      duration: 180,
      easing: DOCK_EASING,
    })
    triggerPressPulse()
  }, [activeIndexPosition, isReelsActive, state.index, themeProgress, triggerPressPulse])

  const prepareLayoutForIndex = useCallback((nextIndex: number) => {
    setIsDockedLayout(nextIndex === REELS_INDEX)
  }, [])

  const handleTapSelection = useCallback(
    (nextIndex: number) => {
      const route = state.routes[nextIndex]
      if (!route) {
        return
      }

      const isFocused = state.index === nextIndex
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      })

      if (!isFocused && !event.defaultPrevented) {
        prepareLayoutForIndex(nextIndex)

        if (route.name === 'reels') {
          navigation.navigate({
            name: route.name,
            params: { resetKey: String(Date.now()) },
            merge: false,
          })
          return
        }

        navigation.navigate(route.name, route.params)
      }
    },
    [navigation, prepareLayoutForIndex, state.index, state.routes],
  )

  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(220)
        .maxDistance(18)
        .onEnd((event, success) => {
          if (!success) {
            return
          }

          const currentBarWidth = barWidth.value
          const nextIndex = clamp(
            Math.floor(event.x / (currentBarWidth / NUM_TABS)),
            0,
            NUM_TABS - 1,
          )

          activeIndexPosition.value = withSpring(nextIndex, POSITION_SPRING)
          pressProgress.value = withSequence(
            withTiming(1, { duration: 70 }),
            withSpring(0, PRESS_SPRING),
          )

          if (nextIndex !== state.index) {
            scheduleOnRN(handleTapSelection, nextIndex)
          }
        }),
    [activeIndexPosition, barWidth, handleTapSelection, pressProgress, state.index],
  )

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        {
          height: wrapperHeight,
          marginTop: isDockedLayout ? 0 : -wrapperHeight,
          paddingBottom: bottomInset,
        },
      ]}
    >
      <Animated.View pointerEvents="none" style={[styles.wrapperBackground, wrapperSurfaceStyle]} />

      <GestureDetector gesture={tapGesture}>
        <Animated.View style={[styles.barStage, barStageStyle]}>
          <Animated.View style={[styles.bubble, bubbleThemeStyle, bubbleStyle]} />

          <View pointerEvents="none" style={styles.trackContainer}>
            <Animated.View
              style={[styles.trackSegment, trackSegmentThemeStyle, leftSegmentStyle]}
            />
            <Animated.View
              style={[styles.trackSegment, trackSegmentThemeStyle, rightSegmentStyle]}
            />
          </View>

          <View pointerEvents="none" style={styles.iconsRow}>
            {TABS.map((tab, index) => (
              <TabIconSlot
                key={tab.name}
                activeCenterX={activeCenterX}
                activeIconColor={iconOnAccentColor}
                darkInactiveColor={darkInactiveColor}
                icon={tab.icon}
                lightInactiveColor={lightInactiveColor}
                size={tab.size}
                slotIndex={index}
                slotWidth={slotWidth}
                themeProgress={themeProgress}
              />
            ))}
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  )
}

export default React.memo(CustomTabBar)

const styles = StyleSheet.create({
  barStage: {
    height: PILL_H,
    overflow: 'visible',
  },
  bubble: {
    borderRadius: CIRCLE_RADIUS,
    height: CIRCLE_SIZE,
    left: 0,
    position: 'absolute',
    top: CIRCLE_TOP,
    width: CIRCLE_SIZE,
  },
  iconLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconsRow: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    flexDirection: 'row',
  },
  slot: {
    alignItems: 'center',
    flex: 1,
    height: PILL_H,
    justifyContent: 'center',
  },
  trackContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  trackSegment: {
    borderRadius: PILL_H / 2,
    borderWidth: StyleSheet.hairlineWidth,
    height: PILL_H,
    position: 'absolute',
    top: 0,
  },
  wrapper: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  wrapperBackground: {
    ...StyleSheet.absoluteFillObject,
  },
})
