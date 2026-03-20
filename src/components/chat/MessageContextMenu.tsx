import { MaterialIcons } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import React, { useEffect } from 'react'
import { Dimensions, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from 'react-native-paper'
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

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')

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
  onReply?: () => void
  onRecall?: () => void
  conversationId?: string
}

// All 8 valid emojis (matching backend)
const REACTIONS = ['👍', '❤️', '😂', '😢', '😮', '😡', '👏', '🎉']

const TOOLTIP_W = 210
const REACTION_H = 48
const ACTION_H = 44
const GAP = 10
const EDGE = 10

export function MessageContextMenu({
  visible,
  message,
  isOwn,
  anchor,
  onClose,
  onReply,
  onRecall,
  conversationId,
}: MessageContextMenuProps) {
  const theme = useTheme()
  const isDark = theme.dark
  const { user } = useAuthStore()
  const addReaction = useAddReaction()
  const removeReaction = useRemoveReaction()

  // Tooltip always uses a dark chrome surface regardless of app theme —
  // same pattern as iOS context menu and Messenger.
  const surface = isDark ? '#2C2C2E' : '#1C1C1E'
  const divider = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.10)'
  const iconBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.10)'
  const iconBgRed = 'rgba(255,69,58,0.18)'
  const labelColor = '#F2F2F7'
  const chevronColor = 'rgba(242,242,247,0.40)'
  const iconColor = 'rgba(255,255,255,0.85)'
  const red = theme.colors.error // use paper's error token

  const scale = useSharedValue(0.85)
  const opacity = useSharedValue(0)
  const backdropOpacity = useSharedValue(0)

  useEffect(() => {
    if (visible) {
      backdropOpacity.value = withTiming(1, { duration: 160 })
      opacity.value = withTiming(1, { duration: 140 })
      scale.value = withSpring(1, { damping: 22, stiffness: 320, mass: 0.45 })
    } else {
      backdropOpacity.value = withTiming(0, { duration: 120 })
      opacity.value = withTiming(0, { duration: 120 })
      scale.value = withTiming(0.85, { duration: 120 })
    }
  }, [visible])

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }))
  const tooltipStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }))

  const close = () => {
    backdropOpacity.value = withTiming(0, { duration: 120 })
    opacity.value = withTiming(0, { duration: 120 })
    scale.value = withTiming(0.85, { duration: 120 }, () => runOnJS(onClose)())
  }

  const handleCopy = async () => {
    if (message?.content) await Clipboard.setStringAsync(message.content)
    close()
  }

  const handleRecall = () => {
    onRecall?.()
    close()
  }

  const handleReply = () => {
    onReply?.()
    close()
  }

  const handleReactionPress = (emoji: string) => {
    if (!message || !user || !conversationId) return

    // Check if user already has this emoji - if same, remove (toggle), if different, replace
    // Handle both old array format and new map format
    const reactionsData = message.reactions
    let currentUserEmoji: string | undefined

    if (reactionsData && typeof reactionsData === 'object') {
      if (Array.isArray(reactionsData)) {
        // Old array format
        const userReaction = reactionsData.find((r: any) => r.userId === user.id)
        currentUserEmoji = userReaction?.emoji
      } else {
        // New map format
        currentUserEmoji = (reactionsData as Record<string, any>)[user.id]?.emoji
      }
    }

    if (currentUserEmoji === emoji) {
      // Same emoji - remove reaction
      removeReaction.mutate({ messageId: message.id, conversationId })
    } else {
      // Different emoji or no reaction - add/replace
      addReaction.mutate({ messageId: message.id, emoji, conversationId })
    }
    close()
  }

  if (!message || !anchor) return null

  const isRecalled = message.isRecalled === true || message.is_recalled === true

  const actions = [
    {
      id: 'reply',
      icon: 'reply' as const,
      label: 'Reply',
      onPress: handleReply,
      destructive: false,
      show: !isRecalled,
    },
    {
      id: 'copy',
      icon: 'content-copy' as const,
      label: 'Copy',
      onPress: handleCopy,
      destructive: false,
      show: message.type === 'text' && !isRecalled,
    },
    {
      id: 'forward',
      icon: 'forward' as const,
      label: 'Forward',
      onPress: close,
      destructive: false,
      show: !isRecalled,
    },
    {
      id: 'recall',
      icon: 'undo' as const,
      label: 'Thu hồi',
      onPress: handleRecall,
      destructive: true,
      show: isOwn && !isRecalled,
    },
  ].filter((a) => a.show)

  // ── Positioning ───────────────────────────────────────────────────────────
  const tooltipH = REACTION_H + StyleSheet.hairlineWidth + actions.length * ACTION_H

  const spaceAbove = anchor.y - GAP
  const spaceBelow = SCREEN_H - (anchor.y + anchor.height) - GAP
  const placeAbove = spaceAbove >= tooltipH || spaceAbove > spaceBelow

  const top = placeAbove ? anchor.y - tooltipH - GAP : anchor.y + anchor.height + GAP

  let left = isOwn ? anchor.x + anchor.width - TOOLTIP_W : anchor.x
  left = Math.max(EDGE, Math.min(left, SCREEN_W - TOOLTIP_W - EDGE))
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={close}>
      {/* Backdrop */}
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]} className="bg-black/30">
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>

      {/* Tooltip */}
      <Animated.View
        style={[styles.tooltip, tooltipStyle, { top, left, backgroundColor: surface }]}
      >
        {/* Reaction strip - only show if message is not recalled */}
        {!isRecalled && (
          <View
            className="flex-row items-center justify-between px-2.5"
            style={{ height: REACTION_H }}
          >
            {REACTIONS.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => handleReactionPress(emoji)}
                className="w-[34px] h-[34px] rounded-full items-center justify-center"
                style={({ pressed }) => ({
                  backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent',
                  transform: [{ scale: pressed ? 1.28 : 1 }],
                })}
              >
                <Text style={styles.emoji}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Full-width divider */}
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: divider }} />

        {/* Actions */}
        {actions.map((action, i) => (
          <React.Fragment key={action.id}>
            <Pressable
              onPress={action.onPress}
              className="flex-row items-center px-3"
              style={({ pressed }) => ({
                height: ACTION_H,
                gap: 11,
                backgroundColor: pressed
                  ? action.destructive
                    ? 'rgba(255,69,58,0.10)'
                    : 'rgba(255,255,255,0.07)'
                  : 'transparent',
              })}
            >
              {/* Icon */}
              <View
                className="w-[30px] h-[30px] rounded-full items-center justify-center"
                style={{ backgroundColor: action.destructive ? iconBgRed : iconBg }}
              >
                <MaterialIcons
                  name={action.icon}
                  size={15}
                  color={action.destructive ? red : iconColor}
                />
              </View>

              {/* Label */}
              <Text
                className="flex-1 text-sm"
                style={{ color: action.destructive ? red : labelColor, letterSpacing: -0.1 }}
              >
                {action.label}
              </Text>

              {/* Chevron */}
              {!action.destructive && (
                <MaterialIcons name="chevron-right" size={16} color={chevronColor} />
              )}
            </Pressable>

            {/* Inset divider between rows */}
            {i < actions.length - 1 && (
              <View
                style={{
                  height: StyleSheet.hairlineWidth,
                  backgroundColor: divider,
                  marginLeft: 54,
                }}
              />
            )}
          </React.Fragment>
        ))}
      </Animated.View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  emoji: {
    fontSize: 20,
    lineHeight: 25,
  },
  tooltip: {
    borderRadius: 14,
    elevation: 14,
    overflow: 'hidden',
    position: 'absolute',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    width: TOOLTIP_W,
  },
})
