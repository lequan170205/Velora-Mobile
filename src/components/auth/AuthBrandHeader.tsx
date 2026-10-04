import { Image, View } from 'react-native'

import { shadows } from '../../constants/theme'

// Metro resolves static image requires to numeric asset references at bundle time.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chatBubbles = require('../../../assets/images/auth-chat-bubbles.png') as number
// eslint-disable-next-line @typescript-eslint/no-var-requires
const veloraLogo = require('../../../assets/images/splash-icon.png') as number

type AuthBrandHeaderProps = {
  compact?: boolean
}

export function AuthBrandHeader({ compact = false }: AuthBrandHeaderProps) {
  return (
    <View className={compact ? 'h-[96px]' : 'h-[152px]'}>
      <Image
        source={chatBubbles}
        resizeMode="contain"
        className={
          compact
            ? 'absolute right-[-34px] top-[-28px] h-[146px] w-[244px] opacity-80'
            : 'absolute right-[-48px] top-[-36px] h-[210px] w-[350px]'
        }
      />

      <View
        className={
          compact
            ? 'h-[76px] w-[76px] items-center justify-center rounded-[24px] border border-border-warm-soft bg-white'
            : 'h-[116px] w-[116px] items-center justify-center rounded-[30px] border border-border-warm-soft bg-white'
        }
        style={shadows.sm}
      >
        <Image
          source={veloraLogo}
          resizeMode="contain"
          className={compact ? 'h-[62px] w-[62px]' : 'h-[94px] w-[94px]'}
        />
      </View>
    </View>
  )
}
