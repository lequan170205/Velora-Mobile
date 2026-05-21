import { Ionicons } from '@expo/vector-icons'
import { BlurView } from 'expo-blur'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import React, {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Alert,
  Keyboard,
  PanResponder,
  Platform,
  Pressable,
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
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  AttachmentLauncherSheet,
  type AttachmentLauncherSheetHandle,
} from './AttachmentLauncherSheet'

import type { Message, ReplyPreviewData } from '../../types/conversation.types'
import type { ImagePickerAsset } from 'expo-image-picker'

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
  hasText: boolean
  onAttach: () => void
  onMic: () => void
  onSend: () => void
}

const ComposerAccessorySlot = memo(function ComposerAccessorySlot({
  hasText,
  onAttach,
  onMic,
  onSend,
}: ComposerAccessorySlotProps) {
  const progress = useSharedValue(hasText ? 1 : 0)
  const sendPressScale = useSharedValue(1)

  useEffect(() => {
    progress.value = hasText
      ? withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) })
      : withTiming(0, { duration: 160, easing: Easing.inOut(Easing.quad) })
  }, [hasText, progress])

  const slotStyle = useAnimatedStyle(() => ({
    width: interpolate(progress.value, [0, 1], [118, 40], Extrapolation.CLAMP),
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
    const message = text.trim()
    if (!message || sendLockRef.current) return

    sendLockRef.current = true
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onSend(message, replyTo?.id)
    setText('')
    onChangeText?.('')
    onCancelReply?.()

    requestAnimationFrame(() => inputRef.current?.focus())
    setTimeout(() => {
      sendLockRef.current = false
    }, 300)
  }, [onCancelReply, onChangeText, onSend, replyTo?.id, text])

  const handleTextChange = useCallback(
    (value: string) => {
      setText(value)
      onChangeText?.(value)
    },
    [onChangeText],
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

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gestureState) =>
          gestureState.dy > 10 && gestureState.vy > 0.5,
        onPanResponderRelease: (_event, gestureState) => {
          if (gestureState.dy > 10 && gestureState.vy > 0.5) {
            Keyboard.dismiss()
          }
        },
      }),
    [],
  )

  const hasText = text.trim().length > 0
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
  const bottomInset = Math.max(insets.bottom, 8)
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation()
  const ACTIVE_PADDING = 8 // The tight spacing you want when focused

  const containerStyle = useAnimatedStyle(() => {
    const dynamicPadding = interpolate(
      Math.abs(keyboardHeight.value),
      [0, 40], // Threshold: animates over the first 40px of keyboard movement
      [bottomInset, ACTIVE_PADDING],
      Extrapolation.CLAMP,
    )
    return {
      marginTop: -14,
      paddingTop: 14,
      paddingHorizontal: 10,
      paddingBottom: dynamicPadding,
    }
  })

  const bgCoverStyle = useAnimatedStyle(() => {
    const dynamicPadding = interpolate(
      Math.abs(keyboardHeight.value),
      [0, 40],
      [bottomInset, ACTIVE_PADDING],
      Extrapolation.CLAMP,
    )
    return { height: dynamicPadding }
  })

  const cornerCoverStyle = useAnimatedStyle(() => {
    const dynamicPadding = interpolate(
      Math.abs(keyboardHeight.value),
      [0, 40],
      [bottomInset, ACTIVE_PADDING],
      Extrapolation.CLAMP,
    )
    return { bottom: dynamicPadding }
  })
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
              style={{
                minHeight: 38,
                maxHeight: 108,
                paddingTop: 8,
                paddingBottom: showCharCounter ? 18 : 8,
                paddingHorizontal: 10,
                color: TEXT_PRIMARY,
                fontSize: 16,
                lineHeight: 21,
              }}
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
