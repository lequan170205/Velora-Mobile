import { MaterialIcons } from '@expo/vector-icons'
import { type ReactNode } from 'react'
import {
  Keyboard,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  type ScrollViewProps,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { cn } from '../../lib/cn'
import { ShortFormScreen } from '../base/ShortFormScreen'

type AuthFlowLayoutProps = {
  children: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  onBack: () => void
  progressActive?: number
  progressTotal?: number
  footer?: ReactNode
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
  scrollViewProps,
}: AuthFlowLayoutProps) {
  const insets = useSafeAreaInsets()
  const { contentContainerStyle, ...restScrollViewProps } = scrollViewProps ?? {}
  const progressItems = Array.from({ length: Math.max(progressTotal, 1) })

  return (
    <View className="flex-1 bg-bg-primary">
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ShortFormScreen
          className="flex-1"
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          {...restScrollViewProps}
          contentContainerStyle={[
            {
              flexGrow: 1,
              paddingBottom: Math.max(insets.bottom + 28, 44),
              paddingHorizontal: 24,
              paddingTop: insets.top + 10,
            },
            contentContainerStyle,
          ]}
        >
          <View className="flex-1">
            <View className="flex-row items-center justify-between">
              <TouchableOpacity
                onPress={onBack}
                className="h-11 w-11 items-center justify-center rounded-[16px] border border-[#EEE7E2] bg-white"
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

            <View className="pt-6">
              {typeof title === 'string' ? (
                <Text className="font-heading text-[32px] leading-[36px] tracking-[-0.6px] text-text-primary">
                  {title}
                </Text>
              ) : (
                title
              )}

              {subtitle ? (
                typeof subtitle === 'string' ? (
                  <Text className="mt-2 text-base font-sans leading-6 text-text-secondary">
                    {subtitle}
                  </Text>
                ) : (
                  <View className="mt-2">{subtitle}</View>
                )
              ) : null}
            </View>

            <View className="mt-6 flex-1">{children}</View>

            {footer ? <View className="pt-7">{footer}</View> : null}
          </View>
        </ShortFormScreen>
      </TouchableWithoutFeedback>
    </View>
  )
}
