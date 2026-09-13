import { Ionicons, MaterialIcons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { ActivityIndicator, View } from 'react-native'
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'

import { colors } from '../../../constants/theme'
import { AppPressable, AppText } from '../../base'
import { ChatAvatar } from '../ChatAvatar'

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
      className="h-11 w-11 items-center justify-center"
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
        className="h-10 w-10 items-center justify-center rounded-full"
        style={[
          {
            backgroundColor: busy ? colors.bubble.outgoing : colors.surface.input,
          },
          animatedStyle,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={colors.text.inverse} size="small" />
        ) : (
          <Ionicons name={icon} size={21} color={colors.text.primary} />
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
  const subtitleColor = groupTypingLabel
    ? colors.brand.tertiary
    : !isGroup && isOnline
      ? colors.status.online
      : colors.text.tertiary

  return (
    <View className="z-10 border-b border-border-light bg-bg-primary px-2 pb-2.5 pt-1">
      <View className="flex-row items-center">
        <AppPressable
          className="h-11 w-11 items-center justify-center rounded-full"
          onPress={onBack}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <MaterialIcons name="chevron-left" size={26} color={colors.text.primary} />
        </AppPressable>

        <AppPressable
          className="ml-1 flex-1 flex-row items-center"
          disabled={!isGroup}
          onPress={onOpenGroupInfo}
          activeOpacity={isGroup ? 0.72 : 1}
          accessibilityRole={isGroup ? 'button' : undefined}
          accessibilityLabel={isGroup ? 'Open group info' : undefined}
        >
          <ChatAvatar
            name={displayName}
            picture={avatarUrl}
            size={44}
            isOnline={!isGroup && isOnline}
          />

          <View className="ml-2.5 min-w-0 flex-1 pr-3">
            <AppText className="text-md font-semibold text-text-primary" numberOfLines={1}>
              {displayName}
            </AppText>
            <AppText
              className={groupTypingLabel ? 'text-xs2 font-medium' : 'text-xs2'}
              style={{ color: subtitleColor }}
              numberOfLines={1}
            >
              {!isGroup
                ? presenceLabel
                : (groupTypingLabel ??
                  `${participantCount} member${participantCount === 1 ? '' : 's'}`)}
            </AppText>
          </View>
        </AppPressable>

        {showCallActions ? (
          <View className="flex-row items-center gap-1">
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
        <View className="mt-2.5 flex-row items-center gap-2.5 rounded-[14px] border border-brand-soft bg-surface-accent px-3.5 py-2.5">
          <Ionicons name="cloud-offline" size={17} color={colors.brand.tertiary} />
          <AppText className="flex-1 text-sm2 leading-[18px] text-text-primary">
            {queuedMessageCount > 0
              ? `Reconnecting — ${queuedMessageCount} message${queuedMessageCount > 1 ? 's are' : ' is'} waiting to send.`
              : 'Reconnecting — new messages will send automatically.'}
          </AppText>
        </View>
      ) : null}
    </View>
  )
}
