import { MaterialIcons } from '@expo/vector-icons'
import { usePathname } from 'expo-router'
import React, { useEffect } from 'react'
import { View } from 'react-native'
import Animated, { FadeInDown, FadeOutDown, ReduceMotion } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { colors } from '../../constants/theme'
import { AppPressable } from '../base/AppPressable'
import { AppText } from '../base/AppText'

interface CallFeedbackNoticeProps {
  visible: boolean
  message: string | null
  onDismiss: () => void
}

const TRANSIENT_OUTCOMES = new Set([
  'No one answered',
  'The other person is on another call',
  'The call was rejected',
])

const getCallFeedbackPresentation = (message: string) => {
  if (message === 'No one answered') {
    return {
      iconName: 'phone-missed' as const,
      iconColor: colors.brand.primary,
      iconBackgroundColor: colors.surface.accent,
    }
  }

  if (message === 'The other person is on another call' || message === 'The call was rejected') {
    return {
      iconName: 'call-end' as const,
      iconColor: colors.status.error,
      iconBackgroundColor: colors.surface.error,
    }
  }

  if (message.includes('microphone') || message.includes('camera') || message.includes('video')) {
    return {
      iconName: message.includes('microphone') ? ('mic-off' as const) : ('videocam-off' as const),
      iconColor: colors.brand.primary,
      iconBackgroundColor: colors.surface.accent,
    }
  }

  return {
    iconName: 'error-outline' as const,
    iconColor: colors.status.error,
    iconBackgroundColor: colors.surface.error,
  }
}

export function CallFeedbackNotice({ visible, message, onDismiss }: CallFeedbackNoticeProps) {
  const pathname = usePathname()
  const insets = useSafeAreaInsets()
  const isTransientOutcome = Boolean(message && TRANSIENT_OUTCOMES.has(message))

  useEffect(() => {
    if (!visible || !isTransientOutcome) return undefined

    const timeoutId = setTimeout(onDismiss, 4000)
    return () => clearTimeout(timeoutId)
  }, [isTransientOutcome, message, onDismiss, visible])

  if (!visible || !message) return null

  const presentation = getCallFeedbackPresentation(message)
  // Over the near-black call surface the notice must speak the dark call
  // world; everywhere else it stays on the light product canvas.
  const isCallSurface = pathname.startsWith('/call/')
  const noticeBackground = isCallSurface ? colors.call.surfaceElevated : colors.surface.modal
  const noticeBorder = isCallSurface ? colors.call.controlBorder : colors.border.light
  const noticeTextColor = isCallSurface ? colors.call.textPrimary : colors.text.primary
  const dismissIconColor = isCallSurface ? colors.call.textSecondary : colors.text.secondary
  const bottomClearance = isCallSurface ? 112 : 82

  return (
    <View pointerEvents="box-none" className="absolute inset-0 z-[10000] justify-end px-4">
      <Animated.View
        entering={FadeInDown.duration(180).reduceMotion(ReduceMotion.System)}
        exiting={FadeOutDown.duration(140).reduceMotion(ReduceMotion.System)}
        className="mx-auto w-full max-w-[420px] flex-row items-center rounded-[20px] border px-3 py-3"
        style={{
          marginBottom: Math.max(insets.bottom, 12) + bottomClearance,
          backgroundColor: noticeBackground,
          borderColor: noticeBorder,
          shadowColor: colors.text.primary,
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.14,
          shadowRadius: 20,
          elevation: 10,
        }}
      >
        <View
          className="h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: presentation.iconBackgroundColor }}
          importantForAccessibility="no"
          accessibilityElementsHidden
        >
          <MaterialIcons name={presentation.iconName} size={21} color={presentation.iconColor} />
        </View>

        <AppText
          className="ml-3 min-w-0 flex-1 text-[15px] font-medium leading-5"
          style={{ color: noticeTextColor }}
          accessible
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          accessibilityLabel={message}
        >
          {message}
        </AppText>

        <AppPressable
          className="ml-2 h-11 w-11 shrink-0 items-center justify-center rounded-full"
          activeOpacity={0.6}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss call notification"
        >
          <MaterialIcons name="close" size={21} color={dismissIconColor} />
        </AppPressable>
      </Animated.View>
    </View>
  )
}
