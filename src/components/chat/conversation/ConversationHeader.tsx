import { Ionicons, MaterialIcons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { ActivityIndicator, Image, Text, TouchableOpacity, View } from 'react-native'
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'

import { colors } from '../../../constants/theme'
import { AppPressable } from '../../base/AppPressable'

type CallActionButtonProps = {
  accessibilityLabel: string
  busy: boolean
  disabled: boolean
  icon: keyof typeof Ionicons.glyphMap
  onPress: () => void
}

function CallActionButton({
  accessibilityLabel,
  busy,
  disabled,
  icon,
  onPress,
}: CallActionButtonProps) {
  const scale = useSharedValue(1)
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))

  return (
    <AppPressable
      className="h-12 w-12 items-center justify-center"
      activeOpacity={1}
      disabled={disabled}
      hitSlop={0}
      onPress={() => {
        void Haptics.selectionAsync()
        onPress()
      }}
      onPressIn={() => {
        scale.value = withTiming(0.9, { duration: 80, reduceMotion: ReduceMotion.System })
      }}
      onPressOut={() => {
        scale.value = withSpring(1, {
          damping: 18,
          stiffness: 360,
          reduceMotion: ReduceMotion.System,
        })
      }}
      style={{ opacity: disabled && !busy ? 0.38 : 1 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy }}
    >
      <Animated.View
        className="h-11 w-11 items-center justify-center rounded-full"
        style={[
          {
            backgroundColor: busy ? colors.bubble.outgoing : colors.surface.accent,
          },
          animatedStyle,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={colors.text.inverse} size="small" />
        ) : (
          <Ionicons name={icon} size={22} color={colors.brand.tertiary} />
        )}
      </Animated.View>
    </AppPressable>
  )
}

type ConversationHeaderProps = {
  avatarUrl?: string
  callActionsDisabled: boolean
  displayName: string
  groupTypingLabel: string | null
  isConnected: boolean
  isGroup: boolean
  isOnline: boolean
  participantCount: number
  pendingCallType: 'VOICE' | 'VIDEO' | null
  presenceLabel: string
  queuedMessageCount: number
  showCallActions: boolean
  onBack: () => void
  onOpenGroupInfo: () => void
  onStartVideoCall: () => void
  onStartVoiceCall: () => void
}

export const ConversationHeader = ({
  avatarUrl,
  callActionsDisabled,
  displayName,
  groupTypingLabel,
  isConnected,
  isGroup,
  isOnline,
  participantCount,
  pendingCallType,
  presenceLabel,
  queuedMessageCount,
  showCallActions,
  onBack,
  onOpenGroupInfo,
  onStartVideoCall,
  onStartVoiceCall,
}: ConversationHeaderProps) => {
  return (
    <View className="border-b border-border-light bg-bg-primary px-4 pb-3 pt-2 z-10">
      <View className="flex-row items-center">
        <TouchableOpacity
          onPress={onBack}
          className="h-11 w-11 items-center justify-center"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <MaterialIcons name="chevron-left" size={24} color="#161616" />
        </TouchableOpacity>

        <TouchableOpacity
          className="ml-1.5 flex-1 flex-row items-center"
          disabled={!isGroup}
          onPress={onOpenGroupInfo}
          activeOpacity={isGroup ? 0.72 : 1}
          accessibilityRole={isGroup ? 'button' : undefined}
          accessibilityLabel={isGroup ? 'Open group info' : undefined}
        >
          <View className="relative">
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} className="h-11 w-11 rounded-full" />
            ) : (
              <View className="h-11 w-11 items-center justify-center rounded-full bg-surface-input">
                <Text className="text-sm2 font-medium text-text-primary">
                  {displayName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}

            {!isGroup && isOnline ? (
              <View className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-bg-primary bg-status-online" />
            ) : null}
          </View>

          <View className="ml-3 flex-1 pr-4">
            <Text className="font-semibold text-md text-text-primary" numberOfLines={1}>
              {displayName}
            </Text>
            {!isGroup ? (
              <Text className="mt-0.5 text-xs2 text-text-muted" numberOfLines={1}>
                {presenceLabel}
              </Text>
            ) : (
              <Text className="mt-0.5 text-xs2 text-text-muted" numberOfLines={1}>
                {groupTypingLabel ??
                  `${participantCount} member${participantCount === 1 ? '' : 's'}`}
              </Text>
            )}
          </View>
        </TouchableOpacity>

        {showCallActions ? (
          <View className="flex-row items-center gap-2">
            <CallActionButton
              onPress={onStartVideoCall}
              disabled={callActionsDisabled}
              busy={pendingCallType === 'VIDEO'}
              icon="videocam-outline"
              accessibilityLabel={
                pendingCallType === 'VIDEO'
                  ? `Starting video call with ${displayName}`
                  : `Video call ${displayName}`
              }
            />
            <CallActionButton
              onPress={onStartVoiceCall}
              disabled={callActionsDisabled}
              busy={pendingCallType === 'VOICE'}
              icon="call-outline"
              accessibilityLabel={
                pendingCallType === 'VOICE'
                  ? `Starting voice call with ${displayName}`
                  : `Call ${displayName}`
              }
            />
          </View>
        ) : null}
      </View>

      {!isConnected ? (
        <View className="mt-3 rounded-[20px] border border-border-light bg-surface-accent px-4 py-3">
          <Text className="text-xs2 uppercase tracking-[1.1px] text-brand">Connection status</Text>
          <Text className="mt-1 text-sm2 leading-5 text-text-primary">
            {queuedMessageCount > 0
              ? `${queuedMessageCount} message${queuedMessageCount > 1 ? 's are' : ' is'} waiting to send when chat reconnects.`
              : 'Chat is reconnecting. New messages will wait and send automatically.'}
          </Text>
        </View>
      ) : null}
    </View>
  )
}
