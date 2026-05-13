import { MaterialIcons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import React from 'react'
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { authApi } from '../../src/api/auth.api'
import { useUpdateAvatar } from '../../src/hooks/useProfile'
import { useAuthStore } from '../../src/stores/authStore'
import { useChatStore } from '../../src/stores/chatStore'

const getMemberSince = (createdAt?: string) => {
  if (!createdAt) return 'Recently joined'

  try {
    return format(new Date(createdAt), 'MMM yyyy')
  } catch {
    return 'Recently joined'
  }
}

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
          } catch (error) {
            console.error(error)
          }

          queryClient.clear()
          clearCache()
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
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 164, paddingTop: 12 }}
        showsVerticalScrollIndicator={false}
      >
        <View
          className="rounded-[32px] border border-border-light bg-surface-card px-5 py-5"
          style={{
            borderCurve: 'continuous',
            boxShadow: '0 18px 36px rgba(93, 74, 53, 0.08)',
          }}
        >
          <Text className="text-xs2 uppercase tracking-[1.4px] text-text-muted">
            Enterprise profile
          </Text>
          <Text className="mt-2 font-heading text-[30px] leading-[36px] text-text-primary">
            Your Velora identity
          </Text>
          <Text className="mt-2 text-base2 leading-6 text-text-secondary">
            Manage your account presence, trust signals, and workspace hygiene from one calm control
            surface.
          </Text>

          <View className="mt-6 flex-row items-center">
            <TouchableOpacity
              onPress={handlePickImage}
              disabled={isUpdatingAvatar}
              className="relative"
              activeOpacity={0.82}
            >
              {user?.picture ? (
                <Image
                  source={{ uri: user.picture }}
                  style={{
                    width: 96,
                    height: 96,
                    borderRadius: 48,
                    backgroundColor: '#F2EEE8',
                  }}
                />
              ) : (
                <View className="h-24 w-24 items-center justify-center rounded-full bg-surface-muted">
                  <Text className="font-heading text-[34px] text-text-primary">
                    {user?.firstName?.charAt(0).toUpperCase() || 'U'}
                  </Text>
                </View>
              )}

              <View className="absolute bottom-0 right-0 h-9 w-9 items-center justify-center rounded-full bg-brand border-2 border-surface-card">
                <MaterialIcons name="camera-alt" size={16} color="#FFFFFF" />
              </View>
            </TouchableOpacity>

            <View className="ml-4 flex-1">
              <Text className="font-heading text-xxl text-text-primary">
                {user?.firstName} {user?.lastName}
              </Text>
              <Text className="mt-1 text-base2 text-text-secondary">{user?.email}</Text>

              <View className="mt-3 flex-row flex-wrap gap-2">
                <View className="rounded-full bg-brand-soft px-3 py-2">
                  <Text className="text-xs2 font-medium uppercase tracking-[1px] text-brand-dark">
                    {user?.role || 'User'}
                  </Text>
                </View>

                <View className="rounded-full bg-surface-muted px-3 py-2">
                  <Text className="text-xs2 font-medium uppercase tracking-[1px] text-text-secondary">
                    {user?.isEmailVerified ? 'Verified' : 'Verification pending'}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        <View className="mt-4 flex-row gap-3">
          <View className="flex-1 rounded-[24px] bg-surface-card px-4 py-4 border border-border-light">
            <Text className="text-xs2 uppercase tracking-[1.1px] text-text-muted">Role</Text>
            <Text className="mt-2 font-heading text-xl text-text-primary">{user?.role}</Text>
          </View>

          <View className="flex-1 rounded-[24px] bg-surface-card px-4 py-4 border border-border-light">
            <Text className="text-xs2 uppercase tracking-[1.1px] text-text-muted">
              Member since
            </Text>
            <Text className="mt-2 font-heading text-xl text-text-primary">
              {getMemberSince(user?.createdAt)}
            </Text>
          </View>
        </View>

        <View
          className="mt-4 rounded-[28px] border border-border-light bg-surface-card px-4 py-4"
          style={{
            borderCurve: 'continuous',
            boxShadow: '0 12px 24px rgba(93, 74, 53, 0.06)',
          }}
        >
          <Text className="font-heading text-lg text-text-primary">Workspace actions</Text>

          <View className="mt-4 gap-3">
            <TouchableOpacity
              className="flex-row items-center rounded-[22px] bg-surface-muted px-4 py-4"
              activeOpacity={0.78}
              onPress={handlePickImage}
              style={{ borderCurve: 'continuous' }}
            >
              <View className="h-11 w-11 items-center justify-center rounded-full bg-surface-card">
                <MaterialIcons name="photo-camera" size={20} color="#161514" />
              </View>
              <View className="ml-3 flex-1">
                <Text className="font-medium text-md text-text-primary">
                  {isUpdatingAvatar ? 'Updating photo...' : 'Update profile photo'}
                </Text>
                <Text className="mt-1 text-sm2 text-text-secondary">
                  Keep your workspace presence polished and current.
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              className="flex-row items-center rounded-[22px] bg-surface-muted px-4 py-4"
              onPress={handleClearCache}
              activeOpacity={0.78}
              style={{ borderCurve: 'continuous' }}
            >
              <View className="h-11 w-11 items-center justify-center rounded-full bg-surface-card">
                <MaterialIcons name="delete-sweep" size={20} color="#D85A21" />
              </View>
              <View className="ml-3 flex-1">
                <Text className="font-medium text-md text-text-primary">Clear workspace cache</Text>
                <Text className="mt-1 text-sm2 text-text-secondary">
                  Reset local message data when you need a clean sync.
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              className="flex-row items-center rounded-[22px] bg-[#FFF2F0] px-4 py-4"
              onPress={handleLogout}
              activeOpacity={0.78}
              style={{ borderCurve: 'continuous' }}
            >
              <View className="h-11 w-11 items-center justify-center rounded-full bg-white">
                <MaterialIcons name="logout" size={20} color="#FF3B30" />
              </View>
              <View className="ml-3 flex-1">
                <Text className="font-medium text-md text-status-error">Sign out securely</Text>
                <Text className="mt-1 text-sm2 text-text-secondary">
                  End your current session on this device.
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
