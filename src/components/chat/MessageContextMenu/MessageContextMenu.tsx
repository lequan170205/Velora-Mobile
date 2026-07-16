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
  interpolateColor,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'
import { scheduleOnRN } from 'react-native-worklets'

import { useAddReaction, useRemoveReaction } from '../../../hooks/useMessageActions'
import { useAuthStore } from '../../../stores/authStore'
import { MessageBubbleContent } from '../MessageBubbleContent'

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

/**
 * Measured once by the source message card. Keeping these dimensions lets the
 * menu reproduce a composed message (reply preview + bubble + reactions)
 * without stretching its main bubble to fill the whole card.
 */
export interface MessageContextPreviewLayout {
  bubbleHeight: number
  reactionHeight: number
  replyCardHeight: number
  replyCardWidth: number
  replyMediaHeight: number
  replyMediaWidth: number
  replyPreviewHeight: number
}

/**
 * Shared by the source bubble and its menu. Pointer tracking, hit testing,
 * and hover animation all stay on the UI thread; JS only runs after release.
 */
export interface MessageContextMenuGestureState {
  hasDragged: SharedValue<boolean>
  pointerX: SharedValue<number>
  pointerY: SharedValue<number>
  releaseToken: SharedValue<number>
  selection: SharedValue<number>
}

interface MessageContextMenuProps {
  visible: boolean
  message: Message | null
  replyTarget?: Message | null | undefined
  previewLayout?: MessageContextPreviewLayout | undefined
  isOwn: boolean
  isGroupedTop: boolean
  isGroupedBottom: boolean
  anchor: BubbleAnchor | null
  onClose: () => void
  onReply?: (() => void) | undefined
  onForward?: (() => void) | undefined
  onRecall?: (() => void) | undefined
  onSave?: (() => void) | undefined
  conversationId?: string | undefined
  gestureState?: MessageContextMenuGestureState | undefined
}

interface ActionItem extends MessageContextActionConfig {
  onPress: () => void
}

type MessageContextMenuInnerProps = Omit<MessageContextMenuProps, 'message' | 'anchor'> & {
  message: Message
  anchor: BubbleAnchor
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)
const MENU_EXIT_EASING = Easing.bezier(0.4, 0, 1, 1)
const MENU_SPRING = { damping: 16, stiffness: 220, mass: 0.8 }
const TOOLBAR_ENTER_DELAY_MS = 60
const REACTION_BUTTON_SIZE = 45
const REACTION_PICKUP_RADIUS_X = 34
const REACTION_PICKUP_RADIUS_Y = 32
const ACTION_PICKUP_HORIZONTAL_INSET = 10
const ACTION_PICKUP_VERTICAL_PADDING = 8
const GESTURE_SELECTION_NONE = 0
const REACTION_TO_MEDIA_REPLY_GAP = 4

function getGestureSelection({
  actionCount,
  actionTop,
  menuWidth,
  pointerX,
  pointerY,
  reactionVisible,
  stackLeft,
  stackTop,
}: {
  actionCount: number
  actionTop: number
  menuWidth: number
  pointerX: number
  pointerY: number
  reactionVisible: boolean
  stackLeft: number
  stackTop: number
}): number {
  'worklet'

  if (
    reactionVisible &&
    Math.abs(pointerY - (stackTop + REACTION_BAR_H / 2)) <= REACTION_PICKUP_RADIUS_Y
  ) {
    const rowHorizontalPadding = 8
    const availableSpace = Math.max(
      0,
      menuWidth - rowHorizontalPadding - REACTION_BUTTON_SIZE * (QUICK_REACTIONS.length + 1),
    )
    const slotGap = availableSpace / (QUICK_REACTIONS.length + 2)
    let closestIndex = -1
    let closestDistance = Number.POSITIVE_INFINITY

    for (let index = 0; index < QUICK_REACTIONS.length; index += 1) {
      const centerX =
        stackLeft +
        rowHorizontalPadding / 2 +
        slotGap * (index + 1) +
        REACTION_BUTTON_SIZE * index +
        REACTION_BUTTON_SIZE / 2
      const distance = Math.abs(pointerX - centerX)

      if (distance < closestDistance) {
        closestDistance = distance
        closestIndex = index
      }
    }

    if (closestIndex >= 0 && closestDistance <= REACTION_PICKUP_RADIUS_X) {
      return closestIndex + 1
    }
  }

  const actionBottom = actionTop + actionCount * ACTION_ROW_H
  const isInsideActions =
    pointerX >= stackLeft - ACTION_PICKUP_HORIZONTAL_INSET &&
    pointerX <= stackLeft + menuWidth + ACTION_PICKUP_HORIZONTAL_INSET &&
    pointerY >= actionTop - ACTION_PICKUP_VERTICAL_PADDING &&
    pointerY <= actionBottom + ACTION_PICKUP_VERTICAL_PADDING

  if (isInsideActions && actionCount > 0) {
    const index = Math.max(
      0,
      Math.min(Math.floor((pointerY - actionTop) / ACTION_ROW_H), actionCount - 1),
    )
    return QUICK_REACTIONS.length + index + 1
  }

  return GESTURE_SELECTION_NONE
}

