import React, { useCallback, useRef } from 'react'

import { AppPressable } from '../base/AppPressable'

import type { GestureResponderEvent } from 'react-native'

interface SafeTouchableOpacityProps extends React.ComponentPropsWithoutRef<typeof AppPressable> {
  delay?: number
}

type SafeTouchableOpacityRef = React.ElementRef<typeof AppPressable>

export const SafeTouchableOpacity = React.forwardRef<
  SafeTouchableOpacityRef,
  SafeTouchableOpacityProps
>(({ onPress, delay = 500, ...props }, ref) => {
  const lastPress = useRef(0)

  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      const now = Date.now()
      if (now - lastPress.current > delay) {
        lastPress.current = now
        onPress?.(e)
      }
    },
    [onPress, delay],
  )

  return <AppPressable ref={ref} onPress={handlePress} {...props} />
})

SafeTouchableOpacity.displayName = 'SafeTouchableOpacity'
