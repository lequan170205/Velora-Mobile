import { MaterialIcons } from '@expo/vector-icons'
import { BlurView } from 'expo-blur'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import React, { useRef, useState } from 'react'
import {
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { useTheme, type MD3Theme } from 'react-native-paper'
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { typography } from '../../../constants/theme'
import { useAddReaction, useRemoveReaction } from '../../../hooks/useMessageActions'
import { useAuthStore } from '../../../stores/authStore'

import {
  ACTION_ROW_H,
  EDGE_MARGIN,
  EXTENDED_EMOJIS,
  GAP,
  MENU_MAX_W,
  MENU_MIN_W,
  PICKER_SPRING,
  QUICK_REACTIONS,
  REACTION_BAR_H,
  SAFE_VERTICAL,
  getMessageContextMenuTokens,
  type MessageContextActionConfig,
  type MessageContextMenuTokens,
} from './constants'
import { getAvailableMessageActions, getCurrentUserReaction, isMessageRecalled } from './helpers'

import type { Message } from '../../../types/conversation.types'

export interface BubbleAnchor {
  x: number
  y: number
  width: number
  height: number
}

interface MessageContextMenuProps {
  visible: boolean
  message: Message | null
  isOwn: boolean
  isGroupedTop: boolean
  isGroupedBottom: boolean
  anchor: BubbleAnchor | null
  onClose: () => void
  onReply?: (() => void) | undefined
  onForward?: (() => void) | undefined
  onRecall?: (() => void) | undefined
  conversationId?: string | undefined
}

interface ActionItem extends MessageContextActionConfig {
  onPress: () => void
}

type MessageContextMenuInnerProps = Omit<MessageContextMenuProps, 'message' | 'anchor'> & {
  message: Message
  anchor: BubbleAnchor
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)
const MENU_ENTER_EASING = Easing.bezier(0.22, 1, 0.36, 1)
const MENU_EXIT_EASING = Easing.bezier(0.4, 0, 1, 1)

export function MessageContextMenu({
  visible,
  message,
  anchor,
  ...props
}: MessageContextMenuProps) {
  const lastMessageRef = useRef<Message | null>(message)
  const lastAnchorRef = useRef<BubbleAnchor | null>(anchor)

  if (!visible || !message || !anchor) {
    return null
  }

  if (message) lastMessageRef.current = message
  if (anchor) lastAnchorRef.current = anchor

  const renderedMessage = lastMessageRef.current
  const renderedAnchor = lastAnchorRef.current

  if (!renderedMessage || !renderedAnchor) return null

  return (
    <MessageContextMenuInner
      visible={visible}
      message={renderedMessage}
      anchor={renderedAnchor}
      {...props}
    />
  )
}

function MessageContextMenuInner({
  visible,
  message,
  isOwn,
  isGroupedTop,
  isGroupedBottom,
  anchor,
  onClose,
  onReply,
  onForward,
  onRecall,
  conversationId,
}: MessageContextMenuInnerProps) {
  const { user } = useAuthStore()
  const addReaction = useAddReaction()
  const removeReaction = useRemoveReaction()
  const { width: screenW, height: screenH } = useWindowDimensions()
  const theme = useTheme<MD3Theme>()
  const [isPickerExpanded, setIsPickerExpanded] = useState(false)
  const tokens = getMessageContextMenuTokens(theme)
  const slideDirection = isOwn ? 1 : -1
  const androidBlurProps =
    Platform.OS === 'android'
      ? { blurReductionFactor: 6, experimentalBlurMethod: 'dimezisBlurView' as const }
      : {}

  const menuProgress = useSharedValue(0)
  const pickerTranslateY = useSharedValue(screenH)

  React.useEffect(() => {
    if (visible) {
      setIsPickerExpanded(false)
      pickerTranslateY.value = screenH
      menuProgress.value = withTiming(1, { duration: 220, easing: MENU_ENTER_EASING })
    } else {
      menuProgress.value = withTiming(0, { duration: 120, easing: MENU_EXIT_EASING })
      pickerTranslateY.value = withTiming(screenH, { duration: 150, easing: MENU_EXIT_EASING })
    }
  }, [menuProgress, pickerTranslateY, screenH, visible])

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(menuProgress.value, [0, 1], [0, 1]),
  }))

  const stackStyle = useAnimatedStyle(() => ({
    opacity: menuProgress.value,
    transform: [
      { translateX: interpolate(menuProgress.value, [0, 1], [slideDirection * 10, 0]) },
      { translateY: interpolate(menuProgress.value, [0, 1], [8, 0]) },
    ],
  }))

  const focusStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(menuProgress.value, [0, 1], [0.96, 1]) }],
  }))

  const reactionBarStyle = useAnimatedStyle(() => ({
    opacity: menuProgress.value,
    transform: [
      { translateX: interpolate(menuProgress.value, [0, 1], [slideDirection * 12, 0]) },
      { scale: interpolate(menuProgress.value, [0, 1], [0.97, 1]) },
    ],
  }))

  const actionBarStyle = useAnimatedStyle(() => ({
    opacity: interpolate(menuProgress.value, [0, 0.12, 1], [0, 0, 1]),
    transform: [
      { translateX: interpolate(menuProgress.value, [0, 1], [slideDirection * 14, 0]) },
      { scale: interpolate(menuProgress.value, [0, 1], [0.97, 1]) },
    ],
  }))

  const close = () => {
    if (isPickerExpanded) {
      pickerTranslateY.value = withTiming(
        screenH,
        { duration: 150, easing: MENU_EXIT_EASING },
        () => {
          scheduleOnRN(onClose)
        },
      )
    } else {
      menuProgress.value = withTiming(0, { duration: 120, easing: MENU_EXIT_EASING }, () => {
        scheduleOnRN(onClose)
      })
    }
  }

  const openFullPicker = () => {
    setIsPickerExpanded(true)
    menuProgress.value = withTiming(0, { duration: 150, easing: MENU_EXIT_EASING })
    pickerTranslateY.value = withSpring(0, PICKER_SPRING)
  }

  const handleCopy = async () => {
    if (message?.content) {
      await Clipboard.setStringAsync(message.content)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    }
    close()
  }

  const handleReply = () => {
    onReply?.()
    close()
  }

  const handleForward = () => {
    onForward?.()
    close()
  }

  const handleRecall = () => {
    onRecall?.()
    close()
  }

  const handleReactionPress = (emoji: string) => {
    if (!message || !user || !conversationId) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid)

    const currentUserEmoji = getCurrentUserReaction(message, user.id)

    if (currentUserEmoji === emoji) {
      removeReaction.mutate({ messageId: message.id, conversationId })
    } else {
      addReaction.mutate({ messageId: message.id, emoji, conversationId })
    }

    close()
  }

  const isRecalled = isMessageRecalled(message)
  const activeEmoji = getCurrentUserReaction(message, user?.id)

  const actionHandlers: Record<ActionItem['id'], () => void> = {
    copy: handleCopy,
    forward: handleForward,
    recall: handleRecall,
    reply: handleReply,
  }

  const filteredActions: ActionItem[] = getAvailableMessageActions({
    isOwn,
    message,
    onForward,
    onRecall,
    onReply,
  }).map((action) => ({
    ...action,
    onPress: actionHandlers[action.id],
  }))

  const menuWidth = clamp(
    Math.max(anchor.width, MENU_MIN_W),
    MENU_MIN_W,
    Math.min(MENU_MAX_W, screenW - EDGE_MARGIN * 2),
  )

  const reactionVisible = !isRecalled
  const reactionHeight = reactionVisible ? REACTION_BAR_H : 0

  const actionCount = filteredActions.length
  const actionHeight =
    actionCount > 0 ? actionCount * ACTION_ROW_H + (actionCount - 1) * StyleSheet.hairlineWidth : 0

  const activeGaps = (reactionVisible ? 1 : 0) + (actionCount > 0 ? 1 : 0)
  const totalGapHeight = activeGaps * GAP

  const maxBubbleH = screenH * 0.45
  const bubbleHeight = Math.min(anchor.height, maxBubbleH)

  const totalHeight = reactionHeight + actionHeight + bubbleHeight + totalGapHeight

  const stackLeft = clamp(
    isOwn ? anchor.x + anchor.width - menuWidth : anchor.x,
    EDGE_MARGIN,
    screenW - menuWidth - EDGE_MARGIN,
  )

  const desiredTop = anchor.y - reactionHeight - (reactionVisible ? GAP : 0)

  const maxAllowedTop = screenH - totalHeight - SAFE_VERTICAL

  const stackTop = clamp(desiredTop, SAFE_VERTICAL, maxAllowedTop)

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      statusBarTranslucent
      onRequestClose={close}
    >
      <Animated.View style={[StyleSheet.absoluteFillObject, backdropStyle]}>
        <BlurView
          intensity={22}
          tint={theme.dark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFillObject}
        />
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: tokens.backdrop }]}
          onPress={close}
        />
      </Animated.View>

      <Animated.View
        pointerEvents={isPickerExpanded ? 'none' : 'auto'}
        style={[styles.stack, stackStyle, { top: stackTop, left: stackLeft, width: menuWidth }]}
      >
        {reactionVisible ? (
          <Animated.View
            style={[
              styles.surface,
              styles.reactionBar,
              reactionBarStyle,
              {
                height: REACTION_BAR_H,
                backgroundColor: tokens.surface,
                borderColor: tokens.border,
                ...shadowStyle(tokens.shadow),
              },
            ]}
          >
            <View style={styles.reactionRow}>
              {QUICK_REACTIONS.map((emoji) => (
                <ReactionButton
                  key={emoji}
                  emoji={emoji}
                  isActive={activeEmoji === emoji}
                  tokens={tokens}
                  onPress={() => handleReactionPress(emoji)}
                />
              ))}

              <AnimatedPressable
                accessibilityRole="button"
                hitSlop={4}
                style={[
                  styles.reactionButton,
                  { backgroundColor: 'transparent', borderColor: 'transparent' },
                ]}
                onPress={openFullPicker}
              >
                <MaterialIcons name="add" size={24} color={tokens.textSecondary} />
              </AnimatedPressable>
            </View>
          </Animated.View>
        ) : null}

        <Animated.View style={[focusStyle, getBubblePreviewFrameStyle({ anchor, message, isOwn })]}>
          <View
            style={[
              styles.focusBubble,
              getBubbleSurfaceStyle({ message, isOwn, isGroupedTop, isGroupedBottom, tokens }),
              shadowStyle(tokens.shadow),
            ]}
          >
            {renderBubblePreview({ message, isOwn, tokens })}
          </View>
        </Animated.View>

        {filteredActions.length > 0 ? (
          <Animated.View
            style={[
              styles.surface,
              styles.actionSheet,
              actionBarStyle,
              {
                backgroundColor: tokens.surface,
                borderColor: tokens.border,
                ...shadowStyle(tokens.shadow),
              },
            ]}
          >
            {filteredActions.map((action, index) => (
              <React.Fragment key={action.id}>
                <Pressable
                  onPress={action.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  hitSlop={4}
                  style={({ pressed }) => ({
                    backgroundColor: pressed ? tokens.surfacePressed : 'transparent',
                  })}
                >
                  <View style={styles.actionRow}>
                    <View
                      style={[
                        styles.actionIconWrap,
                        {
                          backgroundColor: action.destructive ? tokens.dangerSoft : tokens.metaChip,
                        },
                      ]}
                    >
                      <MaterialIcons
                        name={action.icon}
                        size={18}
                        color={action.destructive ? tokens.danger : tokens.textPrimary}
                      />
                    </View>
                    <Text
                      style={[
                        styles.actionLabel,
                        { color: action.destructive ? tokens.danger : tokens.textPrimary },
                      ]}
                    >
                      {action.label}
                    </Text>
                  </View>
                </Pressable>

                {index < filteredActions.length - 1 ? (
                  <View style={[styles.divider, { backgroundColor: tokens.divider }]} />
                ) : null}
              </React.Fragment>
            ))}
          </Animated.View>
        ) : null}
      </Animated.View>

      <Animated.View
        style={[
          styles.emojiSheet,
          {
            backgroundColor: tokens.surface,
            transform: [{ translateY: pickerTranslateY }],
            ...shadowStyle(tokens.shadow),
          },
        ]}
      >
        <View style={[styles.dragIndicator, { backgroundColor: tokens.divider }]} />
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.extendedEmojiGrid}
        >
          {EXTENDED_EMOJIS.map((emoji) => (
            <ReactionButton
              key={emoji}
              emoji={emoji}
              isActive={activeEmoji === emoji}
              tokens={tokens}
              onPress={() => handleReactionPress(emoji)}
            />
          ))}
        </ScrollView>
      </Animated.View>
    </Modal>
  )
}

