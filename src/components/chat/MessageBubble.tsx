import { format } from 'date-fns'
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import type { Message } from '../../types/conversation.types'

interface MessageBubbleProps {
  message: Message
  isOwn: boolean
}

export function MessageBubble({ message, isOwn }: MessageBubbleProps) {
  let timeString = ''
  if (message.createdAt) {
    try {
      const date = new Date(message.createdAt)
      if (!isNaN(date.getTime())) {
        timeString = format(date, 'h:mm a')
      }
    } catch {
      timeString = ''
    }
  }

  const getStatusIcon = () => {
    switch (message.status) {
      case 'READ':
      case 'DELIVERED':
        return '✓✓'
      default:
        return '✓'
    }
  }

  return (
    <View style={[styles.container, isOwn ? styles.ownContainer : styles.otherContainer]}>
      {!isOwn && (
        <Text style={styles.senderName}>{message.senderId?.substring(0, 8) || 'User'}</Text>
      )}

      <View style={styles.bubbleRow}>
        {isOwn ? (
          <View style={[styles.bubble, styles.ownBubble]}>
            <Text style={styles.ownMessageText}>{message.content}</Text>

            <View style={styles.footer}>
              <Text style={styles.timeTextOwn}>{timeString}</Text>
              <Text style={styles.statusIcon}>{getStatusIcon()}</Text>
            </View>
          </View>
        ) : (
          <View style={[styles.bubble, styles.otherBubble]}>
            <Text style={styles.otherMessageText}>{message.content}</Text>

            <View style={styles.footerOther}>
              <Text style={styles.timeTextOther}>{timeString}</Text>
            </View>
          </View>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  bubbleRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
  },
  container: {
    marginVertical: 4,
    paddingHorizontal: 16,
    width: '100%',
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  footerOther: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  otherBubble: {
    backgroundColor: '#1E1E24',
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  otherContainer: {
    alignItems: 'flex-start',
  },
  otherMessageText: {
    color: '#f8fafc',
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    lineHeight: 22,
  },
  ownBubble: {
    backgroundColor: '#0A7CFF',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 4,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  ownContainer: {
    alignItems: 'flex-end',
  },
  ownMessageText: {
    color: '#ffffff',
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    lineHeight: 22,
  },
  senderName: {
    color: '#94a3b8',
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    marginBottom: 4,
    marginLeft: 12,
  },
  statusIcon: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    marginLeft: 4,
  },
  timeTextOther: {
    color: '#64748b',
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
  },
  timeTextOwn: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
  },
})
