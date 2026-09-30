import { MaterialIcons } from '@expo/vector-icons'
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
  icon: keyof typeof MaterialIcons.glyphMap
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
        className="h-10 w-10 items-center justify-center rounded-full"
        style={[
          // Idle state mirrors the peach accent tiles used across chat and
          // the warm input family on auth; busy keeps the solid brand fill.
          {
            backgroundColor: busy ? colors.bubble.outgoing : colors.surface.accent,
          },
          animatedStyle,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={colors.text.inverse} size="small" />
        ) : (
          <MaterialIcons name={icon} size={21} color={colors.brand.primary} />
        )}
      </Animated.View>
    </AppPressable>
  )
}

type ConversationHeaderProps = {
  activeGroupCall?: {
    participantCount: number
    elapsedSeconds: number
    action: 'join' | 'rejoin' | 'return' | 'wait'
    canOpen: boolean
  } | null
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
  showVideoCallAction: boolean
  onBack: () => void
  onOpenGroupInfo: () => void
  onOpenActiveGroupCall: () => void
  openingActiveCall: boolean
  onStartVideoCall: () => void
  onStartVoiceCall: () => void
  onSelectGroupCallMembers: () => void
}

export const ConversationHeader = ({
  activeGroupCall,
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
  showVideoCallAction,
  onBack,
  onOpenGroupInfo,
  onOpenActiveGroupCall,
  openingActiveCall,
  onStartVideoCall,
  onStartVoiceCall,
  onSelectGroupCallMembers,
}: ConversationHeaderProps) => {
  const subtitleColor = groupTypingLabel
    ? colors.brand.primary
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
            {isGroup ? (
              <CallActionButton
                onPress={onSelectGroupCallMembers}
                disabled={callActionsDisabled}
                busy={false}
                icon="person-add"
                accessibilityLabel={`Choose members to call in ${displayName}`}
              />
            ) : null}
            {showVideoCallAction ? (
              <CallActionButton
                onPress={onStartVideoCall}
                disabled={callActionsDisabled}
                busy={pendingCallType === 'VIDEO'}
                icon="videocam"
                accessibilityLabel={
                  pendingCallType === 'VIDEO'
                    ? `Starting video call with ${displayName}`
                    : `Video call ${displayName}`
                }
              />
            ) : null}
            <CallActionButton
              onPress={onStartVoiceCall}
              disabled={callActionsDisabled}
              busy={pendingCallType === 'VOICE'}
              icon="call"
              accessibilityLabel={
                pendingCallType === 'VOICE'
                  ? `Starting voice call with ${displayName}`
                  : `Call ${displayName}`
              }
            />
          </View>
        ) : null}
      </View>

      {activeGroupCall ? (
        <AppPressable
          className="mt-2 min-h-12 flex-row items-center gap-2 rounded-[14px] border border-brand-soft bg-surface-accent px-3"
          activeOpacity={0.72}
          onPress={onOpenActiveGroupCall}
          disabled={openingActiveCall || !activeGroupCall.canOpen}
          accessibilityRole="button"
          accessibilityLabel={`${activeGroupCall.action === 'join' ? 'Join' : activeGroupCall.action === 'rejoin' ? 'Rejoin' : activeGroupCall.action === 'return' ? 'Return to' : 'Waiting to reconnect to'} group call, ${activeGroupCall.participantCount} participants, ${Math.floor(activeGroupCall.elapsedSeconds / 60)} minutes ${activeGroupCall.elapsedSeconds % 60} seconds elapsed`}
          accessibilityState={{
            busy: openingActiveCall,
            disabled: openingActiveCall || !activeGroupCall.canOpen,
          }}
        >
          {openingActiveCall ? (
            <ActivityIndicator size="small" color={colors.brand.primary} />
          ) : (
            <MaterialIcons name="call" size={20} color={colors.brand.primary} accessible={false} />
          )}
          <AppText className="flex-1 text-sm2 font-semibold text-text-primary" numberOfLines={2}>
            Group call in progress · {activeGroupCall.participantCount} in call
          </AppText>
          {activeGroupCall.action === 'join' || activeGroupCall.action === 'rejoin' ? (
            <AppText className="text-xs2 font-semibold text-text-primary">
              {activeGroupCall.action === 'rejoin' ? 'Rejoin' : 'Join'}
            </AppText>
          ) : null}
          <AppText className="text-xs2 text-text-primary">
            {Math.floor(activeGroupCall.elapsedSeconds / 60)}:
            {String(activeGroupCall.elapsedSeconds % 60).padStart(2, '0')}
          </AppText>
          {activeGroupCall.canOpen ? (
            <MaterialIcons
              name="chevron-right"
              size={20}
              color={colors.text.secondary}
              accessible={false}
            />
          ) : null}
        </AppPressable>
      ) : null}

      {!isConnected ? (
        <View className="mt-2.5 flex-row items-center gap-2.5 rounded-[14px] border border-brand-soft bg-surface-accent px-3.5 py-2.5">
          <MaterialIcons name="cloud-off" size={17} color={colors.brand.primary} />
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
