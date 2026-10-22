import { MaterialIcons } from '@expo/vector-icons'
import React from 'react'
import { Text, View } from 'react-native'

import { colors } from '../../constants/theme'
import { describeCallLogForViewer } from '../../lib/call/callHistoryPresentation'
import { SafeTouchableOpacity } from '../common/SafeTouchableOpacity'

import type { Message } from '../../types/conversation.types'

type CallLogRowProps = {
  message: Message
  currentUserId: string | null
  timeLabel?: string
  /** Offered for 1-1 calls only; group calls start from the header. */
  onCallBack?: (callType: 'VOICE' | 'VIDEO') => void
}

/** A finished call, centred like group system rows and not interactive. */
export function CallLogRow({ message, currentUserId, timeLabel, onCallBack }: CallLogRowProps) {
  const callLog = message.metadata?.callLog

  if (!callLog) {
    return (
      <View className="items-center px-8 py-2.5">
        <View className="max-w-[88%] rounded-full bg-surface-input px-3.5 py-2">
          <Text className="font-sans text-center text-xs2 leading-4 text-text-secondary">
            {message.content}
          </Text>
        </View>
      </View>
    )
  }

  const presentation = describeCallLogForViewer(callLog, currentUserId)
  const iconColor = presentation.isMissed ? colors.status.error : colors.text.secondary
  const subtitle = [presentation.detail, timeLabel].filter(Boolean).join(' · ')
  const canCallBack = Boolean(onCallBack) && !callLog.isGroupCall

  return (
    <View className="items-center px-8 py-2.5">
      <View
        className="max-w-[88%] flex-row items-center rounded-[18px] bg-surface-input py-2 pl-3 pr-2"
        accessible
        accessibilityLabel={[presentation.title, subtitle].filter(Boolean).join(', ')}
      >
        <MaterialIcons name={presentation.icon} size={18} color={iconColor} />
        <View className="ml-2 min-w-0 flex-shrink">
          <Text
            className={`font-sans text-xs2 font-semibold leading-4 ${
              presentation.isMissed ? 'text-status-error-text' : 'text-text-primary'
            }`}
            numberOfLines={1}
          >
            {presentation.title}
          </Text>
          {subtitle ? (
            <Text className="font-sans text-xs2 leading-4 text-text-secondary" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {canCallBack ? (
          <SafeTouchableOpacity
            className="ml-3 h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-bg-primary"
            onPress={() => onCallBack?.(callLog.callType)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={callLog.callType === 'VIDEO' ? 'Video call back' : 'Call back'}
          >
            <MaterialIcons
              name={callLog.callType === 'VIDEO' ? 'videocam' : 'call'}
              size={16}
              color={colors.brand.primary}
            />
          </SafeTouchableOpacity>
        ) : null}
      </View>
    </View>
  )
}
