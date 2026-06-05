import { Ionicons } from '@expo/vector-icons'
import { BlurView } from 'expo-blur'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import React, { memo, useCallback, useImperativeHandle, useRef, useState } from 'react'
import {
  Alert,
  Image,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import Animated, {
  Easing,
  Extrapolation,
  FadeInDown,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { getResolvedMediaPosterUri, getResolvedMediaUri } from '../../lib/chatMedia'

import {
  AttachmentLauncherSheet,
  type AttachmentLauncherSheetHandle,
} from './AttachmentLauncherSheet'

import type { Message, ReplyPreviewData } from '../../types/conversation.types'
import type { ImagePickerAsset } from 'expo-image-picker'
import type { SharedValue } from 'react-native-reanimated'

interface MessageInputProps {
  onSend: (text: string, replyToId?: string) => void
  onSendMedia?: (assets: ImagePickerAsset[]) => void | Promise<void>
  onChangeText?: (text: string) => void
  onFocusChange?: (focused: boolean) => void
  replyTo?: Message | null
  onCancelReply?: () => void
}

export interface MessageInputHandle {
  blur: () => void
  focus: () => void
}

interface ComposerIconButtonProps {
  accessibilityLabel: string
  icon: React.ComponentProps<typeof Ionicons>['name']
  onPress: () => void
  accent?: boolean
  disabled?: boolean
}

const BRAND = '#FF6B2C'
const BRAND_DARK = '#D85A21'
const TEXT_PRIMARY = '#161616'
const TEXT_MUTED = '#A6A6A6'
const ACCESSORY_SLOT_WIDTH = 164
const VIDEO_FILE_URI_PATTERN = /\.(mp4|m4v|mov|webm)(?:[?#].*)?$/i

const getComposerReplyThumbnailUri = (
  replyTo?: Message | null,
  replyPreviewData?: ReplyPreviewData | null,
) => {
  const previewThumbnailUri = replyPreviewData?.thumbnailUri?.trim()

  if (replyPreviewData?.type === 'video') {
    if (previewThumbnailUri && !VIDEO_FILE_URI_PATTERN.test(previewThumbnailUri)) {
      return previewThumbnailUri
    }

    return getResolvedMediaPosterUri(replyTo?.media) ?? null
  }

  if (replyPreviewData?.type === 'image') {
    return previewThumbnailUri || getResolvedMediaUri(replyTo?.media) || null
  }

  if (replyTo?.type === 'video') {
    return getResolvedMediaPosterUri(replyTo.media) ?? null
  }

  if (replyTo?.type === 'image') {
    return getResolvedMediaUri(replyTo.media) ?? null
  }

  return null
}

const ComposerIconButton = memo(function ComposerIconButton({
  accessibilityLabel,
  icon,
  onPress,
  accent = false,
  disabled = false,
}: ComposerIconButtonProps) {
  const scale = useSharedValue(1)

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={8}
      onPress={() => {
        void Haptics.selectionAsync()
        onPress()
      }}
      onPressIn={() => {
        scale.value = withTiming(0.9, { duration: 80 })
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 18, stiffness: 360 })
      }}
      style={{ opacity: disabled ? 0.4 : 1 }}
    >
      <Animated.View
        style={[
          {
            width: accent ? 40 : 38,
            height: accent ? 40 : 38,
            borderRadius: accent ? 20 : 21,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: accent ? BRAND : 'transparent',
          },
          animatedStyle,
        ]}
      >
        <Ionicons name={icon} size={accent ? 22 : 28} color={accent ? '#FFFFFF' : '#777777'} />
      </Animated.View>
    </Pressable>
  )
})

interface ComposerAccessorySlotProps {
  // Boolean for React pointerEvents (JS-side only, not animation)
  hasText: boolean
  // SharedValue drives the animation entirely on the UI thread — no JS re-renders on keystrokes
  hasTextProgress: SharedValue<number>
  onAttach: () => void
  onMic: () => void
  onSend: () => void
}

const ComposerAccessorySlot = memo(function ComposerAccessorySlot({
  hasText,
  hasTextProgress,
  onAttach,
  onMic,
  onSend,
}: ComposerAccessorySlotProps) {
  const sendPressScale = useSharedValue(1)

  // useDerivedValue runs entirely on the UI thread — no useEffect, no JS→UI bridge round-trip.
  // The easing is evaluated on the UI thread when hasTextProgress changes.
  const progress = useDerivedValue(() =>
    withTiming(hasTextProgress.value, {
      duration: 160,
      easing: hasTextProgress.value > 0 ? Easing.out(Easing.cubic) : Easing.inOut(Easing.quad),
    }),
  )

  const slotStyle = useAnimatedStyle(() => ({
    width: interpolate(progress.value, [0, 1], [ACCESSORY_SLOT_WIDTH, 40], Extrapolation.CLAMP),
  }))

  const accessoryStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [0, 8]) },
      { scale: interpolate(progress.value, [0, 1], [1, 0.94]) },
    ],
  }))

  const sendStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [8, 0]) },
      // Combine progress + press scale; when progress=0 button is invisible so scale=0 is correct
      { scale: progress.value * sendPressScale.value },
    ],
  }))

  return (
    <Animated.View
      style={[
        {
          height: 40,
          justifyContent: 'center',
          overflow: 'hidden',
        },
        slotStyle,
      ]}
    >
      <Animated.View
        pointerEvents={hasText ? 'none' : 'auto'}
        style={[
          {
            position: 'absolute',
            right: 0,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
          },
          accessoryStyle,
        ]}
      >
        <ComposerIconButton
          accessibilityLabel="Record voice message"
          icon="mic-outline"
          onPress={onMic}
        />
        <ComposerIconButton
          accessibilityLabel="Open attachment options"
          icon="image-outline"
          onPress={onAttach}
        />
        <ComposerIconButton
          accessibilityLabel="Open emoji picker"
          icon="happy-outline"
          onPress={() => {
            /* emoji picker placeholder */
          }}
        />
        <ComposerIconButton
          accessibilityLabel="Open more attachment options"
          icon="add-circle-outline"
          onPress={onAttach}
        />
      </Animated.View>

      <Animated.View
        pointerEvents={hasText ? 'auto' : 'none'}
        style={[{ position: 'absolute', right: 0 }, sendStyle]}
      >
        <Pressable
          accessibilityLabel="Send message"
          accessibilityRole="button"
          disabled={!hasText}
          hitSlop={8}
          onPress={onSend}
          onPressIn={() => {
            sendPressScale.value = withTiming(0.88, { duration: 70 })
          }}
          onPressOut={() => {
            sendPressScale.value = withSpring(1, { damping: 15, stiffness: 380 })
          }}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: BRAND,
          }}
        >
          <Ionicons name="send" size={18} color="#FFFFFF" style={{ marginLeft: 2 }} />
        </Pressable>
      </Animated.View>
    </Animated.View>
  )
})

