import { MaterialIcons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import {
  FlatList,
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler'
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { scheduleOnRN } from 'react-native-worklets'

import { formatDurationLabel } from '../../lib/reels'
import { ReelVideo } from '../reels/ReelVideo'

import type { Message } from '../../types/conversation.types'
import type { ListRenderItemInfo } from 'react-native'

export interface MediaSourceFrame {
  height: number
  width: number
  x: number
  y: number
}

export interface ChatMediaViewerOpenPayload {
  autoplayVideo: boolean
  messageId: string
  sourceFrame: MediaSourceFrame
}

export interface ChatMediaGalleryItem {
  canSave: boolean
  id: string
  message: Message
  posterUri?: string
  type: 'image' | 'video'
  uri: string
}

interface ChatMediaViewerProps {
  conversationTitle?: string
  initialPayload: ChatMediaViewerOpenPayload | null
  isLoadingOlder?: boolean
  items: ChatMediaGalleryItem[]
  onLoadOlder?: () => void
  onRequestClose: () => void
  onSave?: (item: ChatMediaGalleryItem) => void
  savingMessageId?: string | null
}

const SPRING_CONFIG = { damping: 24, stiffness: 260, mass: 0.72 } as const
const HERO_OPEN_SPRING_CONFIG = {
  damping: 28,
  mass: 0.86,
  stiffness: 250,
} as const
const HERO_CLOSE_SPRING_CONFIG = {
  damping: 30,
  mass: 0.78,
  stiffness: 320,
} as const
const DISMISS_RETURN_SPRING_CONFIG = { damping: 22, stiffness: 220, mass: 0.8 } as const
const DISMISS_EXIT_SPRING_CONFIG = {
  damping: 50,
  overshootClamping: true,
  stiffness: 200,
} as const
const DISMISS_DISTANCE_THRESHOLD = 132
const DISMISS_VELOCITY_THRESHOLD = 980

const formatShort = (ts?: number | string) => {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  return isToday
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

const getSenderName = (message?: Message | null) => {
  const sender = message?.sender as
    | (Message['sender'] & {
        fullName?: string | null
        name?: string | null
        username?: string | null
      })
    | undefined

  return (
    sender?.fullName?.trim() ||
    sender?.name?.trim() ||
    sender?.username?.trim() ||
    sender?.email?.trim() ||
    ''
  )
}

const getAvatarInitials = (senderName: string) => {
  return senderName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

const getContainedRect = ({
  contentHeight,
  contentWidth,
  height,
  top,
  width,
}: {
  contentHeight: number
  contentWidth: number
  height: number
  top: number
  width: number
}): MediaSourceFrame => {
  const ratio = Math.min(width / contentWidth, height / contentHeight)
  const nextWidth = contentWidth * ratio
  const nextHeight = contentHeight * ratio

  return {
    height: nextHeight,
    width: nextWidth,
    x: (width - nextWidth) / 2,
    y: top + (height - nextHeight) / 2,
  }
}

function ZoomableImage({
  item,
  chromeVisible,
  isActive,
  isZoomed,
  screenHeight,
  screenWidth,
  setIsChromeVisible,
  onZoomChange,
}: {
  item: ChatMediaGalleryItem
  chromeVisible: { value: number }
  isActive: boolean
  isZoomed: boolean
  screenHeight: number
  screenWidth: number
  setIsChromeVisible: (visible: boolean) => void
  onZoomChange: (zoomed: boolean) => void
}) {
  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const translateX = useSharedValue(0)
  const translateY = useSharedValue(0)
  const savedTranslateX = useSharedValue(0)
  const savedTranslateY = useSharedValue(0)

  useEffect(() => {
    if (!isActive) {
      scale.value = 1
      savedScale.value = 1
      translateX.value = 0
      translateY.value = 0
      savedTranslateX.value = 0
      savedTranslateY.value = 0
    }
  }, [isActive, savedScale, savedTranslateX, savedTranslateY, scale, translateX, translateY])

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .enabled(isActive)
        .onUpdate((event) => {
          'worklet'
          scale.value = Math.max(1, Math.min(savedScale.value * event.scale, 4))
        })
        .onEnd(() => {
          'worklet'
          if (scale.value <= 1.02) {
            scale.value = withSpring(1, SPRING_CONFIG)
            savedScale.value = 1
            translateX.value = withSpring(0, SPRING_CONFIG)
            translateY.value = withSpring(0, SPRING_CONFIG)
            savedTranslateX.value = 0
            savedTranslateY.value = 0
            scheduleOnRN(onZoomChange, false)
            return
          }

          savedScale.value = scale.value
          scheduleOnRN(onZoomChange, true)
        }),
    [
      isActive,
      onZoomChange,
      savedScale,
      savedTranslateX,
      savedTranslateY,
      scale,
      translateX,
      translateY,
    ],
  )
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(isActive && isZoomed)
        .onUpdate((event) => {
          'worklet'
          translateX.value = savedTranslateX.value + event.translationX
          translateY.value = savedTranslateY.value + event.translationY
        })
        .onEnd(() => {
          'worklet'
          const maxTranslateX = ((scale.value - 1) * screenWidth) / 2
          const maxTranslateY = ((scale.value - 1) * screenHeight) / 2
          const clampedX = Math.max(-maxTranslateX, Math.min(maxTranslateX, translateX.value))
          const clampedY = Math.max(-maxTranslateY, Math.min(maxTranslateY, translateY.value))

          translateX.value = withSpring(clampedX, SPRING_CONFIG)
          translateY.value = withSpring(clampedY, SPRING_CONFIG)
          savedTranslateX.value = clampedX
          savedTranslateY.value = clampedY
        }),
    [
      isActive,
      isZoomed,
      savedTranslateX,
      savedTranslateY,
      scale,
      screenHeight,
      screenWidth,
      translateX,
      translateY,
    ],
  )
  const doubleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .enabled(isActive)
        .numberOfTaps(2)
        .maxDuration(260)
        .onEnd((event) => {
          'worklet'
          const isZoomingIn = scale.value <= 1.02
          const nextScale = isZoomingIn ? 2.5 : 1
          scale.value = withSpring(nextScale, SPRING_CONFIG)
          savedScale.value = nextScale

          if (isZoomingIn) {
            const centerX = screenWidth / 2
            const centerY = screenHeight / 2
            const nextTranslateX = (centerX - event.x) * (nextScale - 1)
            const nextTranslateY = (centerY - event.y) * (nextScale - 1)

            translateX.value = withSpring(nextTranslateX, SPRING_CONFIG)
            translateY.value = withSpring(nextTranslateY, SPRING_CONFIG)
            savedTranslateX.value = nextTranslateX
            savedTranslateY.value = nextTranslateY
          } else {
            translateX.value = withSpring(0, SPRING_CONFIG)
            translateY.value = withSpring(0, SPRING_CONFIG)
            savedTranslateX.value = 0
            savedTranslateY.value = 0
          }

          scheduleOnRN(onZoomChange, isZoomingIn)
        }),
    [
      isActive,
      onZoomChange,
      savedScale,
      savedTranslateX,
      savedTranslateY,
      scale,
      screenHeight,
      screenWidth,
      translateX,
      translateY,
    ],
  )
  const singleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .enabled(isActive)
        .numberOfTaps(1)
        .requireExternalGestureToFail(doubleTapGesture)
        .onEnd(() => {
          'worklet'
          const nextValue = chromeVisible.value === 1 ? 0 : 1
          chromeVisible.value = withSpring(nextValue, { damping: 24, stiffness: 260, mass: 0.9 })
          scheduleOnRN(setIsChromeVisible, nextValue === 1)
        }),
    [chromeVisible, doubleTapGesture, isActive, setIsChromeVisible],
  )
  const composedGesture = useMemo(
    () =>
      Gesture.Simultaneous(
        pinchGesture,
        panGesture,
        Gesture.Exclusive(doubleTapGesture, singleTapGesture),
      ),
    [doubleTapGesture, panGesture, pinchGesture, singleTapGesture],
  )
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }))

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View style={[styles.page, animatedStyle]}>
        <Image
          accessibilityLabel="Media photo"
          cachePolicy="memory-disk"
          contentFit="contain"
          recyclingKey={item.uri}
          source={{ uri: item.uri }}
          style={styles.page}
        />
      </Animated.View>
    </GestureDetector>
  )
}

