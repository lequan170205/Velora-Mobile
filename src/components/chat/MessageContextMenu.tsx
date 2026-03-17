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
  onReaction?: (emoji: string) => void
  onUnsend?: () => void
}

const REACTIONS = ['❤️', '😂', '😮', '😢', '😡', '👍']

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
  onReaction,
  onUnsend,
}: MessageContextMenuProps) {
  const theme = useTheme()
  const isDark = theme.dark

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

  const handleReply = () => {
    onReply?.()
    close()
  }

  if (!message || !anchor) return null

  const actions = [
    {
      id: 'reply',
      icon: 'reply' as const,
      label: 'Reply',
      onPress: handleReply,
      destructive: false,
      show: true,
    },
    {
      id: 'copy',
      icon: 'content-copy' as const,
      label: 'Copy',
      onPress: handleCopy,
      destructive: false,
      show: message.type === 'text',
    },
    {
      id: 'forward',
      icon: 'forward' as const,
      label: 'Forward',
      onPress: close,
      destructive: false,
      show: true,
    },
    {
      id: 'delete',
      icon: 'delete-outline' as const,
      label: 'Unsend',
      onPress: () => {
        onUnsend?.()
        close()
      },
      destructive: true,
      show: isOwn && !message?.isDeleted,
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
        {/* Reaction strip */}
        <View
          className="flex-row items-center justify-between px-2.5"
          style={{ height: REACTION_H }}
        >
          {REACTIONS.map((emoji) => (
            <Pressable
              key={emoji}
              onPress={() => {
                onReaction?.(emoji)
                close()
              }}
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
  tooltip: {
    position: 'absolute',
    width: TOOLTIP_W,
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 14,
  },
  emoji: {
    fontSize: 20,
    lineHeight: 25,
  },
})
