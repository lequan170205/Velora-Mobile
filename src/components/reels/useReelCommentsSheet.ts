import { useCallback, useEffect, useRef, useState } from 'react'
import { useWindowDimensions } from 'react-native'
import {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  COMMENTS_SHEET_RESTING_SNAP,
  COMMENTS_SHEET_TYPING_SNAP,
  type ReelCommentsSheetHandle,
} from './ReelCommentsSheet'

/**
 * Everything a reel needs to host the comments sheet, kept out of the (already huge) feed item:
 *
 * - `open()` is an imperative command, so a tap always presents the sheet no matter what the
 *   React state says. `isOpen` is only a mirror, reported by the sheet itself through
 *   `onOpenChange`, and is used to suppress competing gestures and chrome while it is up.
 * - `stageStyle` shrinks the video into the space above the sheet; `overlayStyle` fades the
 *   reel's own chrome (caption, actions, progress rail). Both follow the sheet's live position.
 *
 * Wire-up: spread `sheetProps` onto <ReelCommentsSheet>, call `open()` from triggers, apply the
 * two styles to the video stage / overlay chrome, and gate other reel gestures on `isOpen`.
 */
export function useReelCommentsSheet({
  height,
  isActive,
  resetKey,
  onOpenChange,
}: {
  height: number
  isActive: boolean
  resetKey: string | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
}) {
  const sheetRef = useRef<ReelCommentsSheetHandle>(null)
  const isOpenRef = useRef(false)
  const [isOpen, setIsOpen] = useState(false)
  const { height: windowHeight } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const position = useSharedValue(windowHeight)
  const active = useSharedValue(0)

  const handleOpenChange = useCallback((open: boolean) => {
    isOpenRef.current = open
    setIsOpen(open)
  }, [])
  const open = useCallback(() => sheetRef.current?.present(), [])
  const close = useCallback(() => {
    // Dismissing a sheet that was never presented leaves gorhom's modal in a stale state.
    if (isOpenRef.current) sheetRef.current?.dismiss()
  }, [])

  // A reel that stops being the active one, or a different signed-in user, never keeps it up.
  useEffect(() => {
    if (!isActive) close()
  }, [close, isActive])
  useEffect(() => {
    handleOpenChange(false)
  }, [handleOpenChange, resetKey])

  useEffect(() => {
    active.value = isOpen ? 1 : 0
    if (!isOpen) return
    onOpenChange?.(true)
    return () => onOpenChange?.(false)
  }, [active, isOpen, onOpenChange])

  const restingTop = windowHeight * (1 - COMMENTS_SHEET_RESTING_SNAP)
  const typingTop = windowHeight * (1 - COMMENTS_SHEET_TYPING_SNAP)
  const stageScale = Math.min(
    1,
    Math.max(0.3, (restingTop - insets.top - 16) / Math.max(height, 1)),
  )
  const stageShift = insets.top + 8 - height / 2 + (stageScale * height) / 2

  const stageStyle = useAnimatedStyle(() => {
    const progress =
      active.value *
      interpolate(position.value, [windowHeight, restingTop], [0, 1], Extrapolation.CLAMP)
    // Fade the reel out when the sheet rises past its resting point (keyboard open).
    const opacity = interpolate(
      position.value,
      [typingTop, restingTop],
      [0, 1],
      Extrapolation.CLAMP,
    )

    return {
      borderRadius: (16 / stageScale) * progress,
      opacity: active.value ? opacity : 1,
      transform: [
        { translateY: stageShift * progress },
        { scale: 1 + (stageScale - 1) * progress },
      ],
    }
  })
  const overlayStyle = useAnimatedStyle(() => {
    const progress =
      active.value *
      interpolate(position.value, [windowHeight, restingTop], [0, 1], Extrapolation.CLAMP)

    return { opacity: 1 - Math.min(1, progress * 1.8) }
  })

  return {
    isOpen,
    open,
    stageStyle,
    overlayStyle,
    sheetProps: { ref: sheetRef, animatedPosition: position, onOpenChange: handleOpenChange },
  }
}