const isReelMessage = (message: Message) =>
  message.type === 'reel' ||
  message.media?.mimeType === 'application/vnd.velora.reel' ||
  Boolean(message.media?.reelId)

const getReelCreatorLabel = (message: Message) => {
  const username = message.media?.reelOwnerUsername?.trim().replace(/^@+/, '')

  if (username) {
    return `@${username}`
  }

  return message.media?.reelTitle?.trim() || 'Reel'
}

function RoundedPlayIcon({ size = 42 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 56 56">
      <Path
        d="M19 14 L19 42 L42 28 Z"
        fill="#FFFFFF"
        stroke="#FFFFFF"
        strokeLinejoin="round"
        strokeWidth={5}
      />
    </Svg>
  )
}

export function MessageContextMenu({
  visible,
  message,
  replyTarget,
  previewLayout,
  anchor,
  ...props
}: MessageContextMenuProps) {
  const lastMessageRef = useRef<Message | null>(message)
  const lastAnchorRef = useRef<BubbleAnchor | null>(anchor)
  const lastReplyTargetRef = useRef<Message | null | undefined>(replyTarget)
  const lastPreviewLayoutRef = useRef<MessageContextPreviewLayout | undefined>(previewLayout)

  if (message) {
    lastMessageRef.current = message
    lastReplyTargetRef.current = replyTarget
    lastPreviewLayoutRef.current = previewLayout
  }
  if (anchor) lastAnchorRef.current = anchor

  const renderedMessage = lastMessageRef.current
  const renderedAnchor = lastAnchorRef.current

  if (!renderedMessage || !renderedAnchor) return null

  return (
    <MessageContextMenuInner
      visible={visible}
      message={renderedMessage}
      replyTarget={lastReplyTargetRef.current}
      previewLayout={lastPreviewLayoutRef.current}
      anchor={renderedAnchor}
      {...props}
    />
  )
}

