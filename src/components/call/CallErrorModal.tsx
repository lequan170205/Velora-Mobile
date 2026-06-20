import { MaterialIcons } from '@expo/vector-icons'
import React from 'react'
import { Modal, TouchableOpacity, View } from 'react-native'

import { colors, shadows } from '../../constants/theme'
import { Typography } from '../ui/Typography'

interface CallErrorModalProps {
  visible: boolean
  message: string | null
  onDismiss: () => void
}

const getCallErrorPresentation = (message: string) => {
  if (message === 'No one answered') {
    return {
      title: 'No answer',
      iconName: 'call-end' as const,
      iconColor: colors.brand.primary,
      iconBackgroundColor: '#FFF4EC',
    }
  }

  if (message === 'The other person is on another call') {
    return {
      title: 'Call declined',
      iconName: 'call-end' as const,
      iconColor: colors.status.error,
      iconBackgroundColor: '#FFF1F0',
    }
  }

  if (message === 'The other person needs microphone access to answer') {
    return {
      title: 'Unable to answer',
      iconName: 'mic-off' as const,
      iconColor: colors.status.error,
      iconBackgroundColor: '#FFF1F0',
    }
  }

  if (message === 'Video calls are not supported yet') {
    return {
      title: 'Video unavailable',
      iconName: 'videocam-off' as const,
      iconColor: colors.brand.primary,
      iconBackgroundColor: '#FFF4EC',
    }
  }

  if (message === 'The call was interrupted') {
    return {
      title: 'Call interrupted',
      iconName: 'error-outline' as const,
      iconColor: colors.status.error,
      iconBackgroundColor: '#FFF1F0',
    }
  }

  if (message === 'The call was rejected') {
    return {
      title: 'Call declined',
      iconName: 'call-end' as const,
      iconColor: colors.status.error,
      iconBackgroundColor: '#FFF1F0',
    }
  }

  return {
    title: 'Call update',
    iconName: 'error-outline' as const,
    iconColor: colors.brand.primary,
    iconBackgroundColor: '#FFF4EC',
  }
}

export function CallErrorModal({ visible, message, onDismiss }: CallErrorModalProps) {
  if (!message) {
    return null
  }

  const presentation = getCallErrorPresentation(message)

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View
        className="flex-1 items-center justify-center px-6"
        style={{ backgroundColor: '#00000066' }}
      >
        <View
          className="w-full max-w-[340px] rounded-[28px] border px-6 py-6"
          style={{
            backgroundColor: colors.surface.modal,
            borderColor: colors.border.light,
            ...shadows.md,
          }}
        >
          <View className="items-center">
            <View
              className="h-16 w-16 items-center justify-center rounded-full"
              style={{ backgroundColor: presentation.iconBackgroundColor }}
            >
              <MaterialIcons
                name={presentation.iconName}
                size={30}
                color={presentation.iconColor}
              />
            </View>

            <Typography variant="h2" align="center" className="mt-4">
              {presentation.title}
            </Typography>
            <Typography variant="body" align="center" className="mt-2 leading-6">
              {message}
            </Typography>
          </View>

          <TouchableOpacity
            className="mt-6 rounded-[22px] px-4 py-4"
            style={{
              backgroundColor: colors.brand.primary,
              ...shadows.glow,
            }}
            activeOpacity={0.84}
            onPress={onDismiss}
          >
            <Typography variant="button" align="center" color={colors.text.inverse}>
              OK
            </Typography>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}
