import { type RefObject, useMemo, useRef, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'

import { cn } from '../../lib/cn'

type OtpCodeInputProps = {
  value: string
  onChangeText: (value: string) => void
  length?: number
  label?: string
  inputRef?: RefObject<TextInput | null>
  onFocus?: () => void
  onBlur?: () => void
  onSubmitEditing?: () => void
}

export function OtpCodeInput({
  value,
  onChangeText,
  length = 6,
  label = '6-digit code',
  inputRef,
  onFocus,
  onBlur,
  onSubmitEditing,
}: OtpCodeInputProps) {
  const internalInputRef = useRef<TextInput>(null)
  const [isFocused, setIsFocused] = useState(false)
  const resolvedInputRef = inputRef ?? internalInputRef

  const normalizedValue = useMemo(() => value.replace(/\D/g, '').slice(0, length), [length, value])

  const handleChangeText = (nextValue: string) => {
    onChangeText(nextValue.replace(/\D/g, '').slice(0, length))
  }

  const activeIndex = normalizedValue.length >= length ? length - 1 : normalizedValue.length

  return (
    <Pressable onPress={() => resolvedInputRef.current?.focus()} className="rounded-[20px]">
      <View className="rounded-[20px] border border-[#F1E8E1] bg-[#FFFBF8] px-4 py-4">
        <Text className="mb-3 text-sm2 font-semibold text-text-primary">{label}</Text>

        <View className="flex-row items-center justify-between gap-2">
          {Array.from({ length }).map((_, index) => {
            const character = normalizedValue[index] ?? ''
            const isActive = isFocused && index === activeIndex
            const isFilled = character.length > 0

            return (
              <View
                key={index}
                className={cn(
                  'h-14 flex-1 items-center justify-center rounded-[16px] border bg-white',
                  isActive ? 'border-brand bg-[#FFF7F2]' : 'border-[#EEE7E2]',
                  isFilled ? 'bg-white' : null,
                )}
              >
                <Text className="font-heading text-[24px] leading-[28px] text-text-primary">
                  {character || ' '}
                </Text>
              </View>
            )
          })}
        </View>

        <TextInput
          ref={resolvedInputRef}
          value={normalizedValue}
          onChangeText={handleChangeText}
          keyboardType="number-pad"
          returnKeyType="done"
          maxLength={length}
          autoFocus={false}
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          caretHidden
          className="absolute h-px w-px opacity-0"
          onFocus={() => {
            setIsFocused(true)
            onFocus?.()
          }}
          onBlur={() => {
            setIsFocused(false)
            onBlur?.()
          }}
          onSubmitEditing={onSubmitEditing}
        />
      </View>
    </Pressable>
  )
}
