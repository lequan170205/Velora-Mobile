import { MaterialIcons } from '@expo/vector-icons'
import { Image, View } from 'react-native'

import { colors } from '../../constants/theme'
import { AppText } from '../base/AppText'

import { PeerAvatar } from './PeerAvatar'

export function CameraOffSurface({
  avatarUrl,
  name,
  status,
  local = false,
}: {
  avatarUrl: string | null
  name: string | null
  status?: string
  local?: boolean
}) {
  return (
    <View
      className="flex-1 items-center justify-center overflow-hidden rounded-[18px]"
      style={{ backgroundColor: colors.call.cameraOffSurface }}
    >
      {avatarUrl ? (
        <Image
          source={{ uri: avatarUrl }}
          resizeMode="cover"
          blurRadius={42}
          className="absolute inset-0 h-full w-full"
          style={{ opacity: 0.34, transform: [{ scale: 1.25 }] }}
        />
      ) : null}
      <View className="absolute inset-0 bg-black/25" />

      {local ? (
        <View
          className="h-14 w-14 items-center justify-center rounded-full"
          style={{ backgroundColor: colors.call.localAvatar }}
        >
          <MaterialIcons name="person" size={42} color={colors.call.localAvatarIcon} />
        </View>
      ) : (
        <PeerAvatar avatarUrl={avatarUrl} name={name} size={52} />
      )}

      {status ? (
        <AppText
          className="mt-4 max-w-[82%] text-center text-[16px] font-medium"
          style={{ color: colors.call.textPrimary }}
          numberOfLines={2}
        >
          {status}
        </AppText>
      ) : null}
    </View>
  )
}