function MessageContextMenuInner({
  visible,
  message,
  replyTarget,
  previewLayout,
  isOwn,
  isGroupedTop,
  isGroupedBottom,
  anchor,
  onClose,
  onReply,
  onForward,
  onRecall,
  onSave,
  conversationId,
  gestureState,
}: MessageContextMenuInnerProps) {
  const { user } = useAuthStore()
  const addReaction = useAddReaction()
  const removeReaction = useRemoveReaction()
  const { width: screenW, height: screenH } = useWindowDimensions()
  const theme = useTheme<MD3Theme>()
  const [isPickerExpanded, setIsPickerExpanded] = useState(false)
  const tokens = getMessageContextMenuTokens(theme)
  const slideDirection = isOwn ? 1 : -1

  const menuProgress = useSharedValue(0)
  const toolbarProgress = useSharedValue(0)
  const pickerTranslateY = useSharedValue(screenH)

  React.useEffect(() => {
    if (visible) {
      setIsPickerExpanded(false)
      pickerTranslateY.value = screenH
      menuProgress.value = withSpring(1, MENU_SPRING)
      toolbarProgress.value = 0
      toolbarProgress.value = withDelay(TOOLBAR_ENTER_DELAY_MS, withSpring(1, MENU_SPRING))
    } else {
      menuProgress.value = withTiming(0, { duration: 120, easing: MENU_EXIT_EASING })
      toolbarProgress.value = withTiming(0, { duration: 120, easing: MENU_EXIT_EASING })
      pickerTranslateY.value = withTiming(screenH, { duration: 150, easing: MENU_EXIT_EASING })
    }
  }, [menuProgress, pickerTranslateY, screenH, toolbarProgress, visible])

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(menuProgress.value, [0, 1], [0, 1]),
  }))

  // focusStyle không còn dùng — bubble gốc tự scale via pressScale trong MessageBubble
  // Giữ lại tên biến để không break JSX, nhưng no-op
  const focusStyle = useAnimatedStyle(() => ({ transform: [] }))

  const reactionBarStyle = useAnimatedStyle(() => ({
    opacity: toolbarProgress.value,
    transform: [
      { translateX: interpolate(toolbarProgress.value, [0, 1], [slideDirection * 12, 0]) },
      { scale: interpolate(toolbarProgress.value, [0, 1], [0.85, 1]) },
    ],
  }))

  const actionBarStyle = useAnimatedStyle(() => ({
    opacity: interpolate(toolbarProgress.value, [0, 0.12, 1], [0, 0, 1]),
    transform: [
      { translateX: interpolate(toolbarProgress.value, [0, 1], [slideDirection * 14, 0]) },
      { scale: interpolate(toolbarProgress.value, [0, 1], [0.85, 1]) },
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
      toolbarProgress.value = withTiming(0, { duration: 120, easing: MENU_EXIT_EASING })
      menuProgress.value = withTiming(0, { duration: 120, easing: MENU_EXIT_EASING }, () => {
        scheduleOnRN(onClose)
      })
    }
  }

  const openFullPicker = () => {
    setIsPickerExpanded(true)
    toolbarProgress.value = withTiming(0, { duration: 150, easing: MENU_EXIT_EASING })
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

  const handleSave = () => {
    onSave?.()
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
    save: handleSave,
  }

  const filteredActions: ActionItem[] = getAvailableMessageActions({
    isOwn,
    message,
    onForward,
    onRecall,
    onReply,
    onSave,
  }).map((action) => ({
    ...action,
    onPress: actionHandlers[action.id],
  }))

  const maxMenuWidth = Math.min(MENU_MAX_W, screenW - EDGE_MARGIN * 2)
  const menuWidth = clamp(anchor.width, MENU_MIN_W, maxMenuWidth)

  const reactionVisible = !isRecalled
  const reactionHeight = reactionVisible ? REACTION_BAR_H : 0

  const actionCount = filteredActions.length
  const actionHeight =
    actionCount > 0 ? actionCount * ACTION_ROW_H + (actionCount - 1) * StyleSheet.hairlineWidth : 0

  const maxBubbleH = screenH * 0.45
  const replyPreviewType =
    typeof message.replyPreview === 'string' ? replyTarget?.type : message.replyPreview?.type
  const hasMediaReplyPreview = replyPreviewType === 'image' || replyPreviewType === 'video'
  const reactionToPreviewGap = hasMediaReplyPreview ? REACTION_TO_MEDIA_REPLY_GAP : GAP
  // Media reply previews are already rendered at their shared 70% size in the
  // chat bubble. Preserve the measured frame here to keep the transition exact.
  const bubbleHeight = hasMediaReplyPreview ? anchor.height : Math.min(anchor.height, maxBubbleH)
  const reactionGapHeight = reactionVisible ? reactionToPreviewGap : 0
  const actionGapHeight = actionCount > 0 ? GAP : 0

  const totalHeight =
    reactionHeight + actionHeight + bubbleHeight + reactionGapHeight + actionGapHeight
  const idealStackLeft = isOwn ? anchor.x + anchor.width - menuWidth : anchor.x

  const stackLeft = clamp(idealStackLeft, EDGE_MARGIN, screenW - menuWidth - EDGE_MARGIN)

  const idealStackTop = anchor.y - reactionHeight - reactionGapHeight

  const maxAllowedTop = screenH - totalHeight - SAFE_VERTICAL

  const stackTop = clamp(idealStackTop, SAFE_VERTICAL, maxAllowedTop)
  const stackDeltaX = idealStackLeft - stackLeft
  const stackDeltaY = idealStackTop - stackTop
  const actionTop = stackTop + reactionHeight + reactionGapHeight + bubbleHeight + actionGapHeight

  const triggerSelectionHaptic = React.useCallback(() => {
    void Haptics.selectionAsync()
  }, [])

  const handleGestureRelease = (selection: number) => {
    if (selection <= GESTURE_SELECTION_NONE) return

    if (selection <= QUICK_REACTIONS.length) {
      handleReactionPress(QUICK_REACTIONS[selection - 1])
      return
    }

    const actionIndex = selection - QUICK_REACTIONS.length - 1
    filteredActions[actionIndex]?.onPress()
  }

  React.useEffect(() => {
    if (!visible && gestureState) {
      gestureState.hasDragged.value = false
      gestureState.selection.value = GESTURE_SELECTION_NONE
    }
  }, [gestureState, visible])

  useAnimatedReaction(
    () => {
      'worklet'

      if (!visible || !gestureState || !gestureState.hasDragged.value) {
        return GESTURE_SELECTION_NONE
      }

      return getGestureSelection({
        actionCount,
        actionTop,
        menuWidth,
        pointerX: gestureState.pointerX.value,
        pointerY: gestureState.pointerY.value,
        reactionVisible,
        stackLeft,
        stackTop,
      })
    },
    (selection, previousSelection) => {
      'worklet'

      if (!gestureState || selection === previousSelection) return

      gestureState.selection.value = selection

      if (selection !== GESTURE_SELECTION_NONE) {
        scheduleOnRN(triggerSelectionHaptic)
      }
    },
  )

  useAnimatedReaction(
    () => {
      'worklet'

      if (
        !visible ||
        !gestureState ||
        !gestureState.hasDragged.value ||
        gestureState.releaseToken.value === 0
      ) {
        return null
      }

      return {
        selection: getGestureSelection({
          actionCount,
          actionTop,
          menuWidth,
          pointerX: gestureState.pointerX.value,
          pointerY: gestureState.pointerY.value,
          reactionVisible,
          stackLeft,
          stackTop,
        }),
        token: gestureState.releaseToken.value,
      }
    },
    (release, previousRelease) => {
      'worklet'

      if (!release || release.token === previousRelease?.token) return

      if (gestureState) {
        gestureState.selection.value = release.selection
      }

      if (release.selection !== GESTURE_SELECTION_NONE) {
        scheduleOnRN(handleGestureRelease, release.selection)
      }
    },
  )

  const stackStyle = useAnimatedStyle(() => ({
    opacity: menuProgress.value,
    transform: [
      { translateX: interpolate(menuProgress.value, [0, 1], [stackDeltaX, 0]) },
      { translateY: interpolate(menuProgress.value, [0, 1], [stackDeltaY, 0]) },
    ],
  }))

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
          intensity={32}
          tint={theme.dark ? 'dark' : 'light'}
          experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : 'none'}
          blurReductionFactor={3}
          pointerEvents="none"
          style={StyleSheet.absoluteFillObject}
        />
        <View
          style={[
            StyleSheet.absoluteFillObject,
            {
              backgroundColor: theme.dark ? 'rgba(12, 12, 12, 0.28)' : 'rgba(255, 255, 255, 0.32)',
            },
          ]}
        />
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: tokens.backdrop }]}
          onPress={close}
        />
      </Animated.View>

      <Animated.View
        pointerEvents={isPickerExpanded ? 'none' : 'box-none'}
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
                marginBottom: reactionToPreviewGap,
                backgroundColor: tokens.surface,
                borderColor: tokens.border,
                ...shadowStyle(tokens.shadow),
              },
            ]}
          >
            <View style={styles.reactionRow}>
              {QUICK_REACTIONS.map((emoji, index) => (
                <ReactionButton
                  key={emoji}
                  emoji={emoji}
                  isActive={activeEmoji === emoji}
                  tokens={tokens}
                  onPress={() => handleReactionPress(emoji)}
                  gestureState={gestureState}
                  gestureSelection={index + 1}
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

        <Animated.View
          pointerEvents="box-none"
          style={[focusStyle, getBubblePreviewFrameStyle({ anchor, bubbleHeight, message, isOwn })]}
        >
          <ContextMessagePreview
            message={message}
            replyTarget={replyTarget}
            previewLayout={previewLayout}
            previewHeight={bubbleHeight}
            isOwn={isOwn}
            isGroupedTop={isGroupedTop}
            isGroupedBottom={isGroupedBottom}
            tokens={tokens}
            currentUserId={user?.id ?? null}
          />
        </Animated.View>

        {filteredActions.length > 0 ? (
          <Animated.View
            style={[
              styles.surface,
              styles.actionSheet,
              actionBarStyle,
              {
                marginTop: GAP,
                backgroundColor: tokens.surface,
                borderColor: tokens.border,
                ...shadowStyle(tokens.shadow),
              },
            ]}
          >
            {filteredActions.map((action, index) => (
              <React.Fragment key={action.id}>
                <ContextActionButton
                  action={action}
                  onPress={action.onPress}
                  tokens={tokens}
                  gestureState={gestureState}
                  gestureSelection={QUICK_REACTIONS.length + index + 1}
                />

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
  gestureState,
  gestureSelection,
}: {
  emoji: string
  isActive: boolean
  tokens: MessageContextMenuTokens
  onPress: () => void
  gestureState?: MessageContextMenuGestureState | undefined
  gestureSelection?: number | undefined
}) {
  const scale = useSharedValue(1)
  const gestureHoverProgress = useDerivedValue(() => {
    const isHovered =
      gestureState !== undefined &&
      gestureSelection !== undefined &&
      gestureState.selection.value === gestureSelection

    return withSpring(isHovered ? 1 : 0, {
      damping: 16,
      stiffness: 320,
    })
  })

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  const gestureHoverStyle = useAnimatedStyle(() => {
    return {
      backgroundColor: interpolateColor(
        gestureHoverProgress.value,
        [0, 1],
        ['rgba(0, 0, 0, 0)', tokens.surfacePressed],
      ),
      transform: [
        { translateY: -10 * gestureHoverProgress.value },
        { scale: 1 + 0.28 * gestureHoverProgress.value },
      ],
      zIndex: gestureHoverProgress.value > 0 ? 2 : 0,
    }
  })

  const handlePress = () => {
    scale.value = withSpring(0.9, { damping: 10, stiffness: 320 }, () => {
      scale.value = withSpring(1, { damping: 12, stiffness: 250 })
    })
    onPress()
  }

  return (
    <Animated.View style={[styles.reactionGestureTarget, gestureHoverStyle]}>
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
    </Animated.View>
  )
}

function ContextActionButton({
  action,
  onPress,
  tokens,
  gestureState,
  gestureSelection,
}: {
  action: MessageContextActionConfig
  onPress: () => void
  tokens: MessageContextMenuTokens
  gestureState?: MessageContextMenuGestureState | undefined
  gestureSelection?: number | undefined
}) {
  const gestureHoverProgress = useDerivedValue(() => {
    const isHovered =
      gestureState !== undefined &&
      gestureSelection !== undefined &&
      gestureState.selection.value === gestureSelection

    return withSpring(isHovered ? 1 : 0, {
      damping: 18,
      stiffness: 320,
    })
  })

  const gestureHoverStyle = useAnimatedStyle(() => {
    return {
      backgroundColor: interpolateColor(
        gestureHoverProgress.value,
        [0, 1],
        ['rgba(0, 0, 0, 0)', tokens.surfacePressed],
      ),
      transform: [
        { translateX: 4 * gestureHoverProgress.value },
        { scale: 1 + 0.018 * gestureHoverProgress.value },
      ],
    }
  })

  return (
    <Animated.View style={gestureHoverStyle}>
      <Pressable
        onPress={onPress}
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
    </Animated.View>
  )
}

type ContextReplyPreview = {
  content: string
  icon: React.ComponentProps<typeof MaterialIcons>['name']
  senderLabel: string
  thumbnailUri: string | null
  type: 'text' | 'image' | 'video' | 'file' | 'call' | 'reel'
}

function getContextReplyPreview(
  message: Message,
  replyTarget: Message | null | undefined,
  currentUserId: string | null,
): ContextReplyPreview | null {
  const resolvedReplyTarget = replyTarget ?? message.replyTo
  const preview = message.replyPreview

  if (!preview && !resolvedReplyTarget) {
    return null
  }

  const structuredPreview = typeof preview === 'string' ? null : preview
  const sourceType = structuredPreview?.type ?? resolvedReplyTarget?.type ?? 'text'
  const type =
    sourceType === 'image' ||
    sourceType === 'video' ||
    sourceType === 'file' ||
    sourceType === 'call' ||
    sourceType === 'reel'
      ? sourceType
      : 'text'
  const sourceContent =
    (typeof preview === 'string' ? preview : structuredPreview?.content) ??
    resolvedReplyTarget?.content ??
    ''
  const normalizedContent = sourceContent.trim()
  const isUriLike = /^(https?:\/\/|file:\/\/|content:\/\/|data:|blob:)/i.test(normalizedContent)
  const fallbackContent =
    sourceType === 'image'
      ? 'Photo'
      : sourceType === 'video'
        ? 'Video'
        : sourceType === 'reel'
          ? 'Reel'
          : sourceType === 'file'
            ? 'Attachment'
            : sourceType === 'call'
              ? 'Call'
              : 'Message'
  const senderLabel =
    currentUserId &&
    (structuredPreview?.senderId ?? resolvedReplyTarget?.senderId) === currentUserId
      ? 'You'
      : structuredPreview?.senderName?.trim() ||
        resolvedReplyTarget?.sender?.email?.split('@')[0] ||
        'Original message'

  const icon: ContextReplyPreview['icon'] =
    type === 'image'
      ? 'photo'
      : type === 'video'
        ? 'videocam'
        : type === 'file'
          ? 'attach-file'
          : type === 'call'
            ? 'call'
            : type === 'reel'
              ? 'movie-filter'
              : 'format-quote'

  const thumbnailUri =
    structuredPreview?.thumbnailUri?.trim() ||
    resolvedReplyTarget?.media?.thumbnailUrl?.trim() ||
    (type === 'image' ? resolvedReplyTarget?.media?.fileUrl?.trim() : '') ||
    null

  return {
    content:
      resolvedReplyTarget && isMessageRecalled(resolvedReplyTarget)
        ? 'Tin nhắn đã thu hồi'
        : normalizedContent && !isUriLike
          ? normalizedContent
          : fallbackContent,
    icon,
    senderLabel,
    thumbnailUri,
    type,
  }
}

function getContextReactionEntries(message: Message): [string, number][] {
  const summary: Record<string, number> = {}

  Object.values(message.reactions ?? {}).forEach((reaction) => {
    if (reaction?.emoji) {
      summary[reaction.emoji] = (summary[reaction.emoji] ?? 0) + 1
    }
  })

  return Object.entries(summary)
}

function getContextSenderLabel(message: Message, isOwn: boolean) {
  if (isOwn) return 'You'

  const name =
    message.sender && 'name' in message.sender && typeof message.sender.name === 'string'
      ? message.sender.name.trim()
      : ''

  return name || message.sender?.email?.split('@')[0] || 'Someone'
}

function ContextMessagePreview({
  message,
  replyTarget,
  previewLayout,
  previewHeight,
  isOwn,
  isGroupedTop,
  isGroupedBottom,
  tokens,
  currentUserId,
}: {
  message: Message
  replyTarget?: Message | null | undefined
  previewLayout?: MessageContextPreviewLayout | undefined
  previewHeight: number
  isOwn: boolean
  isGroupedTop: boolean
  isGroupedBottom: boolean
  tokens: MessageContextMenuTokens
  currentUserId: string | null
}) {
  const replyPreview = getContextReplyPreview(message, replyTarget, currentUserId)
  const reactions = getContextReactionEntries(message)
  const hasMeasuredBubble = Boolean(previewLayout && previewLayout.bubbleHeight > 0)
  const currentSenderLabel = getContextSenderLabel(message, isOwn)
  const isVisualReply =
    Boolean(replyPreview?.thumbnailUri) &&
    (replyPreview?.type === 'image' || replyPreview?.type === 'video')
  const measuredBubbleHeight = previewLayout?.bubbleHeight ?? 0
  const measuredReactionHeight = reactions.length > 0 ? (previewLayout?.reactionHeight ?? 0) : 0
  const sourceReplyMediaHeight = previewLayout?.replyMediaHeight ?? 0
  const sourceReplyMediaWidth = previewLayout?.replyMediaWidth ?? 0
  const sourceReplyCardHeight = previewLayout?.replyCardHeight ?? 0
  const sourceReplyCardWidth = previewLayout?.replyCardWidth ?? 0
  const contextReplyPreviewHeight = previewLayout?.replyPreviewHeight
  const replyPreviewMargins = replyPreview ? 12 : 0
  const reactionRowMargin = reactions.length > 0 ? 4 : 0
  const maxReplyPreviewHeight = Math.max(
    0,
    previewHeight -
      measuredBubbleHeight -
      measuredReactionHeight -
      replyPreviewMargins -
      reactionRowMargin,
  )
  const renderedReplyPreviewHeight =
    hasMeasuredBubble && contextReplyPreviewHeight
      ? Math.min(contextReplyPreviewHeight, maxReplyPreviewHeight)
      : undefined
  const visualReplyCardWidth =
    isVisualReply && sourceReplyCardWidth > 0 ? sourceReplyCardWidth : undefined
  const visualReplyCardHeight =
    isVisualReply && sourceReplyCardHeight > 0 ? sourceReplyCardHeight : undefined

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.contextMessagePreview,
        hasMeasuredBubble ? { height: '100%' } : null,
        { alignItems: isOwn ? 'flex-end' : 'flex-start' },
      ]}
    >
      {replyPreview ? (
        <View
          style={[
            styles.contextReplyPreview,
            isVisualReply ? styles.contextVisualReplyPreview : null,
            renderedReplyPreviewHeight ? { height: renderedReplyPreviewHeight } : null,
            { alignItems: isOwn ? 'flex-end' : 'flex-start' },
          ]}
        >
          <View style={styles.contextReplyHeader}>
            <MaterialIcons name="reply" size={15} color="#A6A6A6" />
            <Text
              style={[styles.contextReplyHeaderText, { color: tokens.textSecondary }]}
              numberOfLines={1}
            >
              {currentSenderLabel} replied to {replyPreview.senderLabel}
            </Text>
          </View>

          <View
            style={[
              styles.contextReplyCard,
              isVisualReply ? styles.contextVisualReplyCard : null,
              isVisualReply
                ? { alignSelf: isOwn ? 'flex-end' : 'flex-start' }
                : styles.contextTextReplyCard,
              visualReplyCardWidth ? { width: visualReplyCardWidth } : null,
              visualReplyCardHeight ? { height: visualReplyCardHeight } : null,
              { backgroundColor: tokens.metaChip },
            ]}
          >
            {replyPreview.type === 'text' ? (
              <Text
                style={[styles.contextReplyContent, { color: tokens.textSecondary }]}
                numberOfLines={3}
              >
                {replyPreview.content}
              </Text>
            ) : isVisualReply ? (
              <View style={styles.contextVisualReply}>
                <View
                  style={[
                    styles.contextVisualReplyMedia,
                    sourceReplyMediaWidth > 0 && sourceReplyMediaHeight > 0
                      ? { height: sourceReplyMediaHeight, width: sourceReplyMediaWidth }
                      : null,
                  ]}
                >
                  <Image
                    source={{ uri: replyPreview.thumbnailUri ?? undefined }}
                    resizeMode="contain"
                    style={styles.contextVisualReplyImage}
                  />
                  {replyPreview.type === 'video' ? (
                    <View pointerEvents="none" style={styles.contextVisualReplyPlayIcon}>
                      <View style={styles.contextVisualReplyPlayButton}>
                        <MaterialIcons name="play-arrow" size={24} color="#FFFFFF" />
                      </View>
                    </View>
                  ) : null}
                </View>
                <Text
                  style={[styles.contextVisualReplyCaption, { color: tokens.textSecondary }]}
                  numberOfLines={1}
                >
                  {replyPreview.content}
                </Text>
              </View>
            ) : (
              <View style={styles.contextAttachmentReply}>
                {replyPreview.thumbnailUri ? (
                  <Image
                    source={{ uri: replyPreview.thumbnailUri }}
                    resizeMode="cover"
                    style={styles.contextReplyThumbnail}
                  />
                ) : null}
                <MaterialIcons
                  name={replyPreview.icon}
                  size={16}
                  color={tokens.textSecondary}
                  style={replyPreview.thumbnailUri ? undefined : styles.contextReplyIcon}
                />
                <Text
                  style={[styles.contextAttachmentReplyText, { color: tokens.textSecondary }]}
                  numberOfLines={2}
                >
                  {replyPreview.content}
                </Text>
              </View>
            )}
          </View>
        </View>
      ) : null}

      <View
        style={[
          styles.focusBubble,
          hasMeasuredBubble && previewLayout?.bubbleHeight
            ? { flex: 0, height: previewLayout.bubbleHeight }
            : null,
          getBubbleSurfaceStyle({ message, isOwn, isGroupedTop, isGroupedBottom, tokens }),
          shadowStyle(tokens.shadow),
        ]}
      >
        {renderBubblePreview({ message, isOwn, tokens })}
      </View>

      {reactions.length > 0 ? (
        <View
          style={[
            styles.contextReactionRow,
            hasMeasuredBubble && previewLayout?.reactionHeight
              ? { height: previewLayout.reactionHeight }
              : null,
            { justifyContent: isOwn ? 'flex-end' : 'flex-start' },
          ]}
        >
          {reactions.map(([emoji, count]) => (
            <View
              key={emoji}
              style={[styles.contextReactionChip, { backgroundColor: tokens.metaChip }]}
            >
              <Text style={styles.contextReactionEmoji}>{emoji}</Text>
              <Text style={[styles.contextReactionCount, { color: tokens.textSecondary }]}>
                {count}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
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
  if (!isReelMessage(message) || isMessageRecalled(message)) {
    return (
      <MessageBubbleContent message={message} isOwn={isOwn} variant="preview" tokens={tokens} />
    )
  }

  const thumbnailUri = message.media?.thumbnailUrl
  const avatarUri = message.media?.reelOwnerAvatarUrl
  const creatorLabel = getReelCreatorLabel(message)
  const hasCreatorIdentity = Boolean(message.media?.reelOwnerUsername || avatarUri)
  const creatorInitial = creatorLabel.replace(/^@+/, '').charAt(0).toUpperCase() || '?'

  return (
    <View style={styles.reelPreview}>
      {thumbnailUri ? (
        <Image source={{ uri: thumbnailUri }} style={styles.reelPreviewImage} resizeMode="cover" />
      ) : (
        <View style={styles.reelPreviewFallback} />
      )}

      <View pointerEvents="none" style={styles.reelCreatorBar}>
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.reelAvatar} resizeMode="cover" />
        ) : (
          <View style={styles.reelAvatarFallback}>
            {hasCreatorIdentity ? (
              <Text style={styles.reelAvatarInitial}>{creatorInitial}</Text>
            ) : (
              <MaterialIcons name="movie-filter" size={13} color="#FFFFFF" />
            )}
          </View>
        )}
        <Text style={styles.reelCreatorText} numberOfLines={1}>
          {creatorLabel}
        </Text>
      </View>

      <View pointerEvents="none" style={styles.reelPlayIcon}>
        <RoundedPlayIcon />
      </View>
    </View>
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

  if (message.type === 'image' || message.type === 'video' || isReelMessage(message)) {
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
  bubbleHeight,
  message,
  isOwn,
}: {
  anchor: BubbleAnchor
  bubbleHeight: number
  message: Message
  isOwn: boolean
}) {
  const width = anchor.width

  const alignment = {
    alignSelf: isOwn ? 'flex-end' : 'flex-start',
  } as const

  if (message.type === 'image' || message.type === 'video' || isReelMessage(message)) {
    return {
      ...alignment,
      height: bubbleHeight,
      width,
    }
  }

  return {
    ...alignment,
    height: bubbleHeight,
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
    borderTopRightRadius: isOwn && isGroupedTop ? 4 : 18,
    borderBottomRightRadius: isOwn && isGroupedBottom ? 4 : 18,
    borderTopLeftRadius: !isOwn && isGroupedTop ? 4 : 18,
    borderBottomLeftRadius: !isOwn && isGroupedBottom ? 4 : 18,
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
  contextAttachmentReply: {
    alignItems: 'center',
    flexDirection: 'row',
    minWidth: 0,
  },
  contextAttachmentReplyText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    minWidth: 0,
  },
  contextMessagePreview: {
    flex: 1,
    minHeight: 0,
    width: '100%',
  },
  contextReactionChip: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  contextReactionCount: {
    fontSize: 11,
    fontWeight: '600',
  },
  contextReactionEmoji: {
    fontSize: 12,
  },
  contextReactionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  contextReplyCard: {
    borderRadius: 22,
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  contextReplyContent: {
    fontSize: 15,
    lineHeight: 24,
  },
  contextReplyHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  contextReplyHeaderText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 6,
  },
  contextReplyIcon: {
    marginRight: 6,
  },
  contextReplyPreview: {
    marginBottom: 4,
    marginTop: 8,
    maxWidth: '100%',
  },
  contextReplyThumbnail: {
    borderRadius: 12,
    height: 42,
    marginRight: 10,
    width: 42,
  },
  contextTextReplyCard: {
    maxWidth: '100%',
  },
  contextVisualReply: {
    alignItems: 'flex-start',
  },
  contextVisualReplyCaption: {
    fontSize: 13,
    lineHeight: 18,
    marginHorizontal: 4,
    marginTop: 8,
  },
  contextVisualReplyCard: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  contextVisualReplyImage: {
    borderRadius: 16,
    height: '100%',
    width: '100%',
  },
  contextVisualReplyMedia: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  contextVisualReplyPlayButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(12,12,13,0.58)',
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  contextVisualReplyPlayIcon: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  contextVisualReplyPreview: {
    maxWidth: '100%',
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
  reactionActiveDot: {
    borderRadius: 3,
    height: 4,
    width: 4,
  },
  reactionBar: {
    justifyContent: 'center',
    overflow: 'visible',
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
  reactionGestureTarget: {
    borderRadius: 16,
  },
  reactionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    minHeight: REACTION_BAR_H,
    paddingHorizontal: 4,
  },
  reelAvatar: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 11,
    height: 22,
    width: 22,
  },
  reelAvatarFallback: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 11,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  reelAvatarInitial: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '600',
  },
  reelCreatorBar: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.18)',
    flexDirection: 'row',
    left: 0,
    paddingHorizontal: 12,
    paddingVertical: 12,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  reelCreatorText: {
    color: '#FFFFFF',
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 8,
  },
  reelPlayIcon: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  reelPreview: {
    backgroundColor: '#101010',
    flex: 1,
  },
  reelPreviewFallback: {
    backgroundColor: '#111111',
    flex: 1,
  },
  reelPreviewImage: {
    height: '100%',
    width: '100%',
  },
  stack: {
    position: 'absolute',
  },
  surface: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
})
