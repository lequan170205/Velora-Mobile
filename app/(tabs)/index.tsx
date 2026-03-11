import { MaterialIcons } from '@expo/vector-icons'
import { FlashList } from '@shopify/flash-list'
import React from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ConversationItem } from '../../src/components/chat/ConversationItem'
import { useConversations } from '../../src/hooks/useConversations'

export default function ConversationsScreen() {
  const { data: conversations, isLoading, isError } = useConversations()

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#0A7CFF" size="large" />
      </View>
    )
  }

  if (isError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Failed to load conversations</Text>
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        <TouchableOpacity style={styles.editButton}>
          <MaterialIcons name="edit-square" size={24} color="#f8fafc" />
        </TouchableOpacity>
      </View>

      <View style={styles.listContainer}>
        <FlashList
          data={conversations || []}
          renderItem={({ item }) => <ConversationItem conversation={item} />}
          keyExtractor={(item) => item.id}
          // @ts-expect-error FlashList types mismatch
          estimatedItemSize={100}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No conversations yet. Start chatting!</Text>
            </View>
          }
        />
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    backgroundColor: '#121212',
    flex: 1,
    justifyContent: 'center',
  },
  container: {
    backgroundColor: '#121212',
    flex: 1,
  },
  editButton: {
    alignItems: 'center',
    backgroundColor: '#1E1E24',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  emptyContainer: {
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    color: '#94a3b8',
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  errorText: {
    color: '#ef4444',
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 16,
    paddingHorizontal: 20,
    paddingTop: 16,
    zIndex: 10,
  },
  listContainer: {
    flex: 1,
    zIndex: 10,
  },
  title: {
    color: '#f8fafc',
    fontFamily: 'Inter_700Bold',
    fontSize: 32,
  },
})
