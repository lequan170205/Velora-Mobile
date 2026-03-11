import { MaterialIcons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import React from 'react'
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { authApi } from '../../src/api/auth.api'
import { useUpdateAvatar } from '../../src/hooks/useProfile'
import { useAuthStore } from '../../src/stores/authStore'

export default function ProfileScreen() {
  const { user, clearAuth } = useAuthStore()
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
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Profile</Text>
        </View>

        <View style={styles.avatarSection}>
          <TouchableOpacity
            onPress={handlePickImage}
            disabled={isUpdatingAvatar}
            style={styles.avatarWrapper}
            activeOpacity={0.8}
          >
            {user?.avatar ? (
              <Image source={{ uri: user.avatar }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>
                  {user?.firstName?.charAt(0).toUpperCase() || 'U'}
                </Text>
              </View>
            )}

            <View style={styles.editBadge}>
              <MaterialIcons name="camera-alt" size={16} color="#ffffff" />
            </View>
          </TouchableOpacity>

          <View style={styles.nameContainer}>
            <Text style={styles.name}>
              {user?.firstName} {user?.lastName}
            </Text>
            <Text style={styles.email}>{user?.email}</Text>
          </View>
        </View>

        <View style={styles.statsContainer}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>42</Text>
            <Text style={styles.statLabel}>Missions</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>Elite</Text>
            <Text style={styles.statLabel}>Status</Text>
          </View>
        </View>

        <View style={styles.section}>
          <TouchableOpacity style={styles.menuCell} activeOpacity={0.7}>
            <MaterialIcons name="edit" size={24} color="#94a3b8" style={styles.btnIcon} />
            <Text style={styles.btnText}>Edit Profile</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuCell} activeOpacity={0.7}>
            <MaterialIcons name="palette" size={24} color="#94a3b8" style={styles.btnIcon} />
            <Text style={styles.btnText}>Theme Settings</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuCell, styles.logoutCell]}
            onPress={handleLogout}
            activeOpacity={0.7}
          >
            <MaterialIcons name="logout" size={24} color="#ef4444" style={styles.btnIcon} />
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  avatarImage: {
    borderRadius: 72,
    height: 144,
    width: 144,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    backgroundColor: '#1E1E24',
    borderRadius: 72,
    height: 144,
    justifyContent: 'center',
    width: 144,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarText: {
    color: '#f8fafc',
    fontFamily: 'Inter_700Bold',
    fontSize: 48,
  },
  avatarWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    position: 'relative',
  },
  btnIcon: {
    marginRight: 16,
  },
  btnText: {
    color: '#f8fafc',
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
  },
  container: {
    backgroundColor: '#121212',
    flex: 1,
  },
  editBadge: {
    alignItems: 'center',
    backgroundColor: '#0A7CFF',
    borderColor: '#121212',
    borderRadius: 16,
    borderWidth: 2,
    bottom: 4,
    height: 32,
    justifyContent: 'center',
    position: 'absolute',
    right: 4,
    width: 32,
  },
  email: {
    color: '#94a3b8',
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    marginTop: 4,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
    paddingTop: 16,
  },
  headerTitle: {
    color: '#f8fafc',
    fontFamily: 'Inter_700Bold',
    fontSize: 32,
  },
  logoutCell: {
    marginTop: 8,
  },
  logoutText: {
    color: '#ef4444',
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
  },
  menuCell: {
    alignItems: 'center',
    backgroundColor: '#1E1E24',
    borderRadius: 16,
    flexDirection: 'row',
    height: 56,
    paddingHorizontal: 20,
    width: '100%',
  },
  name: {
    color: '#f8fafc',
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
    textAlign: 'center',
  },
  nameContainer: {
    alignItems: 'center',
  },
  scroll: {
    alignItems: 'center',
    paddingBottom: 40,
    paddingHorizontal: 16,
  },
  section: {
    gap: 8,
    marginTop: 32,
    width: '100%',
  },
  statBox: {
    alignItems: 'center',
    backgroundColor: '#1E1E24',
    borderRadius: 16,
    flex: 1,
    padding: 12,
  },
  statLabel: {
    color: '#94a3b8',
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 4,
  },
  statValue: {
    color: '#f8fafc',
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
  },
  statsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    width: '100%',
  },
})
