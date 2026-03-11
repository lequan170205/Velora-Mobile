import { format } from 'date-fns'
import React from 'react'
import { Text, View } from 'react-native'

import { cn } from '../../lib/cn'
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
    <View className={cn('w-full my-1 px-4', isOwn ? 'items-end' : 'items-start')}>
      <View className="flex-row items-end">
        <View
          className={cn(
            'max-w-[82%] px-3.5 py-2.5',
            isOwn
              ? 'bg-bubble-out rounded-xl rounded-br-bubble-sm'
              : 'bg-bubble-in rounded-xl rounded-bl-bubble-sm',
          )}
        >
          <Text
            className={cn(
              'font-sans text-base leading-[22px]',
              isOwn ? 'text-white' : 'text-text-primary',
            )}
          >
            {message.content}
          </Text>

          <View className="flex-row items-center self-end mt-1">
            <Text
              className={cn(
                'text-[10px] font-medium',
                isOwn ? 'text-white/70' : 'text-text-secondary',
              )}
            >
              {timeString}
            </Text>
            {isOwn && (
              <Text className="text-[10px] font-medium text-white/80 ml-1.5">
                {getStatusIcon()}
              </Text>
            )}
          </View>
        </View>
      </View>
    </View>
  )
}
