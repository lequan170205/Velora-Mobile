import { format } from 'date-fns'
import { useRouter } from 'expo-router'
import React from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'; // Thêm Image vào đây

import { useAuthStore } from '../../stores/authStore'
import type { Conversation } from '../../types/conversation.types'

export function ConversationItem({ conversation }: { conversation: Conversation }) {
  const router = useRouter()
  const { user } = useAuthStore()

  const handlePress = () => {
    router.push(`/conversation/${conversation.id}`)
  }

  // 1. Logic lấy tên hiển thị và avatar dựa vào isGroup
  let displayName = 'Unknown'
  let avatarUrl: string | undefined = undefined // Biến lưu URL avatar

  if (!conversation.isGroup) {
    // Chat 1-1: Tìm người tham gia khác với id của mình
    const otherUser = conversation.participants?.find((p) => p.id !== user?.id)

    if (otherUser) {
      displayName = otherUser.name || otherUser.email || 'Unknown'
    }
    // Lấy avatar của user kia

    if (otherUser?.picture) {
      avatarUrl = otherUser.picture
    }
  } else {
    // Chat nhóm
    displayName = conversation.name || 'Group Chat'
    // Nếu entity có avatar cho group sau này, bạn gán vào avatarUrl ở đây
    if (conversation.picture) {
      avatarUrl = conversation.picture
    }
  }

  // 2. Logic lấy thời gian tin nhắn cuối từ lastMessageAt
  let timeString = ''
  if (conversation.lastMessageAt) {
    try {
      const date = new Date(conversation.lastMessageAt)
      if (!isNaN(date.getTime())) {
        timeString = format(date, 'h:mm a')
      }
    } catch {
      timeString = ''
    }
  }

  // 3. Logic tin nhắn chưa đọc
  const isUnread = false

  return (
    <TouchableOpacity style={styles.container} onPress={handlePress} activeOpacity={0.7}>
      <View style={styles.avatarWrapper}>
        {/* Render Image nếu có avatarUrl, ngược lại fallback về chữ cái đầu */}
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatarImage} resizeMode="cover" />
        ) : (
          <View style={styles.avatarSolid}>
            <Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
          </View>
        )}
      </View>

      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Text
            style={[styles.name, isUnread ? styles.nameUnread : styles.nameRead]}
            numberOfLines={1}
          >
            {displayName}
          </Text>
          <Text style={[styles.time, isUnread ? styles.timeUnread : styles.timeRead]}>
            {timeString}
          </Text>
        </View>

        <View style={styles.footerRow}>
          <Text
            style={[
              styles.lastMessage,
              isUnread ? styles.lastMessageUnread : styles.lastMessageRead,
            ]}
            numberOfLines={1}
          >
            {conversation.lastMessage || 'No messages yet'}
          </Text>

          {isUnread && <View style={styles.unreadDot} />}
        </View>
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  // Thêm style cho Image avatar
  avatarImage: {
    backgroundColor: '#1E1E24', // Màu nền phòng khi ảnh đang load
    borderRadius: 28,
    height: 56,
    width: 56,
  },
  avatarSolid: {
    alignItems: 'center',
    backgroundColor: '#1E1E24',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  avatarText: {
    color: '#f8fafc',
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
  },
  avatarWrapper: {
    marginRight: 12,
  },
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  footerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingRight: 4,
  },
  headerRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  lastMessage: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    marginRight: 16,
  },
  lastMessageRead: {
    color: '#64748b',
  },
  lastMessageUnread: {
    color: '#f8fafc',
    fontFamily: 'Inter_600SemiBold',
  },
  name: {
    flex: 1,
    fontSize: 16,
    marginRight: 8,
  },
  nameRead: {
    color: '#f8fafc',
    fontFamily: 'Inter_500Medium',
  },
  nameUnread: {
    color: '#f8fafc',
    fontFamily: 'Inter_700Bold',
  },
  time: {
    fontSize: 12,
  },
  timeRead: {
    color: '#64748b',
    fontFamily: 'Inter_400Regular',
  },
  timeUnread: {
    color: '#0A7CFF',
    fontFamily: 'Inter_600SemiBold',
  },
  unreadDot: {
    backgroundColor: '#0A7CFF',
    borderRadius: 6,
    height: 12,
    width: 12,
  },
})
