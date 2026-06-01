import { MaterialIcons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, {
  Easing,
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
  initialPayload: ChatMediaViewerOpenPayload | null
  isLoadingOlder?: boolean
  items: ChatMediaGalleryItem[]
  onLoadOlder?: () => void
  onRequestClose: () => void
  onSave?: (item: ChatMediaGalleryItem) => void
  savingMessageId?: string | null
}

const TRANSITION_DURATION_MS = 260
const SPRING_CONFIG = { damping: 24, stiffness: 260, mass: 0.72 } as const

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
  isActive,
  onZoomChange,
}: {
  item: ChatMediaGalleryItem
  isActive: boolean
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
        .enabled(isActive)
        .onUpdate((event) => {
          'worklet'
          if (scale.value <= 1.02) {
            return
          }
          translateX.value = savedTranslateX.value + event.translationX
          translateY.value = savedTranslateY.value + event.translationY
        })
        .onEnd(() => {
          'worklet'
          if (scale.value <= 1.02) {
            translateX.value = withSpring(0, SPRING_CONFIG)
            translateY.value = withSpring(0, SPRING_CONFIG)
            savedTranslateX.value = 0
            savedTranslateY.value = 0
            return
          }
          savedTranslateX.value = translateX.value
          savedTranslateY.value = translateY.value
        }),
    [isActive, savedTranslateX, savedTranslateY, scale, translateX, translateY],
  )
  const doubleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .enabled(isActive)
        .numberOfTaps(2)
        .maxDuration(260)
        .onEnd(() => {
          'worklet'
          const isZoomingIn = scale.value <= 1.02
          const nextScale = isZoomingIn ? 2.3 : 1
          scale.value = withSpring(nextScale, SPRING_CONFIG)
          savedScale.value = nextScale
          if (!isZoomingIn) {
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
      translateX,
      translateY,
    ],
  )
  const composedGesture = useMemo(
    () => Gesture.Simultaneous(pinchGesture, panGesture, doubleTapGesture),
    [doubleTapGesture, panGesture, pinchGesture],
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
  isActive,
  isTransitionComplete,
  shouldAutoplay,
  onZoomChange,
}: {
  item: ChatMediaGalleryItem
  isActive: boolean
  isTransitionComplete: boolean
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

  return <ZoomableImage isActive={isActive} item={item} onZoomChange={onZoomChange} />
})

