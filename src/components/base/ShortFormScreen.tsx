import { forwardRef, useEffect, useRef, useState } from 'react'
import { type LayoutChangeEvent } from 'react-native'
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewProps,
  type KeyboardAwareScrollViewRef,
  useKeyboardState,
} from 'react-native-keyboard-controller'

const OVERFLOW_TOLERANCE = 1

export const ShortFormScreen = forwardRef<KeyboardAwareScrollViewRef, KeyboardAwareScrollViewProps>(
  function ShortFormScreen({ onContentSizeChange, onLayout, scrollEnabled, ...props }, ref) {
    const internalRef = useRef<KeyboardAwareScrollViewRef>(null)
    const [viewportHeight, setViewportHeight] = useState(0)
    const [contentHeight, setContentHeight] = useState(0)
    const { isVisible: isKeyboardVisible } = useKeyboardState()

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

    // Expose the inner scroll view through the forwarded ref.
    useEffect(() => {
      if (typeof ref === 'function') {
        ref(internalRef.current)
        return
      }
      if (ref) {
        ref.current = internalRef.current
      }
    }, [ref])

    // While the keyboard is open, the keyboard-aware widget scrolls to keep the
    // focused input visible. When it closes, the form fits the viewport again
    // but the ScrollView keeps its offset if scrolling gets disabled in the same
    // breath (notably on Android), stranding the bottom CTA off-screen. Snap
    // back to the top whenever the content fits and no keyboard is up.
    useEffect(() => {
      if (isKeyboardVisible) return
      if (viewportHeight === 0 || contentHeight > viewportHeight + OVERFLOW_TOLERANCE) return

      const raf = requestAnimationFrame(() => {
        internalRef.current?.scrollTo({ y: 0, animated: true })
      })
      return () => cancelAnimationFrame(raf)
    }, [contentHeight, isKeyboardVisible, viewportHeight])

    return (
      <KeyboardAwareScrollView
        ref={internalRef}
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
