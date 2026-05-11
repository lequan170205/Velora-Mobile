import React from 'react'
import { Text } from 'react-native'
import { TextInput as PaperTextInput } from 'react-native-paper'

import type { TextInputProps as PaperTextInputProps } from 'react-native-paper'

interface InputProps extends Omit<PaperTextInputProps, 'mode' | 'error'> {
  label: string
  error?: string
}

export function Input({ label, error, style, ...rest }: InputProps) {
  return (
    <>
      <PaperTextInput
        mode="outlined"
        label={label}
        error={!!error}
        // NativeWind limitation: kept as inline — Paper TextInput background not styleable via className
        style={[{ backgroundColor: '#F8F8F8' }, style]}
        {...rest}
      />
      {!!error && <Text className="text-status-error text-xs2 mt-1 ml-1 font-sans">{error}</Text>}
    </>
  )
}
