import { MaterialIcons } from '@expo/vector-icons'
import { type ReactNode, type RefObject } from 'react'
import {
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  type ScrollViewProps,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { cn } from '../../lib/cn'

type AuthFlowLayoutProps = {
  children: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  onBack: () => void
  progressActive?: number
  progressTotal?: number
  footer?: ReactNode
  scrollViewRef?: RefObject<ScrollView | null>
  scrollViewProps?: ScrollViewProps
}

function StepIndicator({ active }: { active: boolean }) {
  return (
    <View className={cn('h-1.5 flex-1 rounded-full', active ? 'bg-brand' : 'bg-surface-focus')} />
  )
}

export function AuthFlowLayout({
  children,
  title,
  subtitle,
  onBack,
  progressActive = 1,
  progressTotal = 2,
  footer,
  scrollViewRef,
  scrollViewProps,
}: AuthFlowLayoutProps) {
  const insets = useSafeAreaInsets()
  const { contentContainerStyle, ...restScrollViewProps } = scrollViewProps ?? {}
  const progressItems = Array.from({ length: Math.max(progressTotal, 1) })

  return (
    <KeyboardAvoidingView className="flex-1 bg-bg-primary" behavior="padding">
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          ref={scrollViewRef}
          className="flex-1"
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          {...restScrollViewProps}
          contentContainerStyle={[
            {
              flexGrow: 1,
              paddingBottom: Math.max(insets.bottom, 20) + 24,
              paddingHorizontal: 24,
              paddingTop: insets.top + 14,
            },
            contentContainerStyle,
          ]}
        >
          <View className="absolute right-[-42px] top-[72px] h-40 w-40 rounded-full bg-[#FFF1E8]" />
          <View className="absolute left-[-54px] top-[188px] h-28 w-28 rounded-full bg-[#FFF6EF]" />

          <View className="flex-1">
            <View className="flex-row items-center justify-between">
              <TouchableOpacity
                onPress={onBack}
                className="h-11 w-11 items-center justify-center rounded-full border border-[#F1E3D7] bg-white"
                activeOpacity={0.8}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialIcons name="arrow-back" size={22} color="#1C1C1E" />
              </TouchableOpacity>

              <View className="ml-4 flex-1">
                <View className="flex-row items-center gap-2">
                  {progressItems.map((_, index) => (
                    <StepIndicator key={index} active={index < progressActive} />
                  ))}
                </View>
              </View>
            </View>

            <View className="pt-9">
              {typeof title === 'string' ? (
                <Text className="font-heading text-[34px] leading-[38px] text-text-primary">
                  {title}
                </Text>
              ) : (
                title
              )}

              {subtitle ? (
                typeof subtitle === 'string' ? (
                  <Text className="mt-2 text-base2 font-sans leading-6 text-text-secondary">
                    {subtitle}
                  </Text>
                ) : (
                  <View className="mt-2">{subtitle}</View>
                )
              ) : null}
            </View>

            <View className="mt-8 flex-1">{children}</View>

            {footer ? <View className="pt-8">{footer}</View> : null}
          </View>
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  )
}
