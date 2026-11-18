import { Image } from 'expo-image'
import React, { useEffect, useState } from 'react'
import {
  Dimensions,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { colors, radius, typography } from '../../constants/theme'
import { MAX_CHAT_IMAGE_CAPTION_LENGTH } from '../../lib/chatMedia'

import type { ImagePickerAsset } from 'expo-image-picker'

interface ImageCaptionSheetProps {
  /** The photo waiting for its caption; null keeps the sheet closed. */
  asset: ImagePickerAsset | null
  onCancel: () => void
  onSend: (caption: string) => void
}

const PREVIEW_MAX_HEIGHT = 320
// Keeps the caption box and Send in view on a short screen with the keyboard open.
const PREVIEW_MAX_HEIGHT_WITH_KEYBOARD = 180

/**
 * Preview of a photo about to go to Velora AI, with a caption box. The photo and the question
 * travel as one message, so the AI answers once with both in hand.
 */
export function ImageCaptionSheet({ asset, onCancel, onSend }: ImageCaptionSheetProps) {
  const insets = useSafeAreaInsets()
  const [caption, setCaption] = useState('')
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  useEffect(() => {
    setCaption('')
  }, [asset?.uri])

  // A Modal is its own window, so neither KeyboardAvoidingView nor the app's keyboard provider
  // lifts it on Android: the sheet lifts itself by the keyboard's real height.
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvent, (event) => {
      // The space the keyboard covers is measured from its top edge to the bottom of the screen: its
      // reported height leaves out the navigation bar, which this full-screen modal also sits under.
      const covered = Dimensions.get('screen').height - event.endCoordinates.screenY
      setKeyboardHeight(
        Number.isFinite(covered) && covered > 0 ? covered : event.endCoordinates.height,
      )
    })
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0))

    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  if (!asset) {
    return null
  }

  const aspectRatio =
    asset.width && asset.height && asset.width > 0 && asset.height > 0
      ? Math.min(Math.max(asset.width / asset.height, 0.6), 1.8)
      : 1

  return (
    <Modal animationType="slide" onRequestClose={onCancel} statusBarTranslucent transparent visible>
      <View style={styles.scrim}>
        <Pressable
          accessibilityLabel="Close photo preview"
          accessibilityRole="button"
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            styles.sheet,
            {
              paddingBottom:
                keyboardHeight > 0 ? keyboardHeight + 12 : Math.max(insets.bottom, 12) + 4,
            },
          ]}
        >
          <Image
            accessibilityLabel="Photo to send to Velora AI"
            contentFit="cover"
            source={{ uri: asset.uri }}
            style={[
              styles.preview,
              {
                aspectRatio,
                maxHeight:
                  keyboardHeight > 0 ? PREVIEW_MAX_HEIGHT_WITH_KEYBOARD : PREVIEW_MAX_HEIGHT,
              },
            ]}
          />
          <TextInput
            accessibilityLabel="Caption for the photo"
            autoFocus
            maxLength={MAX_CHAT_IMAGE_CAPTION_LENGTH}
            multiline
            onChangeText={setCaption}
            placeholder="Ask about this photo, e.g. find reels like it"
            placeholderTextColor={colors.text.tertiary}
            style={styles.input}
            value={caption}
          />
          <View style={styles.actions}>
            <Pressable
              accessibilityLabel="Cancel"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onCancel}
              style={styles.cancel}
            >
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Send photo to Velora AI"
              accessibilityRole="button"
              onPress={() => onSend(caption.trim())}
              style={styles.send}
            >
              <Text style={styles.sendLabel}>Send</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cancel: {
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 8,
  },
  cancelLabel: {
    color: colors.text.secondary,
    fontFamily: typography.fonts.bodySemibold,
    fontSize: typography.sizes.base,
  },
  input: {
    backgroundColor: colors.surface.cream,
    borderRadius: radius.xl,
    color: colors.text.primary,
    fontFamily: typography.fonts.body,
    fontSize: typography.sizes.base,
    maxHeight: 112,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  preview: {
    alignSelf: 'center',
    backgroundColor: colors.bg.secondary,
    borderRadius: 18,
    width: '100%',
  },
  scrim: {
    backgroundColor: 'rgba(17,17,17,0.45)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  send: {
    alignItems: 'center',
    backgroundColor: colors.brand.primary,
    borderRadius: radius.full,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 28,
  },
  sendLabel: {
    color: colors.text.inverse,
    fontFamily: typography.fonts.bodySemibold,
    fontSize: typography.sizes.base,
  },
  sheet: {
    backgroundColor: colors.bg.primary,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
})
