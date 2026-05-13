import { MaterialIcons } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import React, { memo, useState } from 'react'
import { Alert, Text, TextInput, TouchableOpacity, View } from 'react-native'

import { cn } from '../../lib/cn'

import type { Message, ReplyPreviewData } from '../../types/conversation.types'

interface MessageInputProps {
  onSend: (text: string, replyToId?: string) => void
  onSendMedia?: (uri: string, type: 'image' | 'file', fileInfo: unknown) => void
  onChangeText?: (text: string) => void
  replyTo?: Message | null
  onCancelReply?: () => void
}

const MessageInputComponent = function MessageInput({
  onSend,
  onSendMedia,
  onChangeText,
  replyTo,
  onCancelReply,
}: MessageInputProps) {
  const [text, setText] = useState('')
  const [isFocused, setIsFocused] = useState(false)

  const handleSend = () => {
    if (text.trim()) {
      onSend(text.trim(), replyTo?.id)
      setText('')
      if (onCancelReply) {
        onCancelReply()
      }
    }
  }

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

  return (
    <View className="bg-bg-primary border-surface-card px-3 pb-3 pt-3">
      {/* Reply Preview */}
      {replyTo && (
        <View className="flex-row items-center bg-surface-focus rounded-lg px-3 py-2 mb-2">
          <View className="w-1 h-full bg-brand rounded-full mr-3" />
          <View className="flex-1">
            <Text className="text-xs text-text-muted">Replying to</Text>
            <Text className="text-sm text-text-primary" numberOfLines={1}>
              {typeof replyTo.replyPreview === 'string'
                ? replyTo.replyPreview
                : replyTo.replyPreview
                  ? `${(replyTo.replyPreview as ReplyPreviewData).senderName}: ${(replyTo.replyPreview as ReplyPreviewData).content}`
                  : replyTo.content}
            </Text>
          </View>
          <TouchableOpacity onPress={onCancelReply} className="p-1">
            <MaterialIcons name="close" size={20} color="#64748b" />
          </TouchableOpacity>
        </View>
      )}

      <View className="flex-row items-end gap-2">
        {!isFocused && !hasText && (
          <View className="flex-row gap-0.5">
            <TouchableOpacity
              className="w-9 h-10 items-center justify-center mb-1"
              onPress={handleAttachImage}
            >
              <MaterialIcons name="image" size={24} color="#0A7CFF" />
            </TouchableOpacity>
            <TouchableOpacity
              className="w-9 h-10 items-center justify-center mb-1"
              onPress={handleAttachFile}
            >
              <MaterialIcons name="attach-file" size={24} color="#0A7CFF" />
            </TouchableOpacity>
          </View>
        )}

        {(isFocused || hasText) && (
          <TouchableOpacity
            className="w-9 h-10 items-center justify-center mb-1"
            onPress={() => setIsFocused(false)}
          >
            <MaterialIcons name="add-circle" size={26} color="#0A7CFF" />
          </TouchableOpacity>
        )}

        <View
          className={cn(
            'flex-1 flex-row items-center rounded-3xl pr-1.5 py-0.5',
            isFocused ? 'bg-surface-focus border border-[#333333]' : 'bg-surface-input',
          )}
        >
          <TextInput
            className="flex-1 text-text-primary font-sans text-md px-4 py-2.5 min-h-[40px] max-h-[120px]"
            value={text}
            onChangeText={handleTextChange}
            placeholder="Message..."
            placeholderTextColor="#64748b"
            multiline
            maxLength={1000}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
          />

          <TouchableOpacity
            className={cn(
              'w-9 h-9 rounded-full items-center justify-center',
              hasText ? 'bg-brand' : 'bg-transparent',
            )}
            onPress={handleSend}
            disabled={!hasText}
            activeOpacity={0.7}
          >
            <MaterialIcons
              name="send"
              size={18}
              color={hasText ? '#ffffff' : '#64748b'}
              style={{ marginLeft: 3 }}
            />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

export const MessageInput = memo(MessageInputComponent)
