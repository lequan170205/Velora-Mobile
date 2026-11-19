import { MaterialIcons } from '@expo/vector-icons'
import { BlurView } from 'expo-blur'
import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import React, { memo, useCallback, useImperativeHandle, useRef, useState } from 'react'
import {
  Alert,
  Keyboard,
  Linking,
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

import { colors, radius, typography } from '../../constants/theme'
import { useReelDetail } from '../../hooks/useReels'
import {
  BOT_IMAGE_PICK_QUALITY,
  getResolvedMediaPosterUri,
  getResolvedMediaUri,
  MAX_CHAT_IMAGE_CAPTION_LENGTH,
  resolveAllowedChatImageType,
} from '../../lib/chatMedia'
import {
  getPreferredReelReplyPreviewContent,
  isReplyPreviewRecalled,
  normalizeReplyPreviewContent,
  RECALLED_PREVIEW_TEXT,
} from '../../lib/replyPreview'
import { useAuthStore } from '../../stores/authStore'

import {
  AttachmentLauncherSheet,
  type AttachmentLauncherSheetHandle,
} from './AttachmentLauncherSheet'
import { getReelThumbnailCacheKey } from './ChatReelCard'
import { ComposerSendButton } from './ComposerSendButton'

import type { Message, ReplyPreviewData } from '../../types/conversation.types'
import type { ImagePickerAsset } from 'expo-image-picker'
import type { SharedValue } from 'react-native-reanimated'

interface MessageInputProps {
  onSend: (text: string, replyTo?: Message | null) => void
  onSendMedia?: (assets: ImagePickerAsset[], options?: { caption?: string }) => void | Promise<void>
  /** In a chat with Velora AI a picked photo waits above the text field for a caption, then sends as one message. */
  captionMedia?: boolean
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
  icon: React.ComponentProps<typeof MaterialIcons>['name']
  onPress: () => void
  disabled?: boolean
}

const BRAND = colors.brand.primary
const TEXT_PRIMARY = colors.text.primary
const TEXT_SECONDARY = colors.text.secondary
const TEXT_MUTED = colors.text.tertiary
const ACCESSORY_SLOT_WIDTH = 38
const VIDEO_FILE_URI_PATTERN = /\.(mp4|m4v|mov|webm)(?:[?#].*)?$/i

const getComposerReplyThumbnailUri = (
  replyTo?: Message | null,
  replyPreviewData?: ReplyPreviewData | null,
) => {
  if (isReplyPreviewRecalled({ replyPreview: replyPreviewData ?? undefined, replyTo })) {
    return null
  }

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

  if (replyPreviewData?.type === 'reel') {
    return previewThumbnailUri || replyTo?.media?.thumbnailUrl || null
  }

  if (replyTo?.type === 'video') {
    return getResolvedMediaPosterUri(replyTo.media) ?? null
  }

  if (replyTo?.type === 'image') {
    return getResolvedMediaUri(replyTo.media) ?? null
  }

  if (replyTo?.type === 'reel') {
    return replyTo.media?.thumbnailUrl ?? null
  }

  return null
}

const getReplySenderLabel = ({
  currentUserId,
  replyPreviewData,
  replyTo,
}: {
  currentUserId: string | null
  replyPreviewData: ReplyPreviewData | null
  replyTo: Message | null | undefined
}) => {
  if (replyPreviewData) {
    if (currentUserId && replyPreviewData.senderId === currentUserId) {
      return 'You'
    }

    return replyPreviewData.senderName?.trim() || 'Replying to'
  }

  if (currentUserId && replyTo?.senderId === currentUserId) {
    return 'You'
  }

  return replyTo?.sender?.email?.split('@')[0] || 'Replying to'
}

const ComposerIconButton = memo(function ComposerIconButton({
  accessibilityLabel,
  icon,
  onPress,
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
            width: 38,
            height: 38,
            borderRadius: 19,
            alignItems: 'center',
            justifyContent: 'center',
          },
          animatedStyle,
        ]}
      >
        <MaterialIcons name={icon} size={23} color={TEXT_SECONDARY} />
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
  onSend: () => void
}

const ComposerAccessorySlot = memo(function ComposerAccessorySlot({
  hasText,
  hasTextProgress,
  onAttach,
  onSend,
}: ComposerAccessorySlotProps) {
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
      // When progress=0 the button is invisible, so scale=0 is correct
      { scale: progress.value },
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
          accessibilityLabel="Open attachment options"
          icon="image"
          onPress={onAttach}
        />
      </Animated.View>

      <Animated.View
        pointerEvents={hasText ? 'auto' : 'none'}
        style={[{ position: 'absolute', right: 0 }, sendStyle]}
      >
        <ComposerSendButton
          accessibilityLabel="Send message"
          disabled={!hasText}
          onPress={onSend}
        />
      </Animated.View>
    </Animated.View>
  )
})

const MessageInputComponent = function MessageInput(
  {
    onSend,
    onSendMedia,
    captionMedia = false,
    onChangeText,
    onFocusChange,
    replyTo,
    onCancelReply,
  }: MessageInputProps,
  ref: React.ForwardedRef<MessageInputHandle>,
) {
  const [text, setText] = useState('')
  // Separate boolean state for hasText — only flips when empty→nonempty or vice versa.
  // This prevents ComposerAccessorySlot from re-rendering on every keystroke.
  // Also true while a photo waits to be sent, so the send button shows for a photo without a caption.
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
  const [pendingPhoto, setPendingPhoto] = useState<ImagePickerAsset | null>(null)
  const pendingPhotoRef = useRef<ImagePickerAsset | null>(null)

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
    const photo = pendingPhotoRef.current
    if ((!message && !photo) || sendLockRef.current) return

    sendLockRef.current = true
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (photo) {
      // The text field holds the photo's caption; an empty one sends the photo alone.
      pendingPhotoRef.current = null
      setPendingPhoto(null)
      void onSendMedia?.([photo], message ? { caption: message } : undefined)
    } else {
      onSend(message, replyTo ?? null)
    }
    textRef.current = ''
    setText('')
    setHasText(false)
    hasTextProgress.value = 0
    onChangeText?.('')
    if (!photo) onCancelReply?.()

    requestAnimationFrame(() => inputRef.current?.focus())
    setTimeout(() => {
      sendLockRef.current = false
    }, 300)
  }, [hasTextProgress, onCancelReply, onChangeText, onSend, onSendMedia, replyTo])
  // ↑ `text` is intentionally excluded — we read from textRef instead.

  const handleTextChange = useCallback(
    (value: string) => {
      textRef.current = value
      setText(value)
      onChangeText?.(value)

      // Only flip the boolean state (and trigger slot re-render) when the
      // has-text status actually changes — not on every keystroke.
      const next = value.trim().length > 0 || pendingPhotoRef.current !== null
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

  const attachPhoto = useCallback(
    (photo: ImagePickerAsset) => {
      pendingPhotoRef.current = photo
      setPendingPhoto(photo)
      setHasText(true)
      hasTextProgress.value = 1
      // The caption is typed in the normal text field, so bring the keyboard up for it.
      requestAnimationFrame(() => inputRef.current?.focus())
    },
    [hasTextProgress],
  )

  const handleRemovePhoto = useCallback(() => {
    pendingPhotoRef.current = null
    setPendingPhoto(null)
    const stillHasText = textRef.current.trim().length > 0
    setHasText(stillHasText)
    hasTextProgress.value = stillHasText ? 1 : 0
  }, [hasTextProgress])

  // With Velora AI the photo waits above the text field for its caption; anywhere else it is sent straight away.
  const deliverPickedAssets = useCallback(
    async (assets: ImagePickerAsset[]) => {
      if (!captionMedia) {
        await onSendMedia?.(assets)
        return
      }

      const photo = assets.find((asset) => asset.type !== 'video')
      if (photo) {
        // Chat photos are JPEG, PNG or WebP; anything else (a RAW camera file) would fail to upload.
        const knownType = Boolean(photo.mimeType || photo.fileName)
        if (knownType && !resolveAllowedChatImageType(photo.mimeType, photo.fileName)) {
          Alert.alert('Unsupported photo', 'Choose a JPEG, PNG or WebP photo.')
          return
        }
        attachPhoto(photo)
      }
    },
    [attachPhoto, captionMedia, onSendMedia],
  )

  const handleOpenCamera = useCallback(async () => {
    const wasFocused = inputRef.current?.isFocused() ?? false
    inputRef.current?.blur()
    if (wasFocused) await waitForKeyboardToHide()

    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (permission.status !== 'granted') {
      Alert.alert('Permission denied', 'Velora needs camera access to take a photo.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => void Linking.openSettings() },
      ])
      return
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      cameraType: ImagePicker.CameraType.back,
      quality: captionMedia ? BOT_IMAGE_PICK_QUALITY : 0.92,
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    })

    if (!result.canceled) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
      await deliverPickedAssets(result.assets)
    }
  }, [captionMedia, deliverPickedAssets, waitForKeyboardToHide])

  const showCharCounter = text.length > 800
  const counterColor = text.length > 950 ? colors.status.error : TEXT_MUTED
  const currentUserId = useAuthStore((state) => state.user?.id ?? null)
  const replyPreviewData =
    replyTo?.replyPreview && typeof replyTo.replyPreview !== 'string'
      ? (replyTo.replyPreview as ReplyPreviewData)
      : null
  const isReplyRecalled = isReplyPreviewRecalled({
    replyPreview: replyTo?.replyPreview,
    replyTo,
  })
  const replyPreviewText = isReplyRecalled
    ? RECALLED_PREVIEW_TEXT
    : replyPreviewData?.type === 'reel' || replyTo?.type === 'reel'
      ? getPreferredReelReplyPreviewContent({
          content: replyPreviewData?.content,
          reelTitle: replyTo?.media?.reelTitle,
        })
      : typeof replyTo?.replyPreview === 'string'
        ? normalizeReplyPreviewContent(replyTo.replyPreview)
        : replyPreviewData
          ? normalizeReplyPreviewContent(replyPreviewData.content)
          : normalizeReplyPreviewContent(replyTo?.content)
  const replySenderLabel = getReplySenderLabel({ currentUserId, replyPreviewData, replyTo })
  const replyThumbnailUri = getComposerReplyThumbnailUri(replyTo, replyPreviewData)
  const isReplyVideo =
    !isReplyRecalled &&
    (replyPreviewData?.type === 'video' ||
      replyPreviewData?.type === 'reel' ||
      replyTo?.type === 'video' ||
      replyTo?.type === 'reel')
  const isReplyReel = replyPreviewData?.type === 'reel' || replyTo?.type === 'reel'
  // The message's thumbnail URL is signed and can expire; the reel's own detail (usually already
  // cached by the chat card) supplies a current one so the preview is not a black tile.
  const replyReelId = replyTo?.media?.reelId?.trim() || null
  const [failedReplyThumbnails, setFailedReplyThumbnails] = useState<string[]>([])
  const { data: replyReelDetail } = useReelDetail(replyReelId ?? undefined, {
    enabled:
      isReplyReel &&
      Boolean(replyReelId) &&
      (!replyThumbnailUri || failedReplyThumbnails.includes(replyThumbnailUri)),
  })
  const replyThumbnail =
    [
      { uri: replyThumbnailUri, key: replyTo?.media?.thumbnailKey },
      { uri: replyReelDetail?.thumbnailUrl, key: replyReelDetail?.thumbnailKey },
    ].find(
      (candidate): candidate is { uri: string; key: string | undefined } =>
        Boolean(candidate.uri) && !failedReplyThumbnails.includes(candidate.uri ?? ''),
    ) ?? null
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
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: dynamicPadding.value,
  }))

  return (
    <Animated.View style={containerStyle}>
      {/* Full-bleed light frost, deliberately borderless: no hairline, no
          enclosing card — the composer just sits on translucent glass while
          messages scroll beneath it. */}
      <BlurView intensity={28} tint="light" pointerEvents="none" style={StyleSheet.absoluteFill} />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg.frost }]}
      />
      {replyTo ? (
        <Animated.View
          entering={FadeInDown.duration(170).withInitialValues({
            opacity: 0,
            transform: [{ translateY: 7 }],
          })}
          exiting={FadeOut.duration(110)}
          style={styles.replyCard}
        >
          <View style={styles.replyAccent} />

          {replyThumbnail ? (
            <View
              style={[
                styles.replyThumb,
                isReplyReel ? styles.replyThumbReel : null,
                { backgroundColor: isReplyVideo ? colors.media.surface : colors.surface.accent },
              ]}
            >
              <Image
                source={{
                  uri: replyThumbnail.uri,
                  cacheKey: isReplyReel
                    ? getReelThumbnailCacheKey(replyReelId, replyThumbnail.key, replyThumbnail.uri)
                    : `reply-thumbnail:${replyThumbnail.uri.split('?')[0]}`,
                }}
                cachePolicy="memory-disk"
                contentFit="cover"
                onError={() => {
                  const failedUri = replyThumbnail.uri
                  setFailedReplyThumbnails((current) =>
                    current.includes(failedUri) ? current : [...current, failedUri],
                  )
                }}
                style={StyleSheet.absoluteFill}
              />
              {isReplyVideo ? (
                <View pointerEvents="none" style={styles.replyThumbOverlay}>
                  <MaterialIcons name="play-arrow" size={16} color={colors.text.inverse} />
                </View>
              ) : null}
            </View>
          ) : isReplyReel ? (
            <View
              style={[
                styles.replyThumb,
                styles.replyThumbReel,
                styles.replyThumbOverlay,
                { backgroundColor: colors.media.surface },
              ]}
            >
              <MaterialIcons name="play-arrow" size={18} color={colors.text.inverse} />
            </View>
          ) : null}

          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
              <MaterialIcons name="reply" size={14} color={BRAND} style={{ marginRight: 4 }} />
              <Text
                style={{
                  flexShrink: 1,
                  fontSize: 12,
                  fontFamily: typography.fonts.bodyBold,
                  color: BRAND,
                }}
                numberOfLines={1}
              >
                {replySenderLabel}
              </Text>
            </View>
            <Text
              style={{
                fontFamily: typography.fonts.body,
                fontSize: typography.sizes.sm,
                color: TEXT_SECONDARY,
                lineHeight: 17,
              }}
              numberOfLines={1}
            >
              {replyPreviewText}
            </Text>
          </View>

          <Pressable
            accessibilityLabel="Cancel reply"
            accessibilityRole="button"
            onPress={onCancelReply}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={({ pressed }) => ({
              width: 24,
              height: 24,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? colors.border.strong : colors.surface.accent,
              marginLeft: 8,
            })}
          >
            <MaterialIcons name="close" size={16} color={TEXT_SECONDARY} />
          </Pressable>
        </Animated.View>
      ) : null}

      {pendingPhoto ? (
        <Animated.View
          entering={FadeInDown.duration(170)}
          exiting={FadeOut.duration(110)}
          style={styles.photoPreviewRow}
        >
          <View style={styles.photoPreviewFrame}>
            <Image
              source={{ uri: pendingPhoto.uri }}
              contentFit="cover"
              accessibilityLabel="Photo to send"
              style={styles.photoPreviewImage}
            />
            <Pressable
              accessibilityLabel="Remove photo"
              accessibilityRole="button"
              onPress={handleRemovePhoto}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.photoPreviewRemove}
            >
              <MaterialIcons name="close" size={16} color={colors.text.inverse} />
            </Pressable>
          </View>
        </Animated.View>
      ) : null}

      <Animated.View
        style={[
          styles.composerPill,
          {
            minHeight: 48,
            maxHeight: 116,
            flexDirection: 'row',
            alignItems: 'flex-end',
            paddingHorizontal: 4,
            paddingVertical: 4,
          },
        ]}
      >
        <ComposerIconButton
          accessibilityLabel="Open camera"
          icon="photo-camera"
          onPress={() => {
            void handleOpenCamera()
          }}
        />

        <View style={{ flex: 1, minHeight: 40, justifyContent: 'center' }}>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={handleTextChange}
            placeholder={pendingPhoto ? 'Add a caption…' : 'Message'}
            placeholderTextColor={TEXT_MUTED}
            multiline
            scrollEnabled
            maxLength={pendingPhoto ? MAX_CHAT_IMAGE_CAPTION_LENGTH : 1000}
            onBlur={() => {
              onFocusChange?.(false)
            }}
            onFocus={() => {
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
                fontSize: typography.sizes.xs,
                fontFamily: typography.fonts.bodyMedium,
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
          onSend={handleSend}
        />
      </Animated.View>

      <AttachmentLauncherSheet
        ref={attachmentSheetRef}
        singleCompressedImage={captionMedia}
        onSelectAssets={deliverPickedAssets}
      />
    </Animated.View>
  )
}

