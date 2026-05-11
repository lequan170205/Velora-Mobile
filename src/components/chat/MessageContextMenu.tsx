import { MaterialIcons } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import React from 'react'
import {
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native'
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'

import { useAddReaction, useRemoveReaction } from '../../hooks/useMessageActions'
import { useAuthStore } from '../../stores/authStore'

import type { Message } from '../../types/conversation.types'

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

interface ActionItem {
  id: 'reply' | 'copy' | 'forward' | 'recall'
  icon: React.ComponentProps<typeof MaterialIcons>['name']
  label: string
  onPress: () => void
  destructive: boolean
}

const REACTIONS = ['👍', '❤️', '😂', '😢', '😮', '😡', '👏', '🎉']
const RECALL_WINDOW_MS = 24 * 60 * 60 * 1000
const RESTRICTED_TYPES = ['system', 'call', 'call_log']

const EDGE_MARGIN = 16
const SAFE_VERTICAL = 48
const GAP = 10
const REACTION_BAR_H = 56
const ACTION_ROW_H = 54
const MENU_MIN_W = 220
const MENU_MAX_W = 296

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
  const scheme = useColorScheme()
  const isDark = scheme === 'dark'

  const tokens = {
    backdrop: isDark ? 'rgba(0,0,0,0.64)' : 'rgba(0,0,0,0.22)',
    surface: isDark ? 'rgba(28, 28, 30, 0.98)' : 'rgba(255, 255, 255, 0.98)',
    surfacePressed: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    border: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    divider: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    textPrimary: isDark ? '#FFFFFF' : '#111111',
    textSecondary: isDark ? '#9A9AA1' : '#6B7280',
    textInverse: '#FFFFFF',
    accent: '#FF6B2C',
    accentSoft: isDark ? 'rgba(255,107,44,0.18)' : 'rgba(255,107,44,0.12)',
    accentRing: isDark ? 'rgba(255,107,44,0.42)' : 'rgba(255,107,44,0.24)',
    danger: isDark ? '#FF6B6B' : '#E5484D',
    incomingBubble: isDark ? '#2C2C2E' : '#FFFFFF',
    incomingBubbleBorder: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    metaChip: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.05)',
    shadow: '#000000',
  }

  const backdropOpacity = useSharedValue(0)
  const stackOpacity = useSharedValue(0)
  const stackTranslateY = useSharedValue(8)
  const focusScale = useSharedValue(0.98)

  React.useEffect(() => {
    if (visible) {
      backdropOpacity.value = withTiming(1, { duration: 160 })
      stackOpacity.value = withTiming(1, { duration: 180 })
      stackTranslateY.value = withSpring(0, { damping: 20, stiffness: 260, mass: 0.55 })
      focusScale.value = withSpring(1, { damping: 18, stiffness: 240, mass: 0.55 })
    } else {
      backdropOpacity.value = withTiming(0, { duration: 140 })
      stackOpacity.value = withTiming(0, { duration: 120 })
      stackTranslateY.value = withTiming(8, { duration: 120 })
      focusScale.value = withTiming(0.98, { duration: 120 })
    }
  }, [visible])

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

  const close = () => {
    backdropOpacity.value = withTiming(0, { duration: 140 })
    stackOpacity.value = withTiming(0, { duration: 110 })
    stackTranslateY.value = withTiming(6, { duration: 110 })
    focusScale.value = withTiming(0.98, { duration: 110 }, () => runOnJS(onClose)())
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

    const reactionsData = message.reactions
    let currentUserEmoji: string | undefined

    if (reactionsData && typeof reactionsData === 'object') {
      if (Array.isArray(reactionsData)) {
        // Old array format
        const userReaction = reactionsData.find(
          (r: { userId: string; emoji: string }) => r.userId === user.id,
        )
        currentUserEmoji = userReaction?.emoji
      } else {
        // New map format
        currentUserEmoji = (reactionsData as Record<string, { emoji: string }>)[user.id]?.emoji
      }
    }

    if (currentUserEmoji === emoji) {
      removeReaction.mutate({ messageId: message.id, conversationId })
    } else {
      addReaction.mutate({ messageId: message.id, emoji, conversationId })
    }

    close()
  }

  if (!message || !anchor) return null

  const isRecalled = message.isRecalled === true || message.is_recalled === true
  const isExpired = Date.now() - new Date(message.createdAt).getTime() > RECALL_WINDOW_MS
  const isRestrictedType = RESTRICTED_TYPES.includes(message.type)

  let activeEmoji: string | undefined
  if (user && message.reactions && typeof message.reactions === 'object') {
    if (Array.isArray(message.reactions)) {
      activeEmoji = message.reactions.find((reaction: any) => reaction.userId === user.id)?.emoji
    } else {
      activeEmoji = (message.reactions as Record<string, any>)[user.id]?.emoji
    }
  }

  const reactionCounts: Record<string, number> = {}
  if (message.reactions && typeof message.reactions === 'object') {
    if (Array.isArray(message.reactions)) {
      for (const reaction of message.reactions as any[]) {
        if (reaction.emoji) {
          reactionCounts[reaction.emoji] = (reactionCounts[reaction.emoji] || 0) + 1
        }
      }
    } else {
      for (const value of Object.values(message.reactions as Record<string, any>)) {
        if (value?.emoji) {
          reactionCounts[value.emoji] = (reactionCounts[value.emoji] || 0) + 1
        }
      }
    }
  }

  const actions = [
    {
      id: 'reply' as const,
      icon: 'reply' as const,
      label: 'Trả lời',
      onPress: handleReply,
      destructive: false,
    },
    {
      id: 'copy' as const,
      icon: 'content-copy' as const,
      label: 'Sao chép',
      onPress: handleCopy,
      destructive: false,
    },
    {
      id: 'forward' as const,
      icon: 'forward' as const,
      label: 'Chuyển tiếp',
      onPress: handleForward,
      destructive: false,
    },
    {
      id: 'recall' as const,
      icon: 'delete-outline' as const,
      label: 'Thu hồi',
      onPress: handleRecall,
      destructive: true,
    },
  ] satisfies ActionItem[]

  const filteredActions = actions.filter((action) => {
    if (action.id === 'reply') return !isRecalled && Boolean(onReply)
    if (action.id === 'copy') return message.type === 'text' && !isRecalled
    if (action.id === 'forward') return !isRecalled && Boolean(onForward)
    if (action.id === 'recall') {
      return Boolean(onRecall) && isOwn && !isRecalled && !isExpired && !isRestrictedType
    }
    return false
  })

  const menuWidth = clamp(
    Math.max(anchor.width, MENU_MIN_W),
    MENU_MIN_W,
    Math.min(MENU_MAX_W, screenW - EDGE_MARGIN * 2),
  )
  const bubbleWidth = Math.min(anchor.width, menuWidth)
  const bubbleHeight = anchor.height
  const reactionVisible = !isRecalled
  const reactionHeight = reactionVisible ? REACTION_BAR_H : 0
  const actionHeight =
    filteredActions.length * ACTION_ROW_H + Math.max(0, filteredActions.length - 1)
  const totalHeight = reactionHeight + bubbleHeight + actionHeight + GAP * (reactionVisible ? 2 : 1)

  const stackLeft = clamp(
    isOwn ? anchor.x + anchor.width - menuWidth : anchor.x,
    EDGE_MARGIN,
    screenW - menuWidth - EDGE_MARGIN,
  )
  const desiredTop = anchor.y - reactionHeight - (reactionVisible ? GAP : 0)
  const stackTop = clamp(desiredTop, SAFE_VERTICAL, screenH - totalHeight - SAFE_VERTICAL)

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
        style={[styles.stack, stackStyle, { top: stackTop, left: stackLeft, width: menuWidth }]}
      >
        {reactionVisible ? (
          <View
            style={[
              styles.surface,
              styles.reactionBar,
              {
                height: REACTION_BAR_H,
                backgroundColor: tokens.surface,
                borderColor: tokens.border,
                ...shadowStyle(tokens.shadow),
              },
            ]}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.reactionScroll}
            >
              {REACTIONS.map((emoji) => (
                <ReactionButton
                  key={emoji}
                  emoji={emoji}
                  isActive={activeEmoji === emoji}
                  count={reactionCounts[emoji] || 0}
                  tokens={tokens}
                  onPress={() => handleReactionPress(emoji)}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        <Animated.View
          style={[
            focusStyle,
            {
              width: bubbleWidth,
              height: bubbleHeight,
              alignSelf: isOwn ? 'flex-end' : 'flex-start',
            },
          ]}
        >
          <View
            style={[
              styles.focusBubble,
              getBubbleSurfaceStyle({ message, isOwn, isDark, tokens }),
              shadowStyle(tokens.shadow),
            ]}
          >
            {renderBubblePreview({ message, isOwn, tokens })}
          </View>
        </Animated.View>

        {filteredActions.length > 0 ? (
          <View
            style={[
              styles.surface,
              styles.actionSheet,
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
                  style={({ pressed }) => [
                    styles.actionRow,
                    { backgroundColor: pressed ? tokens.surfacePressed : 'transparent' },
                  ]}
                >
                  <View
                    style={[
                      styles.actionIconWrap,
                      {
                        backgroundColor: action.destructive
                          ? `${tokens.danger}${isDark ? '18' : '12'}`
                          : tokens.metaChip,
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
                </Pressable>
                {index < filteredActions.length - 1 ? (
                  <View style={[styles.divider, { backgroundColor: tokens.divider }]} />
                ) : null}
              </React.Fragment>
            ))}
          </View>
        ) : null}
      </Animated.View>
    </Modal>
  )
}

function ReactionButton({
  emoji,
  isActive,
  count,
  tokens,
  onPress,
}: {
  emoji: string
  isActive: boolean
  count: number
  tokens: Record<string, string>
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
      style={[
        styles.reactionButton,
        animatedStyle,
        {
          backgroundColor: isActive ? tokens.accentSoft : 'transparent',
          borderColor: isActive ? tokens.accentRing : 'transparent',
        },
      ]}
    >
      <Text style={styles.reactionEmoji}>{emoji}</Text>
      {count > 0 ? (
        <Text
          style={[styles.reactionCount, { color: isActive ? tokens.accent : tokens.textSecondary }]}
        >
          {count > 99 ? '99+' : count}
        </Text>
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
  tokens: Record<string, string>
}) {
  const isRecalled = message.isRecalled === true || message.is_recalled === true

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
  isDark,
  tokens,
}: {
  message: Message
  isOwn: boolean
  isDark: boolean
  tokens: Record<string, string>
}) {
  const isRecalled = message.isRecalled === true || message.is_recalled === true

  if (message.type === 'image') {
    return {
      backgroundColor: '#000000',
      padding: 0,
      borderWidth: 0,
    }
  }

  if (isOwn) {
    return {
      backgroundColor: tokens.accent,
      paddingHorizontal: 16,
      paddingVertical: 12,
    }
  }

  return {
    backgroundColor: isRecalled
      ? isDark
        ? 'rgba(255,255,255,0.04)'
        : 'rgba(255,255,255,0.96)'
      : tokens.incomingBubble,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.incomingBubbleBorder,
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
  focusBubble: {
    borderRadius: 24,
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  imagePreview: {
    height: '100%',
    width: '100%',
  },
  reactionBar: {
    justifyContent: 'center',
  },
  reactionButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    gap: 1,
    justifyContent: 'center',
    minHeight: 42,
    width: 42,
  },
  reactionCount: {
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 12,
  },
  reactionEmoji: {
    fontSize: 22,
    lineHeight: 24,
  },
  reactionScroll: {
    alignItems: 'center',
    gap: 4,
    minHeight: REACTION_BAR_H,
    paddingHorizontal: 6,
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