const GalleryPage = memo(function GalleryPage({
  item,
  chromeVisible,
  isActive,
  isTransitionComplete,
  shouldAutoplay,
  isZoomed,
  screenHeight,
  screenWidth,
  setIsChromeVisible,
  onZoomChange,
}: {
  item: ChatMediaGalleryItem
  chromeVisible: { value: number }
  isActive: boolean
  isTransitionComplete: boolean
  isZoomed: boolean
  screenHeight: number
  screenWidth: number
  setIsChromeVisible: (visible: boolean) => void
  shouldAutoplay: boolean
  onZoomChange: (zoomed: boolean) => void
}) {
  if (item.type === 'video') {
    return (
      <View style={styles.page}>
        <ReelVideo
          contentFit="contain"
          nativeControls
          shouldPlay={isActive && isTransitionComplete && shouldAutoplay}
          uri={item.uri}
          {...(item.posterUri ? { posterUri: item.posterUri } : {})}
          style={styles.page}
        />
      </View>
    )
  }

  return (
    <ZoomableImage
      chromeVisible={chromeVisible}
      isActive={isActive}
      isZoomed={isZoomed}
      item={item}
      screenHeight={screenHeight}
      screenWidth={screenWidth}
      setIsChromeVisible={setIsChromeVisible}
      onZoomChange={onZoomChange}
    />
  )
})

