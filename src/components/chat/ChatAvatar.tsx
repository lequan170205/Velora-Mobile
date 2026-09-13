import { MaterialIcons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import React from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../constants/theme'
import { AppText } from '../base/AppText'

type ChatAvatarProps = {
  name: string
  picture?: string | null | undefined
  size: number
  isOnline?: boolean
  showGroupBadge?: boolean
}
// Squircle ratio shared by every chat surface (list rows, rail, headers).
const getAvatarRadius = (size: number) => Math.round(size * 0.34)
const getPresenceDotSize = (size: number) => (size >= 56 ? 16 : 13)

export const ChatAvatar = React.memo(function ChatAvatar({
  name,
  picture,
  size,
  isOnline = false,
  showGroupBadge = false,
}: ChatAvatarProps) {
  const radius = getAvatarRadius(size)
  const dotSize = getPresenceDotSize(size)
  const initial = (name.trim().charAt(0) || '?').toUpperCase()
  const badgeSize = Math.max(18, Math.round(size * 0.36))

  return (
    <View style={{ width: size, height: size }}>
      {picture ? (
        <Image
          source={{ uri: picture }}
          style={{
            width: size,
            height: size,
            borderRadius: radius,
            backgroundColor: colors.surface.input,
          }}
          contentFit="cover"
          transition={120}
        />
      ) : (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: radius,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surface.accent,
          }}
        >
          <AppText
            className="font-heading"
            style={{
              color: colors.brand.tertiary,
              fontSize: Math.round(size * 0.38),
              lineHeight: Math.round(size * 0.46),
            }}
          >
            {initial}
          </AppText>
        </View>
      )}

      {!isOnline && showGroupBadge ? (
        <View
          style={[
            styles.badge,
            {
              width: badgeSize,
              height: badgeSize,
              borderRadius: badgeSize / 2,
              borderColor: colors.bg.primary,
            },
          ]}
        >
          <MaterialIcons
            name="groups"
            size={Math.round(badgeSize * 0.62)}
            color={colors.brand.tertiary}
          />
        </View>
      ) : null}

      {isOnline ? (
        <View
          style={[
            styles.presenceDot,
            {
              width: dotSize,
              height: dotSize,
              borderRadius: dotSize / 2,
              borderColor: colors.bg.primary,
              borderWidth: dotSize >= 15 ? 2.5 : 2,
            },
          ]}
        />
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    backgroundColor: colors.surface.accent,
    borderWidth: 2,
    bottom: -2,
    justifyContent: 'center',
    position: 'absolute',
    right: -2,
  },
  presenceDot: {
    backgroundColor: colors.status.online,
    bottom: -1,
    position: 'absolute',
    right: -1,
  },
})