export function ChatMediaViewer({
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
  const transitionProgress = useSharedValue(0)
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
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
    setIsZoomed(false)
    setIsTransitionComplete(Boolean(reduceMotion))
    transitionProgress.value = reduceMotion ? 1 : 0
    const frameId = requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ animated: false, index: sourceItemIndex })
      if (reduceMotion) {
        return
      }
      transitionProgress.value = withTiming(
        1,
        { duration: TRANSITION_DURATION_MS, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (finished) {
            scheduleOnRN(setIsTransitionComplete, true)
          }
        },
      )
    })

    return () => {
      cancelAnimationFrame(frameId)
    }
  }, [initialMessageId, isVisible, reduceMotion, sourceItemIndex, transitionProgress])

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

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(transitionProgress.value, [0, 1], [0, 1]),
  }))
  const pageContentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(transitionProgress.value, [0.92, 1], [0, 1]),
  }))
  const heroStyle = useAnimatedStyle(() => {
    if (!sourceFrame || !targetFrame) {
      return { opacity: 0 }
    }

    const sourceCenterX = sourceFrame.x + sourceFrame.width / 2
    const sourceCenterY = sourceFrame.y + sourceFrame.height / 2
    const targetCenterX = targetFrame.x + targetFrame.width / 2
    const targetCenterY = targetFrame.y + targetFrame.height / 2

    return {
      height: sourceFrame.height,
      left: sourceFrame.x,
      opacity: interpolate(transitionProgress.value, [0, 0.98, 1], [1, 1, 0]),
      position: 'absolute' as const,
      top: sourceFrame.y,
      transform: [
        { translateX: (targetCenterX - sourceCenterX) * transitionProgress.value },
        { translateY: (targetCenterY - sourceCenterY) * transitionProgress.value },
        {
          scaleX:
            1 + (targetFrame.width / Math.max(1, sourceFrame.width) - 1) * transitionProgress.value,
        },
        {
          scaleY:
            1 +
            (targetFrame.height / Math.max(1, sourceFrame.height) - 1) * transitionProgress.value,
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
    transitionProgress.value = withTiming(
      0,
      { duration: 210, easing: Easing.inOut(Easing.cubic) },
      (finished) => {
        if (finished) {
          scheduleOnRN(onRequestClose)
        }
      },
    )
  }, [activeItem?.id, initialPayload, onRequestClose, reduceMotion, transitionProgress])

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
      <View style={{ height: screenHeight, width: screenWidth }}>
        <GalleryPage
          isActive={index === activeIndex}
          isTransitionComplete={isTransitionComplete}
          item={item}
          onZoomChange={setIsZoomed}
          shouldAutoplay={Boolean(
            initialPayload?.autoplayVideo && item.id === initialPayload.messageId,
          )}
        />
      </View>
    ),
    [activeIndex, initialPayload, isTransitionComplete, screenHeight, screenWidth],
  )

  if (!isVisible || !initialPayload || !sourceItem) {
    return null
  }

  const heroUri = sourceItem.type === 'video' ? sourceItem.posterUri : sourceItem.uri
  const durationLabel =
    activeItem?.type === 'video' ? formatDurationLabel(activeItem.message.media?.durationMs) : null

  return (
    <Modal animationType="none" onRequestClose={close} statusBarTranslucent transparent visible>
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[styles.backdrop, backdropStyle]} />
        <Animated.View style={[styles.page, pageContentStyle]}>
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

        <Animated.View
          pointerEvents={isTransitionComplete ? 'auto' : 'none'}
          style={[styles.toolbar, { paddingTop: insets.top + 10 }, pageContentStyle]}
        >
          <Pressable
            accessibilityLabel="Close media gallery"
            accessibilityRole="button"
            hitSlop={8}
            onPress={close}
            style={styles.toolbarButton}
          >
            <MaterialIcons color="#FFFFFF" name="close" size={23} />
          </Pressable>
          <Text style={styles.counter}>
            {activeIndex + 1} / {items.length}
          </Text>
          <Pressable
            accessibilityLabel="Save media"
            accessibilityRole="button"
            disabled={!activeItem?.canSave || savingMessageId === activeItem.id || !onSave}
            hitSlop={8}
            onPress={() => {
              if (activeItem) {
                onSave?.(activeItem)
              }
            }}
            style={[styles.toolbarButton, !activeItem?.canSave ? styles.disabled : null]}
          >
            {savingMessageId === activeItem?.id ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <MaterialIcons color="#FFFFFF" name="file-download" size={23} />
            )}
          </Pressable>
        </Animated.View>

        {durationLabel ? (
          <Animated.View style={[styles.durationPill, pageContentStyle]}>
            <Text style={styles.durationText}>{durationLabel}</Text>
          </Animated.View>
        ) : null}
        {isLoadingOlder ? (
          <Animated.View style={[styles.loadingPill, pageContentStyle]}>
            <ActivityIndicator color="#FFFFFF" size="small" />
          </Animated.View>
        ) : null}
        <Animated.View pointerEvents="none" style={[styles.hero, heroStyle]}>
          {heroUri ? (
            <Image contentFit="cover" source={{ uri: heroUri }} style={styles.page} />
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
  counter: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.36,
  },
  durationPill: {
    backgroundColor: 'rgba(12,12,13,0.68)',
    borderRadius: 999,
    bottom: 40,
    paddingHorizontal: 10,
    paddingVertical: 6,
    position: 'absolute',
    right: 18,
  },
  durationText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
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
  loadingPill: {
    alignItems: 'center',
    backgroundColor: 'rgba(20,20,21,0.62)',
    borderRadius: 20,
    bottom: 40,
    height: 40,
    justifyContent: 'center',
    left: 18,
    position: 'absolute',
    width: 40,
  },
  page: {
    flex: 1,
  },
  root: {
    backgroundColor: 'transparent',
    flex: 1,
  },
  toolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 16,
    position: 'absolute',
    right: 16,
    top: 0,
  },
  toolbarButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(20,20,21,0.62)',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
})