export const MessageInput = memo(React.forwardRef(MessageInputComponent))

// Static styles extracted from render to avoid new object allocations per frame.
const styles = StyleSheet.create({
  composerPill: {
    backgroundColor: colors.surface.cream,
    borderRadius: radius.xl,
  },
  photoPreviewFrame: {
    height: 96,
    width: 96,
  },
  photoPreviewImage: {
    backgroundColor: colors.border.default,
    borderRadius: radius.lg,
    height: 96,
    width: 96,
  },
  photoPreviewRemove: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: 12,
    height: 24,
    justifyContent: 'center',
    position: 'absolute',
    right: -6,
    top: -6,
    width: 24,
  },
  photoPreviewRow: {
    alignItems: 'flex-start',
    marginBottom: 8,
    paddingLeft: 4,
  },
  replyAccent: {
    alignSelf: 'stretch',
    backgroundColor: BRAND,
    borderRadius: 2,
    marginRight: 10,
    width: 3,
  },
  replyCard: {
    alignItems: 'center',
    backgroundColor: colors.surface.cream,
    borderRadius: radius.xl,
    flexDirection: 'row',
    marginBottom: 6,
    overflow: 'hidden',
    paddingLeft: 12,
    paddingRight: 10,
    paddingVertical: 8,
  },
  replyThumb: {
    borderRadius: 10,
    height: 36,
    marginRight: 10,
    overflow: 'hidden',
    width: 36,
  },
  replyThumbOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.18)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  replyThumbReel: {
    borderRadius: 12,
    height: 48,
    width: 36,
  },
  textInput: {
    color: TEXT_PRIMARY,
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.md,
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
