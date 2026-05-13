import { MaterialIcons } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import * as Haptics from 'expo-haptics'
import * as ImagePicker from 'expo-image-picker'
import React, { memo, useCallback, useState } from 'react'
import { Alert, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import Animated, {
  FadeInDown,
  FadeOut,
  LinearTransition,
  interpolate,
  useAnimatedStyle,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { Message, ReplyPreviewData } from '../../types/conversation.types'

interface MessageInputProps {
  onSend: (text: string, replyToId?: string) => void
  onSendMedia?: (uri: string, type: 'image' | 'file', fileInfo: unknown) => void
  onChangeText?: (text: string) => void
  replyTo?: Message | null
  onCancelReply?: () => void
}

const COMPOSER_LAYOUT = LinearTransition.springify().damping(18).stiffness(180)

const MessageInputComponent = function MessageInput({
  onSend,
  onSendMedia,
  onChangeText,
  replyTo,
  onCancelReply,
}: MessageInputProps) {
  const [text, setText] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const insets = useSafeAreaInsets()
  const { progress } = useReanimatedKeyboardAnimation()

  const containerStyle = useAnimatedStyle(
    () => ({
      paddingBottom: interpolate(progress.value, [0, 1], [Math.max(insets.bottom, 8), 8]),
    }),
    [insets.bottom, progress],
  )

  const handleSend = useCallback(() => {
    if (text.trim()) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      onSend(text.trim(), replyTo?.id)
      setText('')

      if (onCancelReply) {
        onCancelReply()
      }
    }
  }, [onCancelReply, onSend, replyTo?.id, text])

  const handleTextChange = (value: string) => {
    setText(value)

    if (onChangeText) {
      onChangeText(value)
    }
  }

  const handleAttachImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()

      if (status !== 'granted') {
        Alert.alert('Permission denied', 'App needs access to your photos.')
        return
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
      })

      if (!result.canceled && result.assets && result.assets.length > 0 && onSendMedia) {
        const asset = result.assets[0]
        onSendMedia(asset.uri, 'image', asset)
      }
    } catch (error) {
      console.error(error)
    }
  }

  const handleAttachFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      })

      if (!result.canceled && result.assets && result.assets.length > 0 && onSendMedia) {
        const file = result.assets[0]
        onSendMedia(file.uri, 'file', file)
      }
    } catch (error) {
      console.error(error)
    }
  }

  const hasText = text.trim().length > 0
  const replyPreviewText =
    typeof replyTo?.replyPreview === 'string'
      ? replyTo.replyPreview
      : replyTo?.replyPreview
        ? `${(replyTo.replyPreview as ReplyPreviewData).senderName}: ${(replyTo.replyPreview as ReplyPreviewData).content}`
        : replyTo?.content

  return (
    <Animated.View
      className="border-t border-border-light bg-bg-primary px-3 pt-2"
      style={containerStyle}
    >
      {replyTo ? (
        <Animated.View
          entering={FadeInDown.duration(180)}
          exiting={FadeOut.duration(120)}
          layout={COMPOSER_LAYOUT}
          className="mb-2 flex-row items-center rounded-[14px] bg-surface-input px-3 py-2.5"
        >
          <View className="mr-3 h-full w-1 rounded-full bg-brand" />
          <View className="flex-1">
            <Text className="text-xs2 text-text-muted">Replying to</Text>
            <Text className="mt-0.5 text-sm2 text-text-primary" numberOfLines={1}>
              {replyPreviewText}
            </Text>
          </View>

          <TouchableOpacity
            onPress={onCancelReply}
            className="ml-2 h-8 w-8 items-center justify-center rounded-full"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="close" size={18} color="#A6A6A6" />
          </TouchableOpacity>
        </Animated.View>
      ) : null}

      <View className="flex-row items-end gap-2">
        <View className="flex-1 flex-row items-end rounded-[18px] bg-surface-input px-4 py-1">
          <TextInput
            className="min-h-[20px] flex-1 py-2 text-md text-text-primary"
            value={text}
            onChangeText={handleTextChange}
            placeholder="Message"
            placeholderTextColor="#A6A6A6"
            multiline
            maxLength={1000}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
          />

          <TouchableOpacity
            className="h-10 w-10 items-center justify-center"
            onPress={() => {
              /* emoji picker placeholder */
            }}
            activeOpacity={0.75}
          >
            <MaterialIcons name="sentiment-satisfied-alt" size={20} color="#A6A6A6" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          className="h-12 w-12 items-center justify-center rounded-[16px] bg-surface-input"
          onPress={hasText ? handleSend : handleAttachImage}
          onLongPress={hasText ? undefined : handleAttachFile}
          activeOpacity={0.8}
        >
          <MaterialIcons
            name={hasText ? 'north-east' : 'attach-file'}
            size={20}
            color={hasText ? '#FF6B2C' : '#777777'}
          />
        </TouchableOpacity>
      </View>
    </Animated.View>
  )
}

export const MessageInput = memo(MessageInputComponent)
