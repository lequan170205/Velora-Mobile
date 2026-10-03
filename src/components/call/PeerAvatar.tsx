import { Image, View } from 'react-native'

import { colors } from '../../constants/theme'
import { AppText } from '../base/AppText'

export function PeerAvatar({
  avatarUrl,
  name,
  size,
}: {
  avatarUrl: string | null
  name: string | null
  size: number
}) {
  const initial = (name || 'U').trim().charAt(0).toUpperCase() || 'U'

  return (
    <View
      className="items-center justify-center overflow-hidden rounded-full"
      style={{
        width: size,
        height: size,
        backgroundColor: colors.call.avatarFallback,
        borderColor: colors.call.avatarBorder,
        borderWidth: 1,
      }}
    >
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} resizeMode="cover" className="h-full w-full" />
      ) : (
        <AppText
          className="font-heading font-semibold"
          style={{ color: colors.call.textSecondary, fontSize: size * 0.38 }}
        >
          {initial}
        </AppText>
      )}
    </View>
  )
}
