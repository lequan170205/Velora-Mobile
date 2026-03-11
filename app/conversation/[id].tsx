import { MaterialIcons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { MessageBubble } from '../../src/components/chat/MessageBubble'
import { MessageInput } from '../../src/components/chat/MessageInput'
import { useMessages, useSendMessage } from '../../src/hooks/useMessages'
import { useAuthStore } from '../../src/stores/authStore'
import { useChatStore } from '../../src/stores/chatStore'

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuthStore()
  const { optimisticMessages } = useChatStore()

  const { data, isLoading, fetchNextPage, hasNextPage } = useMessages(id as string)
  const { mutate: sendMessage } = useSendMessage(id as string)

  const listRef = useRef<any>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const serverMessages = data?.pages.flat() || []
  const localOptimistic = optimisticMessages[id as string] || []
  const serverIds = new Set(serverMessages.map((m) => m?.id))
  const pendingMessages = localOptimistic.filter((m) => m && !serverIds.has(m.id))

  const allMessages = [...pendingMessages, ...serverMessages].sort(
    (a, b) => new Date(b?.createdAt).getTime() - new Date(a?.createdAt).getTime(),
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleScroll = (event: any) => {
    const offsetY = event.nativeEvent.contentOffset.y
    setShowScrollButton(offsetY > 200)
  }

  const scrollToBottom = () => {
    listRef.current?.scrollToOffset({
      offset: 0,
      animated: true,
    })
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <MaterialIcons name="arrow-back" size={24} color="#0A7CFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Chat</Text>
          <View style={{ width: 48 }} />
        </View>

        <View style={styles.listContainer}>
          {isLoading && serverMessages.length === 0 ? (
            <View style={styles.centered}>
              <ActivityIndicator color="#0A7CFF" size="large" />
            </View>
          ) : (
            <>
              <FlatList
                ref={listRef}
                data={allMessages}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                renderItem={({ item }: { item: any }) => {
                  // Skip rendering if the item is somehow undefined
                  if (!item) return null
                  return <MessageBubble message={item} isOwn={item.senderId === user?.id} />
                }}
                // Fallback key if item.id is missing
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                keyExtractor={(item: any, index: number) =>
                  item?.id?.toString() || `fallback-${index}`
                }
                onEndReached={() => {
                  if (hasNextPage) fetchNextPage()
                }}
                onEndReachedThreshold={0.5}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                inverted
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
              />
              {showScrollButton && (
                <TouchableOpacity
                  style={styles.scrollToBottomButton}
                  onPress={scrollToBottom}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="keyboard-arrow-down" size={24} color="#f8fafc" />
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        <MessageInput onSend={(text) => sendMessage(text)} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: 'center',
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  container: {
    backgroundColor: '#121212',
    flex: 1,
  },
  header: {
    alignItems: 'center',
    backgroundColor: '#121212',
    borderBottomColor: '#1E1E24',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 12,
    paddingHorizontal: 8,
    paddingTop: 12,
    zIndex: 10,
  },
  headerTitle: {
    color: '#f8fafc',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 18,
  },
  keyboardView: {
    flex: 1,
    zIndex: 10,
  },
  listContainer: {
    flex: 1,
  },
  listContent: {
    paddingVertical: 16,
  },
  scrollToBottomButton: {
    alignItems: 'center',
    backgroundColor: '#26262E',
    borderColor: '#333333',
    borderRadius: 20,
    borderWidth: 1,
    bottom: 16,
    elevation: 4,
    height: 40,
    justifyContent: 'center',
    position: 'absolute',
    right: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    width: 40,
  },
})