function ReactionButton({
  emoji,
  isActive,
  tokens,
  onPress,
}: {
  emoji: string
  isActive: boolean
  tokens: MessageContextMenuTokens
  onPress: () => void
}) {
  const scale = useSharedValue(1)

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  const handlePress = () => {
    scale.value = withSpring(0.9, { damping: 10, stiffness: 320 }, () => {
      scale.value = withSpring(1, { damping: 12, stiffness: 250 })
    })
    onPress()
  }

  return (
    <AnimatedPressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Thả cảm xúc ${emoji}`}
      hitSlop={4}
      style={[styles.reactionButton, animatedStyle]}
    >
      <Text style={styles.reactionEmoji}>{emoji}</Text>
      {isActive ? (
        <View style={[styles.reactionActiveDot, { backgroundColor: tokens.textSecondary }]} />
      ) : null}
    </AnimatedPressable>
  )
}

function renderBubblePreview({
  message,
  isOwn,
  tokens,
}: {
  message: Message
  isOwn: boolean
  tokens: MessageContextMenuTokens
}) {
  const isRecalled = isMessageRecalled(message)

  if (isRecalled) {
    return (
      <Text
        style={[
          styles.textPreview,
          styles.recalledText,
          { color: isOwn ? 'rgba(255,255,255,0.72)' : tokens.textSecondary },
        ]}
      >
        Tin nhắn đã thu hồi
      </Text>
    )
  }

  if (message.type === 'image') {
    return (
      <Image source={{ uri: message.content }} style={styles.imagePreview} resizeMode="cover" />
    )
  }

  return (
    <Text style={[styles.textPreview, { color: isOwn ? tokens.textInverse : tokens.textPrimary }]}>
      {message.content}
    </Text>
  )
}

function getBubbleSurfaceStyle({
  message,
  isOwn,
  isGroupedTop,
  isGroupedBottom,
  tokens,
}: {
  message: Message
  isOwn: boolean
  isGroupedTop: boolean
  isGroupedBottom: boolean
  tokens: MessageContextMenuTokens
}) {
  const groupedCornerStyle = getGroupedCornerStyle({ isOwn, isGroupedTop, isGroupedBottom })

  if (message.type === 'image') {
    return {
      backgroundColor: 'transparent',
      padding: 0,
      borderWidth: 0,
      ...groupedCornerStyle,
    }
  }

  const commonStyle = {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 0,
    ...groupedCornerStyle,
  }

  if (isOwn) {
    return {
      ...commonStyle,
      backgroundColor: tokens.accent,
    }
  }

  return {
    ...commonStyle,
    backgroundColor: tokens.incomingBubble,
  }
}

function getBubblePreviewFrameStyle({
  anchor,
  message,
  isOwn,
}: {
  anchor: BubbleAnchor
  message: Message
  isOwn: boolean
}) {
  const height = Math.ceil(anchor.height)
  const width = Math.ceil(anchor.width)

  const alignment = {
    alignSelf: isOwn ? 'flex-end' : 'flex-start',
  } as const

  if (message.type === 'image') {
    return {
      ...alignment,
      height,
      width,
    }
  }

  return {
    ...alignment,
    height,
    minWidth: width,
  }
}

function getGroupedCornerStyle({
  isOwn,
  isGroupedTop,
  isGroupedBottom,
}: {
  isOwn: boolean
  isGroupedTop: boolean
  isGroupedBottom: boolean
}) {
  return {
    borderTopRightRadius: isOwn && isGroupedTop ? 4 : 16,
    borderBottomRightRadius: isOwn && isGroupedBottom ? 4 : 16,
    borderTopLeftRadius: !isOwn && isGroupedTop ? 4 : 16,
    borderBottomLeftRadius: !isOwn && isGroupedBottom ? 4 : 16,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

function shadowStyle(color: string) {
  return Platform.select({
    ios: {
      shadowColor: color,
      shadowOffset: { width: 0, height: 14 },
      shadowOpacity: 0.18,
      shadowRadius: 24,
    },
    android: {
      elevation: 14,
    },
  })
}

const styles = StyleSheet.create({
  actionIconWrap: {
    alignItems: 'center',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  actionLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: ACTION_ROW_H,
    paddingHorizontal: 16,
  },
  actionSheet: {
    overflow: 'hidden',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 60,
  },
  dragIndicator: {
    alignSelf: 'center',
    borderRadius: 2.5,
    height: 5,
    marginBottom: 16,
    width: 36,
  },
  emojiSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    bottom: 0,
    height: '50%',
    left: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    position: 'absolute',
    right: 0,
  },
  extendedEmojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
    paddingBottom: SAFE_VERTICAL,
  },
  focusBubble: {
    borderRadius: 16,
    flex: 1,
    overflow: 'hidden',
  },
  imagePreview: {
    borderRadius: 16,
    height: '100%',
    width: '100%',
  },
  reactionActiveDot: {
    borderRadius: 3,
    height: 4,
    width: 4,
  },
  reactionBar: {
    justifyContent: 'center',
  },
  reactionButton: {
    alignItems: 'center',
    borderRadius: 16,
    gap: 1,
    justifyContent: 'center',
    minHeight: 45,
    width: 45,
  },
  reactionEmoji: {
    fontSize: 28,
    lineHeight: 40,
  },
  reactionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    minHeight: REACTION_BAR_H,
    paddingHorizontal: 4,
  },
  recalledText: {
    fontStyle: 'italic',
  },
  stack: {
    gap: GAP,
    position: 'absolute',
  },
  surface: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  textPreview: {
    flexShrink: 1,
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.md,
    lineHeight: 22,
  },
})
