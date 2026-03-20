import React, { useCallback, useRef } from 'react'
import type { TouchableOpacityProps } from 'react-native';
import { TouchableOpacity } from 'react-native'

interface SafeTouchableOpacityProps extends TouchableOpacityProps {
  delay?: number
}

export const SafeTouchableOpacity: React.FC<SafeTouchableOpacityProps> = ({
  onPress,
  delay = 500,
  ...props
}) => {
  const lastPress = useRef(0)

  const handlePress = useCallback(
    (e: any) => {
      const now = Date.now()
      if (now - lastPress.current > delay) {
        lastPress.current = now
        if (onPress) onPress(e)
      }
    },
    [onPress, delay],
  )

  return <TouchableOpacity onPress={handlePress} {...props} />
}
