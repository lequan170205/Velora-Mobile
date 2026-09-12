import { useEffect } from 'react'
import { Text, View } from 'react-native'
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'

const LoadingBubble = ({
  align = 'left',
  widthClassName,
}: {
  align?: 'left' | 'right'
  widthClassName: string
}) => {
  const isRight = align === 'right'

  return (
    <View className={isRight ? 'items-end px-4 py-1.5' : 'flex-row items-end px-4 py-1.5'}>
      {!isRight ? <View className="mr-2.5 h-8 w-8 rounded-full bg-surface-input" /> : null}

      <View
        className={`h-11 rounded-[18px] bg-surface-input ${widthClassName} ${isRight ? '' : ''}`}
      />
    </View>
  )
}

export const ConversationMessageListLoadingState = () => {
  return (
    <View className="pb-5 pt-4">
      <LoadingBubble widthClassName="w-[58%]" />
      <LoadingBubble align="right" widthClassName="w-[44%]" />
      <LoadingBubble widthClassName="w-[66%]" />
      <LoadingBubble align="right" widthClassName="w-[52%]" />
    </View>
  )
}

const Dot = ({ delay }: { delay: number }) => {
  const translateY = useSharedValue(0)

  useEffect(() => {
    translateY.value = withDelay(
      delay,
      withRepeat(
        withSequence(withTiming(-4, { duration: 300 }), withTiming(0, { duration: 300 })),
        -1,
        true,
      ),
    )
  }, [delay, translateY])

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }))

  return <Animated.View style={style} className="w-1 h-1 bg-text-muted rounded-full mx-[1px]" />
}

export const ConversationTypingIndicator = ({ label }: { label: string }) => {
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(120)}
      className="mb-3 ml-4 mt-1 self-start"
    >
      <View className="flex-row items-end">
        <Text className="mr-1 text-xs2 text-text-muted">{label}</Text>
        <View className="flex-row items-end pb-[2px]">
          <Dot delay={0} />
          <Dot delay={150} />
          <Dot delay={300} />
        </View>
      </View>
    </Animated.View>
  )
}
