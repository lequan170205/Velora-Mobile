import { MaterialIcons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import React from 'react'
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'


import { authApi } from '../../src/api/auth.api'
import { useUpdateAvatar } from '../../src/hooks/useProfile'
import { useAuthStore } from '../../src/stores/authStore'
import { useChatStore } from '../../src/stores/chatStore'

export default function ProfileScreen() {
  const { user, clearAuth } = useAuthStore()
  const { clearCache } = useChatStore()
  const queryClient = useQueryClient()
  const { mutate: updateAvatar, isPending: isUpdatingAvatar } = useUpdateAvatar()

  const handleLogout = async () => {
    Alert.alert('Logout', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          try {
            await authApi.logout()
          } catch (e) {
            console.error(e)
          }
          clearAuth()
        },
      },
    ])
  }

  const handleClearCache = async () => {
    Alert.alert('Clear Cache', 'Clear all cached messages?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        onPress: async () => {
          await clearCache()
          queryClient.clear()
          Alert.alert('Success', 'Cache cleared!')
        },
      },
    ])
  }

  const handlePickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    })

    if (!result.canceled && result.assets[0].uri) {
      updateAvatar(result.assets[0].uri)
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary" edges={['top']}>
      <ScrollView
        contentContainerStyle={{ alignItems: 'center', paddingBottom: 40, paddingHorizontal: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="items-center mb-6 pt-4">
          <Text className="text-text-primary font-bold text-display">Profile</Text>
        </View>

        {/* Avatar section */}
        <View className="items-center mb-6">
          <TouchableOpacity
            onPress={handlePickImage}
            disabled={isUpdatingAvatar}
            className="items-center justify-center mb-5 relative"
            activeOpacity={0.8}
          >
            {user?.picture ? (
              <Image
                source={{ uri: user.picture }}
                // NativeWind limitation: kept as inline — exact borderRadius needs to match width/2
                style={{ width: 144, height: 144, borderRadius: 72 }}
              />
            ) : (
              <View className="w-36 h-36 rounded-full bg-surface-card items-center justify-center">
                <Text className="text-text-primary font-bold text-[48px]">
                  {user?.firstName?.charAt(0).toUpperCase() || 'U'}
                </Text>
              </View>
            )}

            {/* Edit badge */}
            <View className="absolute bottom-1 right-1 w-8 h-8 rounded-badge bg-brand border-2 border-bg-primary items-center justify-center">
              <MaterialIcons name="camera-alt" size={16} color="#ffffff" />
            </View>
          </TouchableOpacity>

          {/* Name & email */}
          <View className="items-center">
            <Text className="text-text-primary font-bold text-xxl text-center">
              {user?.firstName} {user?.lastName}
            </Text>
            <Text className="text-text-secondary font-sans text-base2 mt-1">{user?.email}</Text>
          </View>
        </View>

        {/* Stats */}
        <View className="flex-row gap-3 mt-2 w-full">
          <View className="flex-1 items-center bg-surface-card rounded-xl p-3">
            <Text className="text-text-primary font-bold text-xl">42</Text>
            <Text className="text-text-secondary font-sans text-xs2 mt-1">Missions</Text>
          </View>
          <View className="flex-1 items-center bg-surface-card rounded-xl p-3">
            <Text className="text-text-primary font-bold text-xl">Elite</Text>
            <Text className="text-text-secondary font-sans text-xs2 mt-1">Status</Text>
          </View>
        </View>

        {/* Menu section */}
        <View className="gap-2 mt-8 w-full">
          <TouchableOpacity
            className="flex-row items-center bg-surface-card rounded-xl h-14 px-5"
            activeOpacity={0.7}
          >
            <MaterialIcons name="edit" size={24} color="#94a3b8" style={{ marginRight: 16 }} />
            <Text className="text-text-primary font-medium text-md flex-1">Edit Profile</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="flex-row items-center bg-surface-card rounded-xl h-14 px-5"
            activeOpacity={0.7}
          >
            <MaterialIcons name="palette" size={24} color="#94a3b8" style={{ marginRight: 16 }} />
            <Text className="text-text-primary font-medium text-md flex-1">Theme Settings</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="flex-row items-center bg-surface-card rounded-xl h-14 px-5 mt-2"
            onPress={handleClearCache}
            activeOpacity={0.7}
          >
            <MaterialIcons name="delete-sweep" size={24} color="#f59e0b" style={{ marginRight: 16 }} />
            <Text className="text-yellow-500 font-medium text-md flex-1">Clear Cache</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="flex-row items-center bg-surface-card rounded-xl h-14 px-5 mt-2"
            onPress={handleLogout}
            activeOpacity={0.7}
          >
            <MaterialIcons name="logout" size={24} color="#ef4444" style={{ marginRight: 16 }} />
            <Text className="text-status-error font-medium text-md flex-1">Logout</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
