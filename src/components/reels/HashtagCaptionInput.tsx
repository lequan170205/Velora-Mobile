import React, { useMemo } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'

import { colors } from '../../constants/theme'
import { getCaptionSegments } from '../../lib/reels'

interface HashtagCaptionInputProps {
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  editable?: boolean
}

const styles = StyleSheet.create({
  hashtag: {
    color: colors.brand.tertiary,
    fontFamily: 'Inter_500Medium',
  },
  input: {
    color: 'transparent',
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    lineHeight: 24,
    minHeight: 0,
    padding: 0,
    textAlignVertical: 'top',
  },
  overlay: {
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  overlayText: {
    color: colors.text.primary,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    lineHeight: 24,
  },
  placeholder: {
    color: colors.text.tertiary,
  },
})

export function HashtagCaptionInput({
  value,
  onChangeText,
  placeholder = 'Write a caption...',
  editable = true,
}: HashtagCaptionInputProps) {
  const segments = useMemo(() => getCaptionSegments(value), [value])

  return (
    <View className="flex-1">
      <View pointerEvents="none" style={styles.overlay}>
        <Text style={styles.overlayText}>
          {value.length > 0 ? (
            segments.map((segment, index) => {
              return (
                <Text
                  key={`${segment.text}-${index}`}
                  style={segment.isHashtag ? styles.hashtag : undefined}
                >
                  {segment.text}
                </Text>
              )
            })
          ) : (
            <Text style={styles.placeholder}>{placeholder}</Text>
          )}
        </Text>
      </View>

      <TextInput
        className="flex-1"
        multiline
        scrollEnabled
        selectionColor={colors.brand.primary}
        textAlignVertical="top"
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        style={styles.input}
      />
    </View>
  )
}