const MessageInputComponent = function MessageInput(
  { onSend, onSendMedia, onChangeText, onFocusChange, replyTo, onCancelReply }: MessageInputProps,
  ref: React.ForwardedRef<MessageInputHandle>,
) {
  const [text, setText] = useState('')
  // Separate boolean state for hasText — only flips when empty→nonempty or vice versa.
  // This prevents ComposerAccessorySlot from re-rendering on every keystroke.
  const [hasText, setHasText] = useState(false)
  // textRef lets handleSend read the latest text without being listed as a dependency,
  // keeping the callback stable across keystrokes.
  const textRef = useRef('')
  // Shared value drives the slot animation directly on the UI thread.
  const hasTextProgress = useSharedValue(0)
  const insets = useSafeAreaInsets()
  const inputRef = useRef<TextInput>(null)
  const attachmentSheetRef = useRef<AttachmentLauncherSheetHandle>(null)
  const sendLockRef = useRef(false)
  const inputFocusProgress = useSharedValue(0)

  useImperativeHandle(
    ref,
    () => ({
      blur: () => inputRef.current?.blur(),
      focus: () => inputRef.current?.focus(),
    }),
    [],
  )

  const handleSend = useCallback(() => {
    // Read from ref — no dependency on `text` state, so this callback is stable
    // across keystrokes and won't cause ComposerAccessorySlot to re-render.
    const message = textRef.current.trim()
    if (!message || sendLockRef.current) return

    sendLockRef.current = true
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onSend(message, replyTo?.id)
    textRef.current = ''
    setText('')
    setHasText(false)
    hasTextProgress.value = 0
    onChangeText?.('')
    onCancelReply?.()

    requestAnimationFrame(() => inputRef.current?.focus())
    setTimeout(() => {
      sendLockRef.current = false
    }, 300)
  }, [hasTextProgress, onCancelReply, onChangeText, onSend, replyTo?.id])
  // ↑ `text` is intentionally excluded — we read from textRef instead.

  const handleTextChange = useCallback(
    (value: string) => {
      textRef.current = value
      setText(value)
      onChangeText?.(value)

      // Only flip the boolean state (and trigger slot re-render) when the
      // has-text status actually changes — not on every keystroke.
      const next = value.trim().length > 0
      setHasText((prev) => {
        if (prev !== next) {
          hasTextProgress.value = next ? 1 : 0
          return next
        }
        return prev
      })
    },
    [hasTextProgress, onChangeText],
  )

  const handleMicPress = useCallback(() => {
    // eslint-disable-next-line no-console
    console.log('Voice message placeholder')
  }, [])

  const waitForKeyboardToHide = useCallback(() => {
    return new Promise<void>((resolve) => {
      let settled = false
      const subscriptions = [
        Keyboard.addListener('keyboardDidHide', finish),
        ...(Platform.OS === 'ios' ? [Keyboard.addListener('keyboardWillHide', finish)] : []),
      ]
      const timeoutId = setTimeout(finish, 220)

      function finish() {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        subscriptions.forEach((subscription) => subscription.remove())
        resolve()
      }

      Keyboard.dismiss()
    })
  }, [])

  const handleOpenAttachmentLauncher = useCallback(async () => {
    const wasFocused = inputRef.current?.isFocused() ?? false
    inputRef.current?.blur()
    if (wasFocused) await waitForKeyboardToHide()
    attachmentSheetRef.current?.present()
  }, [waitForKeyboardToHide])

  const handleOpenCamera = useCallback(async () => {
    const wasFocused = inputRef.current?.isFocused() ?? false
    inputRef.current?.blur()
    if (wasFocused) await waitForKeyboardToHide()

    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (permission.status !== 'granted') {
      Alert.alert('Permission denied', 'Velora needs camera access to take a photo.')
      return
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      cameraType: ImagePicker.CameraType.back,
      quality: 0.92,
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    })

    if (!result.canceled) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
      await onSendMedia?.(result.assets)
    }
  }, [onSendMedia, waitForKeyboardToHide])

  const showCharCounter = text.length > 800
  const counterColor = text.length > 950 ? '#E11D48' : TEXT_MUTED
  const replyPreviewData =
    replyTo?.replyPreview && typeof replyTo.replyPreview !== 'string'
      ? (replyTo.replyPreview as ReplyPreviewData)
      : null
  const replyPreviewText =
    typeof replyTo?.replyPreview === 'string'
      ? replyTo.replyPreview
      : replyPreviewData
        ? replyPreviewData.content
        : replyTo?.content
  const replySenderLabel = replyPreviewData?.senderName ?? replyTo?.sender?.email ?? 'Replying to'
  const replyInitial = (replyPreviewText?.trim().charAt(0) || '?').toUpperCase()
  const replyThumbnailUri = getComposerReplyThumbnailUri(replyTo, replyPreviewData)
  const isReplyVideo = replyPreviewData?.type === 'video' || replyTo?.type === 'video'
  const bottomInset = Math.max(insets.bottom, 8)
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation()
  const ACTIVE_PADDING = 8 // The tight spacing you want when focused

  // Single derived value computed once on the UI thread — shared across all 3 animated styles
  // below so interpolate() is called once instead of three times per keyboard frame.
  const dynamicPadding = useDerivedValue(() =>
    interpolate(
      Math.abs(keyboardHeight.value),
      [0, 40],
      [bottomInset, ACTIVE_PADDING],
      Extrapolation.CLAMP,
    ),
  )

  const containerStyle = useAnimatedStyle(() => ({
    marginTop: -14,
    paddingTop: 14,
    paddingHorizontal: 10,
    paddingBottom: dynamicPadding.value,
  }))

  const bgCoverStyle = useAnimatedStyle(() => ({ height: dynamicPadding.value }))

  const cornerCoverStyle = useAnimatedStyle(() => ({ bottom: dynamicPadding.value }))
  // const inputPillStyle = useAnimatedStyle(() => ({
  //   borderColor: interpolateColor(
  //     inputFocusProgress.value,
  //     [0, 1],
  //     [BORDER_LIGHT, 'rgba(255,107,44,0.30)'],
  //   ),
  //   shadowOpacity: interpolate(inputFocusProgress.value, [0, 1], [0.03, 0.08]),
  //   shadowRadius: interpolate(inputFocusProgress.value, [0, 1], [5, 9]),
  // }))

  return (
    <Animated.View style={containerStyle}>
      <Animated.View
        pointerEvents="none"
        className="absolute left-0 right-0 bg-bg-primary"
        style={[{ bottom: 0 }, bgCoverStyle]}
      />
      <Animated.View
        pointerEvents="none"
        className="absolute bg-bg-primary"
        style={[{ left: 10, width: 24, height: 24 }, cornerCoverStyle]}
      />
      <Animated.View
        pointerEvents="none"
        className="absolute bg-bg-primary"
        style={[{ right: 10, width: 24, height: 24 }, cornerCoverStyle]}
      />

      {replyTo ? (
        <Animated.View
          entering={FadeInDown.duration(170).withInitialValues({
            opacity: 0,
            transform: [{ translateY: 7 }, { translateX: -8 }],
          })}
          exiting={FadeOut.duration(110)}
          className="mb-2 flex-row items-center rounded-[16px] bg-surface-input py-2.5"
          style={{
            paddingLeft: 12,
            paddingRight: 8,
            borderLeftWidth: 3,
            borderLeftColor: BRAND,
            overflow: 'hidden',
          }}
        >
          {replyThumbnailUri ? (
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                overflow: 'hidden',
                backgroundColor: isReplyVideo ? '#111111' : '#EFEFEF',
                marginRight: 10,
              }}
            >
              <Image
                source={{ uri: replyThumbnailUri }}
                resizeMode="cover"
                style={{ width: 36, height: 36 }}
              />
              {isReplyVideo ? (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: 0,
                    bottom: 0,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(0,0,0,0.18)',
                  }}
                >
                  <Ionicons name="play" size={16} color="#FFFFFF" />
                </View>
              ) : null}
            </View>
          ) : (
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#FF6B2C22',
                marginRight: 10,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: '800', color: BRAND_DARK }}>
                {replyInitial}
              </Text>
            </View>
          )}

          <View style={{ flex: 1 }}>
            <Text
              style={{ fontSize: 12, fontWeight: '700', color: BRAND_DARK, marginBottom: 2 }}
              numberOfLines={1}
            >
              {replySenderLabel}
            </Text>
            <Text style={{ fontSize: 13, color: '#777777', lineHeight: 17 }} numberOfLines={1}>
              {replyPreviewText}
            </Text>
          </View>

          <Pressable
            accessibilityLabel="Cancel reply"
            accessibilityRole="button"
            onPress={onCancelReply}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={({ pressed }) => ({
              width: 28,
              height: 28,
              borderRadius: 14,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? '#DDDAD6' : '#E8E4E0',
              marginLeft: 8,
            })}
          >
            <Ionicons name="close" size={20} color="#888888" />
          </Pressable>
        </Animated.View>
      ) : null}

      <BlurView
        intensity={42}
        tint="systemThinMaterialLight"
        experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : 'none'}
        blurReductionFactor={3}
        style={{
          borderRadius: 24,
          overflow: 'hidden',
          backgroundColor: 'rgba(245,245,245,0.58)',
        }}
      >
        <Animated.View
          style={{
            minHeight: 48,
            maxHeight: 116,
            borderRadius: 24,
            flexDirection: 'row',
            alignItems: 'flex-end',
            paddingLeft: 4,
            paddingRight: 4,
            paddingVertical: 4,
            overflow: 'hidden', // clips children to border radius — no white corners
          }}
        >
          <ComposerIconButton
            accessibilityLabel="Open camera"
            icon="camera"
            accent
            onPress={() => {
              void handleOpenCamera()
            }}
          />

          <View style={{ flex: 1, minHeight: 40, justifyContent: 'center' }}>
            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={handleTextChange}
              placeholder="Message..."
              placeholderTextColor={TEXT_MUTED}
              multiline
              scrollEnabled
              maxLength={1000}
              onBlur={() => {
                inputFocusProgress.value = withTiming(0, { duration: 170 })
                onFocusChange?.(false)
              }}
              onFocus={() => {
                inputFocusProgress.value = withTiming(1, { duration: 150 })
                onFocusChange?.(true)
              }}
              style={[
                styles.textInput,
                // paddingBottom only changes when counter appears (>800 chars), not every keystroke
                showCharCounter && styles.textInputWithCounter,
              ]}
            />

            {showCharCounter ? (
              <Text
                style={{
                  position: 'absolute',
                  left: 10,
                  bottom: 1,
                  fontSize: 10,
                  fontWeight: '500',
                  color: counterColor,
                }}
              >
                {text.length} / 1000
              </Text>
            ) : null}
          </View>

          <ComposerAccessorySlot
            hasText={hasText}
            hasTextProgress={hasTextProgress}
            onAttach={() => {
              void handleOpenAttachmentLauncher()
            }}
            onMic={handleMicPress}
            onSend={handleSend}
          />
        </Animated.View>
      </BlurView>

      <AttachmentLauncherSheet
        ref={attachmentSheetRef}
        onSelectAssets={async (assets) => {
          await onSendMedia?.(assets)
        }}
      />
    </Animated.View>
  )
}

export const MessageInput = memo(React.forwardRef(MessageInputComponent))

// Static styles extracted from render to avoid new object allocations per frame.
const styles = StyleSheet.create({
  textInput: {
    color: TEXT_PRIMARY,
    fontSize: 16,
    lineHeight: 21,
    maxHeight: 108,
    minHeight: 38,
    paddingBottom: 8,
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  textInputWithCounter: {
    paddingBottom: 18,
  },
})
