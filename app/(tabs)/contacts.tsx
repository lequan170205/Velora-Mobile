import { MaterialIcons } from '@expo/vector-icons'
import { FlashList as OriginalFlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import React, { useState } from 'react'
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { conversationApi } from '../../src/api/conversation.api'
import { useContacts } from '../../src/hooks/useContacts'
import { useChatStore } from '../../src/stores/chatStore'
import type { UserSession } from '../../src/types/user.types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FlashList = OriginalFlashList as any

export default function ContactsScreen() {
  const [search, setSearch] = useState('')

  const { data, isLoading, fetchNextPage, hasNextPage } = useContacts(search)
  const { onlineUsers } = useChatStore()
  const router = useRouter()

  const users = data?.pages.flatMap((page) => page?.users || []) || []

  const handleUserPress = async (user: UserSession) => {
    try {
      const conv = await conversationApi.create({
        participantIds: [user.id],
        type: 'DIRECT',
      })
      router.push(`/conversation/${conv.id}`)
    } catch (err) {
      console.error(err)
    }
  }

  const renderItem = ({ item }: { item: UserSession }) => {
    if (!item) return null
    const isOnline = onlineUsers.has(item.id)
    return (
      <TouchableOpacity
        style={styles.contactItem}
        onPress={() => handleUserPress(item)}
        activeOpacity={0.7}
      >
        <View style={styles.contactRow}>
          <View style={styles.avatarContainer}>
            <View style={styles.avatarSolid}>
              <Text style={styles.avatarText}>{item.firstName.charAt(0).toUpperCase()}</Text>
            </View>
            <View
              style={[
                styles.onlineBadge,
                isOnline ? styles.onlineBadgeActive : styles.onlineBadgeInactive,
              ]}
            />
          </View>

          <View style={styles.infoContainer}>
            <Text style={styles.contactName} numberOfLines={1}>
              {item.firstName} {item.lastName}
            </Text>
            <Text
              style={[
                styles.statusText,
                isOnline ? styles.statusTextActive : styles.statusTextInactive,
              ]}
            >
              {isOnline ? 'Active Now' : 'Offline'}
            </Text>
          </View>

          <View style={styles.actionIconContainer}>
            <MaterialIcons name="chat-bubble" size={24} color="#0A7CFF" />
          </View>
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Contacts</Text>

        <View style={styles.searchContainer}>
          <MaterialIcons name="search" size={20} color="#64748b" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search users..."
            placeholderTextColor="#64748b"
          />
        </View>
      </View>

      <View style={styles.listContainer}>
        {isLoading ? (
          <ActivityIndicator color="#0A7CFF" size="large" style={styles.loader} />
        ) : (
          <FlashList
            data={users}
            renderItem={renderItem}
            keyExtractor={(item: UserSession, index: number) => item?.id || index.toString()}
            estimatedItemSize={80}
            showsVerticalScrollIndicator={false}
            onEndReached={() => {
              if (hasNextPage) fetchNextPage()
            }}
            onEndReachedThreshold={0.5}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No contacts found</Text>
              </View>
            }
          />
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  actionIconContainer: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  avatarContainer: {
    marginRight: 12,
    position: 'relative',
  },
  avatarSolid: {
    alignItems: 'center',
    backgroundColor: '#1E1E24',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  avatarText: {
    color: '#f8fafc',
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
  },
  contactItem: {
    marginHorizontal: 16,
  },
  contactName: {
    color: '#f8fafc',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    marginBottom: 4,
  },
  contactRow: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingVertical: 12,
  },
  container: {
    backgroundColor: '#121212',
    flex: 1,
  },
  empty: {
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    color: '#94a3b8',
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    zIndex: 10,
  },
  infoContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  listContainer: {
    flex: 1,
    paddingTop: 8,
    zIndex: 10,
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
  },
  onlineBadge: {
    borderRadius: 7,
    borderWidth: 2,
    bottom: -2,
    height: 14,
    position: 'absolute',
    right: -2,
    width: 14,
  },
  onlineBadgeActive: {
    backgroundColor: '#4ade80',
    borderColor: '#121212',
  },
  onlineBadgeInactive: {
    backgroundColor: '#64748b',
    borderColor: '#121212',
  },
  searchContainer: {
    alignItems: 'center',
    backgroundColor: '#1E1E24',
    borderRadius: 24,
    flexDirection: 'row',
    height: 40,
    marginTop: 16,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    color: '#f8fafc',
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    height: '100%',
  },
  statusText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
  },
  statusTextActive: {
    color: '#4ade80',
  },
  statusTextInactive: {
    color: '#64748b',
  },
  title: {
    color: '#f8fafc',
    fontFamily: 'Inter_700Bold',
    fontSize: 32,
  },
})
