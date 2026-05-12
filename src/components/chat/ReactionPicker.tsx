import { MaterialIcons } from '@expo/vector-icons'
import React from 'react'
import { Modal, Pressable, Text, TouchableOpacity, View } from 'react-native'

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😄', '😢', '👏', '🔥']

interface ReactionPickerProps {
  visible: boolean
  onClose: () => void
  onSelectReaction: (emoji: string) => void
  onUnsend?: () => void
  canUnsend?: boolean
}

export function ReactionPicker({
  visible,
  onClose,
  onSelectReaction,
  onUnsend,
  canUnsend,
}: ReactionPickerProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/50 justify-end" onPress={onClose}>
        <Pressable
          className="bg-surface-card rounded-t-3xl p-4 pb-8"
          onPress={(e) => e.stopPropagation()}
        >
          {/* Reaction emojis */}
          <View className="flex-row justify-around mb-4">
            {REACTION_EMOJIS.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                className="w-12 h-12 items-center justify-center rounded-full bg-surface-input"
                onPress={() => {
                  onSelectReaction(emoji)
                  onClose()
                }}
              >
                <Text className="text-2xl">{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Unsend option */}
          {canUnsend && onUnsend && (
            <TouchableOpacity
              className="flex-row items-center justify-center py-3 border-t border-surface-input mt-2"
              onPress={() => {
                onUnsend()
                onClose()
              }}
            >
              <MaterialIcons name="delete-outline" size={20} color="#ef4444" />
              <Text className="text-red-500 ml-2 font-medium">Unsend</Text>
            </TouchableOpacity>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  )
}
