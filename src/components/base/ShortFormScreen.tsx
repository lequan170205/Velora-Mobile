import { forwardRef, useState } from 'react'
import { type LayoutChangeEvent } from 'react-native'
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewProps,
  type KeyboardAwareScrollViewRef,
} from 'react-native-keyboard-controller'

const OVERFLOW_TOLERANCE = 1

export const ShortFormScreen = forwardRef<KeyboardAwareScrollViewRef, KeyboardAwareScrollViewProps>(
  function ShortFormScreen({ onContentSizeChange, onLayout, scrollEnabled, ...props }, ref) {
    const [viewportHeight, setViewportHeight] = useState(0)
    const [contentHeight, setContentHeight] = useState(0)

    const handleLayout = (event: LayoutChangeEvent) => {
      setViewportHeight(event.nativeEvent.layout.height)
      onLayout?.(event)
    }

    const handleContentSizeChange = (width: number, height: number) => {
      setContentHeight(height)
      onContentSizeChange?.(width, height)
    }

    const contentOverflows =
      viewportHeight > 0 && contentHeight > viewportHeight + OVERFLOW_TOLERANCE
    const shouldScroll = scrollEnabled ?? contentOverflows

    return (
      <KeyboardAwareScrollView
        ref={ref}
        {...props}
        bottomOffset={32}
        bounces={false}
        alwaysBounceVertical={false}
        overScrollMode="never"
        scrollEnabled={shouldScroll}
        onLayout={handleLayout}
        onContentSizeChange={handleContentSizeChange}
      />
    )
  },
)