export function ChatMediaViewer({
  conversationTitle,
  initialPayload,
  isLoadingOlder = false,
  items,
  onLoadOlder,
  onRequestClose,
  onSave,
  savingMessageId,
}: ChatMediaViewerProps) {
  const insets = useSafeAreaInsets()
  const { height: screenHeight, width: screenWidth } = useWindowDimensions()
  const reduceMotion = useReducedMotion()
  const listRef = useRef<FlatList<ChatMediaGalleryItem>>(null)
  const openedPayloadIdRef = useRef<string | null>(null)
  const backdropOpacity = useSharedValue(1)
  const chromeVisible = useSharedValue(1)
  const dismissTranslateX = useSharedValue(0)
  const dismissTranslateY = useSharedValue(0)
  const transitionProgress = useSharedValue(0)
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [isChromeVisible, setIsChromeVisible] = useState(true)
  const [isTransitionComplete, setIsTransitionComplete] = useState(false)
  const [isZoomed, setIsZoomed] = useState(false)
  const sourceItemIndex = initialPayload
    ? items.findIndex((item) => item.id === initialPayload.messageId)
    : -1
  const initialMessageId = initialPayload?.messageId ?? null
  const isVisible = Boolean(initialPayload && sourceItemIndex >= 0)
  const activeIndex = useMemo(() => {
    if (activeItemId) {
      const nextIndex = items.findIndex((item) => item.id === activeItemId)
      if (nextIndex >= 0) {
        return nextIndex
      }
    }

    return Math.max(sourceItemIndex, 0)
  }, [activeItemId, items, sourceItemIndex])
  const activeItem = items[activeIndex] ?? null
  const isActiveOriginal = activeItem?.id === initialPayload?.messageId

  useEffect(() => {
    if (!isVisible || sourceItemIndex < 0 || !initialMessageId) {
      openedPayloadIdRef.current = null
      return
    }

    if (openedPayloadIdRef.current === initialMessageId) {
      return
    }

    openedPayloadIdRef.current = initialMessageId
    setActiveItemId(initialMessageId)
    setIsChromeVisible(true)
    setIsZoomed(false)
    setIsTransitionComplete(Boolean(reduceMotion))
    backdropOpacity.value = 1
    chromeVisible.value = 1
    dismissTranslateX.value = 0
    dismissTranslateY.value = 0
    transitionProgress.value = reduceMotion ? 1 : 0
    const frameId = requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ animated: false, index: sourceItemIndex })
      if (reduceMotion) {
        return
      }
      transitionProgress.value = withSpring(1, HERO_OPEN_SPRING_CONFIG, (finished) => {
        'worklet'
        if (finished) {
          scheduleOnRN(setIsTransitionComplete, true)
        }
      })
    })

    return () => {
      cancelAnimationFrame(frameId)
    }
  }, [
    backdropOpacity,
    chromeVisible,
    dismissTranslateX,
    dismissTranslateY,
    initialMessageId,
    isVisible,
    reduceMotion,
    sourceItemIndex,
    transitionProgress,
  ])

  useEffect(() => {
    if (!isVisible || activeIndex < 0 || activeIndex >= items.length) {
      return
    }

    const frameId = requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ animated: false, index: activeIndex })
    })

    return () => {
      cancelAnimationFrame(frameId)
    }
  }, [activeIndex, isVisible, items.length])

  useEffect(() => {
    if (activeItem?.type === 'video' && !isChromeVisible) {
      chromeVisible.value = 1
      setIsChromeVisible(true)
    }
  }, [activeItem?.type, chromeVisible, isChromeVisible])

  const sourceItem = sourceItemIndex >= 0 ? items[sourceItemIndex] : null
  const sourceFrame = initialPayload?.sourceFrame
  const targetFrame = useMemo(() => {
    if (!sourceFrame || !sourceItem) {
      return null
    }

    const contentWidth = sourceItem.message.media?.width ?? sourceFrame.width
    const contentHeight = sourceItem.message.media?.height ?? sourceFrame.height
    const top = insets.top + 64
    const bottom = insets.bottom + 76
    return getContainedRect({
      contentHeight,
      contentWidth,
      height: Math.max(1, screenHeight - top - bottom),
      top,
      width: screenWidth,
    })
  }, [insets.bottom, insets.top, screenHeight, screenWidth, sourceFrame, sourceItem])

  const animatedPaddingStyle = useAnimatedStyle(() => {
    const paddingTop = interpolate(chromeVisible.value, [0, 1], [0, insets.top + 64])
    const paddingBottom = interpolate(chromeVisible.value, [0, 1], [0, insets.bottom + 76])

    return {
      paddingTop,
      paddingBottom,
    }
  })
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(transitionProgress.value, [0, 1], [0, 1]) * backdropOpacity.value,
  }))
  const pageContentStyle = useAnimatedStyle(() => ({
    opacity: transitionProgress.value === 1 ? 1 : 0,
  }))
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: chromeVisible.value,
  }))
  const dismissibleContentStyle = useAnimatedStyle(() => {
    const dragDistance = Math.sqrt(
      dismissTranslateX.value * dismissTranslateX.value +
        dismissTranslateY.value * dismissTranslateY.value,
    )
    const scale = interpolate(
      dragDistance,
      [0, screenHeight * 0.65],
      [1, 0.84],
      Extrapolation.CLAMP,
    )

    return {
      transform: [
        { translateX: dismissTranslateX.value },
        { translateY: dismissTranslateY.value },
        { scale },
      ],
    }
  })
  const heroStyle = useAnimatedStyle(() => {
    if (!sourceFrame || !targetFrame) {
      return { opacity: 0 }
    }

    const sourceCenterX = sourceFrame.x + sourceFrame.width / 2
    const sourceCenterY = sourceFrame.y + sourceFrame.height / 2
    const targetCenterX = targetFrame.x + targetFrame.width / 2
    const targetCenterY = targetFrame.y + targetFrame.height / 2

    const dragDistance = Math.sqrt(
      dismissTranslateX.value * dismissTranslateX.value +
        dismissTranslateY.value * dismissTranslateY.value,
    )
    const dismissScale = interpolate(
      dragDistance,
      [0, screenHeight * 0.65],
      [1, 0.84],
      Extrapolation.CLAMP,
    )

    const scaledTargetWidth = targetFrame.width * dismissScale
    const scaledTargetHeight = targetFrame.height * dismissScale
    const currentTargetCenterX = targetCenterX + dismissTranslateX.value
    const currentTargetCenterY = targetCenterY + dismissTranslateY.value

    return {
      borderRadius: interpolate(transitionProgress.value, [0, 1], [12, 0]),
      height: sourceFrame.height,
      left: sourceFrame.x,
      opacity: transitionProgress.value === 1 ? 0 : 1,
      position: 'absolute' as const,
      top: sourceFrame.y,
      transform: [
        { translateX: (currentTargetCenterX - sourceCenterX) * transitionProgress.value },
        { translateY: (currentTargetCenterY - sourceCenterY) * transitionProgress.value },
        {
          scaleX:
            1 + (scaledTargetWidth / Math.max(1, sourceFrame.width) - 1) * transitionProgress.value,
        },
        {
          scaleY:
            1 +
            (scaledTargetHeight / Math.max(1, sourceFrame.height) - 1) * transitionProgress.value,
        },
      ],
      width: sourceFrame.width,
    }
  })

  const close = useCallback(() => {
    if (!initialPayload || reduceMotion || activeItem?.id !== initialPayload.messageId) {
      onRequestClose()
      return
    }

    setIsTransitionComplete(false)
    transitionProgress.value = withSpring(0, HERO_CLOSE_SPRING_CONFIG, (finished) => {
      'worklet'
      if (finished) {
        scheduleOnRN(onRequestClose)
      }
    })
  }, [activeItem?.id, initialPayload, onRequestClose, reduceMotion, transitionProgress])
  const dismissGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!isZoomed && isTransitionComplete)
        .failOffsetX([-8, 8])
        .activeOffsetY([-12, 12])
        .onUpdate((event) => {
          'worklet'
          if (chromeVisible.value !== 1) {
            chromeVisible.value = 1
            scheduleOnRN(setIsChromeVisible, true)
          }

          dismissTranslateX.value = event.translationX * 0.95
          dismissTranslateY.value = event.translationY * 0.95
          backdropOpacity.value = interpolate(
            Math.abs(event.translationY),
            [0, screenHeight / 2],
            [1, 0],
            Extrapolation.CLAMP,
          )
        })
        .onEnd((event) => {
          'worklet'
          const shouldDismissDown =
            event.translationY > DISMISS_DISTANCE_THRESHOLD ||
            event.velocityY > DISMISS_VELOCITY_THRESHOLD
          const shouldDismissUp =
            event.translationY < -DISMISS_DISTANCE_THRESHOLD ||
            event.velocityY < -DISMISS_VELOCITY_THRESHOLD
          const shouldDismiss = shouldDismissDown || shouldDismissUp

          if (shouldDismiss) {
            backdropOpacity.value = withTiming(0, { duration: 150 })

            if (isActiveOriginal) {
              transitionProgress.value = withSpring(0, HERO_CLOSE_SPRING_CONFIG, (finished) => {
                'worklet'
                if (finished) {
                  scheduleOnRN(onRequestClose)
                }
              })
              scheduleOnRN(setIsTransitionComplete, false)
            } else {
              const targetY =
                event.translationY > 0 || event.velocityY > 0
                  ? screenHeight + 200
                  : -screenHeight - 200
              const targetX = event.translationX + event.velocityX * 0.2

              dismissTranslateX.value = withSpring(targetX, {
                ...DISMISS_EXIT_SPRING_CONFIG,
                velocity: event.velocityX,
              })
              dismissTranslateY.value = withSpring(
                targetY,
                {
                  ...DISMISS_EXIT_SPRING_CONFIG,
                  velocity: event.velocityY,
                },
                (finished) => {
                  'worklet'
                  if (finished) {
                    scheduleOnRN(onRequestClose)
                  }
                },
              )
            }
            return
          }

          backdropOpacity.value = withSpring(1)
          dismissTranslateX.value = withSpring(0, {
            damping: 24,
            stiffness: 260,
            mass: 0.9,
            velocity: event.velocityX,
          })
          dismissTranslateY.value = withSpring(0, {
            damping: 24,
            stiffness: 260,
            mass: 0.9,
            velocity: event.velocityY,
          })
        }),
    [
      backdropOpacity,
      chromeVisible,
      dismissTranslateX,
      dismissTranslateY,
      isTransitionComplete,
      isZoomed,
      onRequestClose,
      screenHeight,
      setIsChromeVisible,
      isActiveOriginal,
      transitionProgress,
    ],
  )

  const handleMomentumScrollEnd = useCallback(
    (event: { nativeEvent: { contentOffset: { x: number } } }) => {
      const rawNextIndex = Math.round(event.nativeEvent.contentOffset.x / screenWidth)
      const nextIndex = Math.max(0, Math.min(rawNextIndex, items.length - 1))
      setActiveItemId(items[nextIndex]?.id ?? null)
      setIsZoomed(false)
      if (nextIndex >= items.length - 2) {
        onLoadOlder?.()
      }
    },
    [items, onLoadOlder, screenWidth],
  )
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<ChatMediaGalleryItem>) => (
      <Animated.View style={[{ height: screenHeight, width: screenWidth }, animatedPaddingStyle]}>
        <GalleryPage
          chromeVisible={chromeVisible}
          isActive={index === activeIndex}
          isTransitionComplete={isTransitionComplete}
          isZoomed={isZoomed}
          item={item}
          screenHeight={screenHeight}
          screenWidth={screenWidth}
          setIsChromeVisible={setIsChromeVisible}
          onZoomChange={setIsZoomed}
          shouldAutoplay={Boolean(
            initialPayload?.autoplayVideo && item.id === initialPayload.messageId,
          )}
        />
      </Animated.View>
    ),
    [
      activeIndex,
      chromeVisible,
      initialPayload,
      isTransitionComplete,
      isZoomed,
      screenHeight,
      screenWidth,
      animatedPaddingStyle,
    ],
  )

  if (!isVisible || !initialPayload || !sourceItem) {
    return null
  }

  const heroUri = sourceItem.type === 'video' ? sourceItem.posterUri : sourceItem.uri
  const durationLabel =
    activeItem?.type === 'video' ? formatDurationLabel(activeItem.message.media?.durationMs) : null
  const senderName = getSenderName(activeItem?.message)
  const sentAt = formatShort(activeItem?.message.createdAt)
  const avatarInitials = getAvatarInitials(senderName)

  return (
    <Modal animationType="none" onRequestClose={close} statusBarTranslucent transparent visible>
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[styles.backdrop, backdropStyle]} />
        <GestureDetector gesture={dismissGesture}>
          <Animated.View style={[styles.page, pageContentStyle, dismissibleContentStyle]}>
            <FlatList
              data={items}
              decelerationRate="fast"
              getItemLayout={(_, index) => ({
                index,
                length: screenWidth,
                offset: screenWidth * index,
              })}
              horizontal
              initialScrollIndex={sourceItemIndex}
              keyExtractor={(item) => item.id}
              onMomentumScrollEnd={handleMomentumScrollEnd}
              pagingEnabled
              ref={listRef}
              renderItem={renderItem}
              scrollEnabled={!isZoomed && isTransitionComplete}
              showsHorizontalScrollIndicator={false}
            />
          </Animated.View>
        </GestureDetector>

        <Animated.View
          pointerEvents={isTransitionComplete ? 'auto' : 'none'}
          style={[styles.topBar, { paddingTop: insets.top }, pageContentStyle, chromeStyle]}
        >
          <Pressable
            accessibilityLabel="Close media gallery"
            accessibilityRole="button"
            hitSlop={12}
            onPress={close}
            style={styles.topBarAction}
          >
            <MaterialIcons color="#FFFFFF" name="arrow-back" size={24} />
          </Pressable>

          <View style={styles.topBarCenter}>
            <Text numberOfLines={1} style={styles.topBarTitle}>
              {senderName}
            </Text>
            {items.length > 1 ? (
              <Text style={styles.topBarSubtitle}>
                {activeIndex + 1} of {items.length}
                {sentAt ? ` · ${sentAt}` : ''}
              </Text>
            ) : sentAt ? (
              <Text style={styles.topBarSubtitle}>{sentAt}</Text>
            ) : null}
          </View>

          <View style={styles.topBarActions}>
            <Pressable
              accessibilityLabel="Save media"
              accessibilityRole="button"
              disabled={!activeItem?.canSave || savingMessageId === activeItem?.id || !onSave}
              hitSlop={12}
              onPress={() => {
                if (activeItem) {
                  onSave?.(activeItem)
                }
              }}
              style={!activeItem?.canSave ? styles.disabled : undefined}
            >
              {savingMessageId === activeItem?.id ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <MaterialIcons color="#FFFFFF" name="file-download" size={24} />
              )}
            </Pressable>
            <Pressable
              accessibilityLabel="More options"
              accessibilityRole="button"
              hitSlop={12}
              style={{ marginLeft: 20 }}
            >
              <MaterialIcons color="#FFFFFF" name="more-vert" size={24} />
            </Pressable>
          </View>
        </Animated.View>

        <Animated.View
          pointerEvents="none"
          style={[
            styles.bottomBar,
            { paddingBottom: insets.bottom + 8 },
            pageContentStyle,
            chromeStyle,
          ]}
        >
          <View style={styles.bottomBarLeft}>
            <View style={styles.senderAvatar}>
              <Text style={styles.senderAvatarText}>{avatarInitials}</Text>
            </View>
            <View style={styles.senderMeta}>
              <Text numberOfLines={1} style={styles.senderMetaName}>
                {senderName}
              </Text>
              {conversationTitle ? (
                <Text numberOfLines={1} style={styles.senderMetaContext}>
                  Sent in {conversationTitle}
                </Text>
              ) : null}
            </View>
          </View>

          {durationLabel ? (
            <View style={styles.durationBadge}>
              <Text style={styles.durationBadgeText}>{durationLabel}</Text>
            </View>
          ) : null}

          {isLoadingOlder ? (
            <ActivityIndicator
              color="rgba(255,255,255,0.7)"
              size="small"
              style={{ marginLeft: 8 }}
            />
          ) : null}
        </Animated.View>

        <Animated.View pointerEvents="none" style={[styles.hero, heroStyle]}>
          {heroUri ? (
            <Image contentFit="contain" source={{ uri: heroUri }} style={styles.page} />
          ) : (
            <View style={styles.heroFallback}>
              <MaterialIcons color="#D4D4D8" name="videocam" size={30} />
            </View>
          )}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#050506',
  },
  bottomBar: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.52)',
    bottom: 0,
    flexDirection: 'row',
    left: 0,
    paddingHorizontal: 16,
    paddingTop: 14,
    position: 'absolute',
    right: 0,
  },
  bottomBarLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    minWidth: 0,
  },
  disabled: {
    opacity: 0.36,
  },
  durationBadge: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 999,
    flexShrink: 0,
    marginLeft: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  durationBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '500',
  },
  hero: {
    backgroundColor: '#101012',
    borderRadius: 18,
    overflow: 'hidden',
  },
  heroFallback: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  page: {
    flex: 1,
  },
  root: {
    backgroundColor: 'transparent',
    flex: 1,
  },
  senderAvatar: {
    alignItems: 'center',
    backgroundColor: '#3a6fd8',
    borderRadius: 17,
    flexShrink: 0,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  senderAvatarText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '500',
  },
  senderMeta: {
    flex: 1,
    minWidth: 0,
  },
  senderMetaContext: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    marginTop: 1,
  },
  senderMetaName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
  },
  topBar: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.52)',
    flexDirection: 'row',
    left: 0,
    paddingBottom: 14,
    paddingHorizontal: 18,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  topBarAction: {
    alignItems: 'center',
    flexShrink: 0,
    height: 44,
    justifyContent: 'center',
    width: 32,
  },
  topBarActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
  },
  topBarCenter: {
    flex: 1,
    marginHorizontal: 12,
    minWidth: 0,
  },
  topBarSubtitle: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    marginTop: 1,
  },
  topBarTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
})
