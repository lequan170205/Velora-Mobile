import { Image } from 'expo-image'
import React from 'react'
import { ActivityIndicator } from 'react-native'

import { colors } from '../../constants/theme'
import { SafeTouchableOpacity } from '../common/SafeTouchableOpacity'

// Metro resolves static image requires to numeric asset references at bundle time.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const veloraMark = require('../../../assets/images/velora-mark.png') as number

/** Velora's chat-bubble mark on a solid brand circle: opens the Velora AI conversation. */
export function VeloraAiButton({
  isLoading,
  onPress,
}: {
  isLoading: boolean
  onPress: () => void
}) {
  return (
    <SafeTouchableOpacity
      className="h-12 w-12 items-center justify-center rounded-full bg-brand"
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel="Open Velora AI"
      accessibilityHint="Start a chat with Velora AI"
    >
      {isLoading ? (
        <ActivityIndicator color={colors.text.inverse} size="small" />
      ) : (
        <Image
          source={veloraMark}
          contentFit="contain"
          tintColor={colors.text.inverse}
          style={{ width: 28, height: 22 }}
        />
      )}
    </SafeTouchableOpacity>
  )
}
