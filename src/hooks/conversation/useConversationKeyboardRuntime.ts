import { useCallback, useRef, useState } from 'react'
import {
  KeyboardController,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller'
import {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

import type { MessageInputHandle } from '../../components/chat/MessageInput'

type UseConversationKeyboardRuntimeInput = {
  bottomInset: number
}

export const useConversationKeyboardRuntime = ({
  bottomInset,
}: UseConversationKeyboardRuntimeInput) => {
  const messageInputRef = useRef<MessageInputHandle>(null)
  const isComposerFocusedRef = useRef(false)
  const shouldRestoreComposerFocusRef = useRef(false)
  const [messageViewportHeight, setMessageViewportHeight] = useState(0)
  const preservedKeyboardOffset = useSharedValue(0)
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation()

  const keyboardWrapperStyle = useAnimatedStyle(() => {
    const liveKeyboardOffset = Math.abs(keyboardHeight.value)
    const frozenOffset = preservedKeyboardOffset.value

    return {
      transform: [{ translateY: -Math.max(liveKeyboardOffset, frozenOffset) }],
    }
  })

  const listSpacerStyle = useAnimatedStyle(() => {
    const ACTIVE_PADDING = 8
    const resolvedBottomInset = Math.max(bottomInset, 8)

    const dynamicPadding = interpolate(
      Math.abs(keyboardHeight.value),
      [0, 40],
      [resolvedBottomInset, ACTIVE_PADDING],
      Extrapolation.CLAMP,
    )

    return { height: dynamicPadding + 50 }
  })

  const getReplyScrollViewPosition = useCallback(() => {
    const DEFAULT_VIEW_POSITION = 0.72
    const state = KeyboardController.state()
    const activeKeyboardHeight = Math.abs(state.height || 0)

    if (!isComposerFocusedRef.current || activeKeyboardHeight <= 0 || messageViewportHeight <= 0) {
      return DEFAULT_VIEW_POSITION
    }

    const visibleViewportRatio = Math.max(
      0.58,
      Math.min(1, (messageViewportHeight - activeKeyboardHeight) / messageViewportHeight),
    )

    return Math.max(0.42, DEFAULT_VIEW_POSITION * visibleViewportRatio)
  }, [messageViewportHeight])

  const prepareContextMenuKeyboardPreservation = useCallback(() => {
    const state = KeyboardController.state()
    const activeKeyboardHeight = Math.abs(state.height || 0)
    const isVisible = KeyboardController.isVisible()

    const shouldPreserveKeyboardSpace =
      isComposerFocusedRef.current && (isVisible || activeKeyboardHeight > 0)

    if (!shouldPreserveKeyboardSpace || activeKeyboardHeight <= 0) {
      shouldRestoreComposerFocusRef.current = false
      preservedKeyboardOffset.value = 0
      return false
    }

    shouldRestoreComposerFocusRef.current = true
    preservedKeyboardOffset.value = activeKeyboardHeight

    return true
  }, [preservedKeyboardOffset])

  const releasePreservedKeyboardOffset = useCallback(() => {
    preservedKeyboardOffset.value = withTiming(0, { duration: 160 })
  }, [preservedKeyboardOffset])

  const dismissKeyboardForContextMenu = useCallback(() => {
    requestAnimationFrame(() => {
      messageInputRef.current?.blur()
      void KeyboardController.dismiss()
    })
  }, [])

  const restoreComposerAfterContextMenu = useCallback(() => {
    if (!shouldRestoreComposerFocusRef.current) {
      releasePreservedKeyboardOffset()
      return
    }

    requestAnimationFrame(() => {
      messageInputRef.current?.focus()

      setTimeout(() => {
        shouldRestoreComposerFocusRef.current = false
        releasePreservedKeyboardOffset()
      }, 280)
    })
  }, [releasePreservedKeyboardOffset])

  const handleComposerFocusChange = useCallback(
    (focused: boolean) => {
      isComposerFocusedRef.current = focused

      if (focused) {
        if (!shouldRestoreComposerFocusRef.current) {
          preservedKeyboardOffset.value = 0
        }
        return
      }

      if (!shouldRestoreComposerFocusRef.current) {
        preservedKeyboardOffset.value = withTiming(0, { duration: 120 })
      }
    },
    [preservedKeyboardOffset],
  )

  const dismissComposer = useCallback(() => {
    shouldRestoreComposerFocusRef.current = false
    preservedKeyboardOffset.value = withTiming(0, { duration: 120 })
    messageInputRef.current?.blur()
    void KeyboardController.dismiss()
  }, [preservedKeyboardOffset])

  const resetConversationKeyboard = useCallback(() => {
    shouldRestoreComposerFocusRef.current = false
    preservedKeyboardOffset.value = 0
  }, [preservedKeyboardOffset])

  const handleMessageViewportLayout = useCallback(
    (event: { nativeEvent: { layout: { height: number } } }) => {
      const nextHeight = event.nativeEvent.layout.height

      setMessageViewportHeight((currentHeight) => {
        return Math.abs(currentHeight - nextHeight) < 1 ? currentHeight : nextHeight
      })
    },
    [],
  )

  return {
    dismissComposer,
    dismissKeyboardForContextMenu,
    getReplyScrollViewPosition,
    handleComposerFocusChange,
    handleMessageViewportLayout,
    keyboardWrapperStyle,
    listSpacerStyle,
    messageInputRef,
    prepareContextMenuKeyboardPreservation,
    resetConversationKeyboard,
    restoreComposerAfterContextMenu,
  }
}
