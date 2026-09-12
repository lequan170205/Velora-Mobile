import { Image, View } from 'react-native'

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
            ? 'absolute right-[-28px] top-[-24px] h-[132px] w-[220px] opacity-80'
            : 'absolute right-[-38px] top-[-28px] h-[190px] w-[318px]'
        }
      />

      <View
        className={
          compact
            ? 'h-[76px] w-[76px] items-center justify-center rounded-[24px] border border-[#F5EEE9] bg-white'
            : 'h-[112px] w-[112px] items-center justify-center rounded-[30px] border border-[#F5EEE9] bg-white'
        }
      >
        <Image
          source={veloraLogo}
          resizeMode="contain"
          className={compact ? 'h-[62px] w-[62px]' : 'h-[90px] w-[90px]'}
        />
      </View>
    </View>
  )
}
