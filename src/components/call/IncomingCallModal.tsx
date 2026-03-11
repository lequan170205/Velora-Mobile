import React, { useEffect } from 'react'
import { Modal, StyleSheet, TouchableOpacity, View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import { colors, radius, spacing } from '../../constants/theme'
import { Typography } from '../ui/Typography'

interface IncomingCallModalProps {
  visible: boolean
  callerName: string
  type: 'VOICE' | 'VIDEO'
  onAccept: () => void
  onReject: () => void
}

export function IncomingCallModal({
  visible,
  callerName,
  type,
  onAccept,
  onReject,
}: IncomingCallModalProps) {
  const scale = useSharedValue(1)

  useEffect(() => {
    if (visible) {
      scale.value = withRepeat(
        withTiming(1.2, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      )
    } else {
      scale.value = 1
    }
  }, [visible, scale])

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.content}>
          <Typography variant="caption" color={colors.text.secondary}>
            Incoming {type === 'VIDEO' ? 'Video' : 'Voice'} Call
          </Typography>

          <Animated.View style={[styles.avatarRing, animatedStyle]}>
            <View style={styles.avatar}>
              <Typography variant="h1" color={colors.text.inverse}>
                {callerName.charAt(0)}
              </Typography>
            </View>
          </Animated.View>

          <Typography variant="h2" style={styles.name}>
            {callerName}
          </Typography>

          <View style={styles.actionsBox}>
            <TouchableOpacity style={[styles.actionBtn, styles.rejectBtn]} onPress={onReject}>
              <Typography variant="button" color={colors.text.primary}>
                Decline
              </Typography>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.actionBtn, styles.acceptBtn]} onPress={onAccept}>
              <Typography variant="button" color={colors.text.primary}>
                Accept
              </Typography>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  acceptBtn: { backgroundColor: colors.status.success },
  actionBtn: {
    alignItems: 'center',
    borderRadius: radius.full,
    height: 100,
    justifyContent: 'center',
    width: 100,
  },
  actionsBox: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing.xxxl,
    width: '80%',
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.brand.primary,
    borderRadius: radius.full,
    height: 100,
    justifyContent: 'center',
    width: 100,
  },
  avatarRing: {
    alignItems: 'center',
    // eslint-disable-next-line react-native/no-color-literals
    backgroundColor: 'rgba(108, 99, 255, 0.2)',
    borderRadius: radius.full,
    height: 140,
    justifyContent: 'center',
    marginVertical: spacing.xxxl,
    width: 140,
  },
  content: { alignItems: 'center', width: '100%' },
  name: { marginBottom: spacing.xxxl },
  overlay: {
    alignItems: 'center',
    // eslint-disable-next-line react-native/no-color-literals
    backgroundColor: 'rgba(10, 10, 15, 0.95)',
    flex: 1,
    justifyContent: 'center',
  },
  rejectBtn: { backgroundColor: colors.status.error },
})
