import { MaterialIcons } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import React, { useState } from 'react'
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
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'

import { useAddReaction, useRemoveReaction } from '../../../hooks/useMessageActions'
import { useAuthStore } from '../../../stores/authStore'

import {
  ACTION_ROW_H,
  EDGE_MARGIN,
  EXTENDED_EMOJIS,
  GAP,
  IOS_MENU_SPRING,
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

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

export function MessageContextMenu({
  visible,
  message,
  isOwn,
  anchor,
  onClose,
  onReply,
  onForward,
  onRecall,
  conversationId,
}: MessageContextMenuProps) {
  const { user } = useAuthStore()
  const addReaction = useAddReaction()
  const removeReaction = useRemoveReaction()
  const { width: screenW, height: screenH } = useWindowDimensions()
  const theme = useTheme<MD3Theme>()
  const [isPickerExpanded, setIsPickerExpanded] = useState(false)
  const tokens = getMessageContextMenuTokens(theme)

  const backdropOpacity = useSharedValue(0)
  const stackOpacity = useSharedValue(0)
  const stackTranslateY = useSharedValue(15)
  const focusScale = useSharedValue(0.85)
  const menuScale = useSharedValue(0.9)
  const pickerTranslateY = useSharedValue(screenH)

  React.useEffect(() => {
    if (visible) {
      setIsPickerExpanded(false)
      pickerTranslateY.value = screenH

      backdropOpacity.value = withTiming(1, { duration: 250 })
      stackOpacity.value = withTiming(1, { duration: 200 })
      stackTranslateY.value = withSpring(0, IOS_MENU_SPRING)
      focusScale.value = withSpring(1, IOS_MENU_SPRING)
      menuScale.value = withSpring(1, IOS_MENU_SPRING)
    } else {
      backdropOpacity.value = withTiming(0, { duration: 150 })
      stackOpacity.value = withTiming(0, { duration: 120 })
      stackTranslateY.value = withTiming(10, { duration: 150 })
      focusScale.value = withTiming(0.9, { duration: 150 })
      menuScale.value = withTiming(0.95, { duration: 150 })
      pickerTranslateY.value = withTiming(screenH, { duration: 150 })
    }
  }, [
    backdropOpacity,
    focusScale,
    menuScale,
    pickerTranslateY,
    screenH,
    stackOpacity,
    stackTranslateY,
    visible,
  ])

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }))

  const stackStyle = useAnimatedStyle(() => ({
    opacity: stackOpacity.value,
    transform: [{ translateY: stackTranslateY.value }],
  }))

  const focusStyle = useAnimatedStyle(() => ({
    transform: [{ scale: focusScale.value }],
  }))

  const menuScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: menuScale.value }],
  }))

  const close = () => {
    backdropOpacity.value = withTiming(0, { duration: 140 })

    if (isPickerExpanded) {
      pickerTranslateY.value = withTiming(screenH, { duration: 160 }, () => runOnJS(onClose)())
    } else {
      stackOpacity.value = withTiming(0, { duration: 110 })
      stackTranslateY.value = withTiming(6, { duration: 110 })
      focusScale.value = withTiming(0.98, { duration: 110 }, () => runOnJS(onClose)())
    }
  }

  const openFullPicker = () => {
    setIsPickerExpanded(true)
    stackOpacity.value = withTiming(0, { duration: 150 })
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

  if (!message || !anchor) return null

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
      <Animated.View
        style={[StyleSheet.absoluteFillObject, backdropStyle, { backgroundColor: tokens.backdrop }]}
      >
        <Pressable style={StyleSheet.absoluteFillObject} onPress={close} />
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
              menuScaleStyle,
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

        <Animated.View
          style={[
            focusStyle,
            {
              width: anchor.width,
              height: anchor.height,
              alignSelf: isOwn ? 'flex-end' : 'flex-start',
            },
          ]}
        >
          <View
            style={[
              styles.focusBubble,
              getBubbleSurfaceStyle({ message, isOwn, tokens }),
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
              menuScaleStyle,
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

  if (message.type === 'file' || message.type === 'voice') {
    return (
      <View style={styles.attachmentPreview}>
        <View
          style={[
            styles.attachmentIconWrap,
            { backgroundColor: isOwn ? 'rgba(255,255,255,0.14)' : tokens.metaChip },
          ]}
        >
          <MaterialIcons
            name={message.type === 'voice' ? 'keyboard-voice' : 'attach-file'}
            size={18}
            color={isOwn ? tokens.textInverse : tokens.textPrimary}
          />
        </View>
        <View style={styles.attachmentTextWrap}>
          <Text
            numberOfLines={1}
            style={[
              styles.attachmentTitle,
              { color: isOwn ? tokens.textInverse : tokens.textPrimary },
            ]}
          >
            {message.type === 'voice' ? 'Tin nhắn thoại' : 'Tệp đính kèm'}
          </Text>
          <Text
            numberOfLines={1}
            style={[
              styles.attachmentMeta,
              { color: isOwn ? 'rgba(255,255,255,0.72)' : tokens.textSecondary },
            ]}
          >
            {message.type === 'voice' ? 'Nhấn để phát lại' : 'Chạm để mở'}
          </Text>
        </View>
      </View>
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
  tokens,
}: {
  message: Message
  isOwn: boolean
  tokens: MessageContextMenuTokens
}) {
  const isRecalled = isMessageRecalled(message)

  if (message.type === 'image') {
    return {
      backgroundColor: 'transparent',
      padding: 0,
      borderWidth: 0,
    }
  }

  const commonStyle = {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 0,
  }

  if (isOwn) {
    return {
      ...commonStyle,
      backgroundColor: tokens.accent,
    }
  }

  return {
    ...commonStyle,
    backgroundColor: isRecalled ? tokens.recalledIncomingBubble : tokens.incomingBubble,
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
  attachmentIconWrap: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  attachmentMeta: {
    fontSize: 12,
    lineHeight: 16,
  },
  attachmentPreview: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  attachmentTextWrap: {
    flex: 1,
    gap: 2,
  },
  attachmentTitle: {
    fontSize: 15,
    fontWeight: '600',
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
    justifyContent: 'center',
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
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 22,
  },
})
