import { MaterialIcons } from '@expo/vector-icons'
import React, { useState } from 'react'
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native'

interface MessageInputProps {
  onSend: (text: string) => void
}

export function MessageInput({ onSend }: MessageInputProps) {
  const [text, setText] = useState('')
  const [isFocused, setIsFocused] = useState(false)

  const handleSend = () => {
    if (text.trim()) {
      onSend(text.trim())
      setText('')
    }
  }

  const hasText = text.trim().length > 0

  return (
    <View style={styles.container}>
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.iconButton}>
          <MaterialIcons name="add-circle" size={28} color="#64748b" />
        </TouchableOpacity>

        <View style={[styles.inputWrapper, isFocused && styles.inputWrapperFocused]}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Type a message..."
            placeholderTextColor="#64748b"
            multiline
            maxLength={1000}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
          />

          {hasText && (
            <TouchableOpacity
              style={styles.sendButtonActive}
              onPress={handleSend}
              disabled={!hasText}
            >
              <MaterialIcons name="send" size={20} color="#ffffff" style={{ marginLeft: 3 }} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  actionRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 8,
  },
  container: {
    backgroundColor: '#121212',
    borderTopColor: '#1E1E24',
    borderTopWidth: 1,
    paddingBottom: 24,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  iconButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    marginBottom: 4,
    width: 40,
  },
  input: {
    color: '#f8fafc',
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    maxHeight: 120,
    minHeight: 40,
    paddingBottom: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  inputWrapper: {
    alignItems: 'flex-end',
    backgroundColor: '#1E1E24',
    borderRadius: 24,
    flex: 1,
    flexDirection: 'row',
    paddingRight: 6,
    paddingVertical: 4,
  },
  inputWrapperFocused: {
    backgroundColor: '#26262E',
  },
  sendButtonActive: {
    alignItems: 'center',
    backgroundColor: '#0A7CFF',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    marginBottom: 4,
    width: 32,
  },
})
