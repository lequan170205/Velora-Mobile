import { MaterialIcons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import React from 'react'
import { ActivityIndicator, Modal, Text, TouchableOpacity, View } from 'react-native'

import type { Reel } from '../../types/reel.types'

interface DeleteReelModalProps {
  visible: boolean
  reel: Reel | null
  isDeleting: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteReelModal({
  visible,
  reel,
  isDeleting,
  onConfirm,
  onCancel,
}: DeleteReelModalProps) {
  if (!reel) {
    return null
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center bg-black/68 px-6">
        <View className="w-full max-w-[340px] rounded-[28px] bg-white px-6 py-6">
          <View className="items-center">
            <View className="h-14 w-14 items-center justify-center rounded-full bg-red-100">
              <MaterialIcons name="delete-outline" size={28} color="#DC2626" />
            </View>
            <Text className="mt-4 text-center font-heading text-xl" style={{ color: '#17120F' }}>
              Delete this reel?
            </Text>
            <Text className="mt-2 text-center text-sm2" style={{ color: 'rgba(46,36,30,0.62)' }}>
              This action cannot be undone. The reel will be permanently removed.
            </Text>
          </View>

          {reel.thumbnailUrl ? (
            <View className="mt-4 overflow-hidden rounded-[18px]">
              <Image
                source={{ uri: reel.thumbnailUrl }}
                contentFit="cover"
                style={{ width: '100%', height: 120 }}
              />
            </View>
          ) : null}

          <View className="mt-6 flex-row gap-3">
            <TouchableOpacity
              className="flex-1 rounded-[22px] bg-[#F7F2EC] px-4 py-4"
              activeOpacity={0.84}
              onPress={onCancel}
              disabled={isDeleting}
            >
              <Text className="text-center font-bold" style={{ color: '#17120F' }}>
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="flex-1 rounded-[22px] px-4 py-4"
              style={{ backgroundColor: isDeleting ? '#EF4444' : '#DC2626' }}
              activeOpacity={0.84}
              onPress={onConfirm}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text className="text-center font-bold text-white">Delete</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}
