import { MaterialIcons } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import { Image } from 'expo-image'
import React, { useMemo } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useConversations } from '../../hooks/useConversations'
import { useCreateReelShareLink, useShareReel } from '../../hooks/useReels'
import { getInitials } from '../../lib/profile'
import { useAuthStore } from '../../stores/authStore'
import { useChatStore } from '../../stores/chatStore'

import type { Conversation } from '../../types/conversation.types'
import type { Reel } from '../../types/reel.types'

interface ReelShareSheetProps {
  visible: boolean
  reel: Reel
  onClose: () => void
}

type ShareTarget = {
  conversation: Conversation
  id: string
  label: string
  isBotTarget?: boolean
  avatarUrl?: string | null
  sharedWithUserId?: string
}

const BOT_USER_ID = process.env.EXPO_PUBLIC_BOT_USER_ID

const getErrorMessage = (error: unknown) => {
  const apiMessage = (error as { response?: { data?: { message?: string } } })?.response?.data
    ?.message

  return apiMessage || (error instanceof Error ? error.message : 'Could not share this reel.')
}

const getConversationLabel = (conversation: Conversation, currentUserId?: string) => {
  if (conversation.isGroup) {
    return conversation.name?.trim() || 'Group chat'
  }

  const otherParticipant = conversation.participants?.find(
    (participant) => participant.id !== currentUserId,
  )

  return otherParticipant?.name?.trim() || otherParticipant?.email || conversation.name || 'Chat'
}

const getConversationAvatar = (conversation: Conversation, currentUserId?: string) => {
  if (conversation.isGroup) {
    return conversation.picture
  }

  return conversation.participants?.find((participant) => participant.id !== currentUserId)?.picture
}

const getDirectShareTargetUserId = (conversation: Conversation, currentUserId?: string) => {
  if (conversation.isGroup) {
    return null
  }

  return (
    conversation.participantIds.find((participantId) => participantId !== currentUserId) ??
    conversation.participants?.find((participant) => participant.id !== currentUserId)?.id ??
    null
  )
}

const isBotParticipant = (participant: {
  email?: string
  fullName?: string
  id?: string
  name?: string
}) => {
  const normalizedEmail = participant.email?.trim().toLowerCase()
  const normalizedName = (participant.name ?? participant.fullName)?.trim().toLowerCase()

  return (
    Boolean(BOT_USER_ID && participant.id === BOT_USER_ID) ||
    normalizedEmail === 'bot@system.local' ||
    normalizedName === 'system_bot' ||
    normalizedName === 'velora bot'
  )
}

const conversationIncludesBot = (conversation: Conversation) =>
  Boolean(BOT_USER_ID && conversation.participantIds.includes(BOT_USER_ID)) ||
  Boolean(conversation.participants?.some(isBotParticipant))

export function ReelShareSheet({ visible, reel, onClose }: ReelShareSheetProps) {
  const insets = useSafeAreaInsets()
  const currentUserId = useAuthStore((state) => state.user?.id)
  const isBotConversation = useChatStore((state) => state.isBotConversation)
  const { data: conversations = [], isPending: isLoadingConversations } = useConversations()
  const createShareLink = useCreateReelShareLink()
  const shareReel = useShareReel()
  const canShare = reel.status === 'COMPLETED'

  const targets = useMemo<ShareTarget[]>(() => {
    return conversations.flatMap((conversation) => {
      const isBotTarget =
        isBotConversation(conversation.id) || conversationIncludesBot(conversation)
      const directTargetUserId = getDirectShareTargetUserId(conversation, currentUserId)

      if (!isBotTarget && !directTargetUserId) {
        return []
      }

      const avatarUrl = getConversationAvatar(conversation, currentUserId)
      const target: ShareTarget = {
        conversation,
        id: conversation.id,
        ...(isBotTarget ? { isBotTarget: true } : {}),
        label: getConversationLabel(conversation, currentUserId),
        ...(avatarUrl ? { avatarUrl } : {}),
        ...(!isBotTarget && directTargetUserId ? { sharedWithUserId: directTargetUserId } : {}),
      }

      return [target]
    })
  }, [conversations, currentUserId, isBotConversation])

  const shareTitle = reel.title?.trim() || 'Velora reel'

  const createPublicUrl = async () => {
    const link = await createShareLink.mutateAsync({ id: reel.id })

    if (!link.publicUrl) {
      throw new Error('Share link was not returned.')
    }

    return link.publicUrl
  }

  const handleNativeShare = async () => {
    if (!canShare || createShareLink.isPending) {
      return
    }

    try {
      const publicUrl = await createPublicUrl()
      await Share.share(
        Platform.OS === 'ios'
          ? {
              url: publicUrl,
            }
          : {
              message: publicUrl,
            },
      )
    } catch (error) {
      Alert.alert('Share unavailable', getErrorMessage(error))
    }
  }

  const handleCopyLink = async () => {
    if (!canShare || createShareLink.isPending) {
      return
    }

    try {
      const publicUrl = await createPublicUrl()
      await Clipboard.setStringAsync(publicUrl)
      Alert.alert('Link copied', 'The reel link is ready to paste.')
    } catch (error) {
      Alert.alert('Copy unavailable', getErrorMessage(error))
    }
  }

  const handleShareToConversation = (target: ShareTarget) => {
    if (!canShare || shareReel.isPending) {
      return
    }

    shareReel.mutate(
      {
        id: reel.id,
        data: {
          conversationId: target.conversation.id,
          ...(!target.isBotTarget && target.sharedWithUserId
            ? { sharedWithUserId: target.sharedWithUserId }
            : {}),
        },
        reel,
      },
      {
        onSuccess: () => {
          Alert.alert('Reel shared', `Sent to ${target.label}.`)
          onClose()
        },
        onError: (error) => {
          Alert.alert('Share unavailable', getErrorMessage(error))
        },
      },
    )
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={StyleSheet.absoluteFillObject} className="justify-end">
        <Pressable
          onPress={onClose}
          style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(8, 8, 10, 0.46)' }]}
        />

        <View
          className="rounded-t-[32px] bg-white px-5 pt-3"
          style={{
            paddingBottom: Math.max(insets.bottom, 18),
            shadowColor: 'rgba(22, 22, 22, 0.2)',
            shadowOffset: { width: 0, height: -8 },
            shadowOpacity: 1,
            shadowRadius: 24,
            elevation: 18,
          }}
        >
          <View className="items-center pb-2">
            <View className="h-1.5 w-14 rounded-full bg-[#D9D9D9]" />
          </View>

          <View className="mt-3 flex-row items-start justify-between">
            <View className="flex-1 pr-4">
              <Text className="font-heading text-xl text-text-primary">Share reel</Text>
              <Text className="mt-1 text-base2 text-text-secondary" numberOfLines={1}>
                {shareTitle}
              </Text>
            </View>

            <TouchableOpacity
              className="h-11 w-11 items-center justify-center rounded-full bg-surface-muted"
              activeOpacity={0.84}
              onPress={onClose}
            >
              <MaterialIcons name="close" size={20} color="#161616" />
            </TouchableOpacity>
          </View>

          <View className="mt-5 flex-row gap-3">
            <TouchableOpacity
              className="h-[76px] flex-1 items-center justify-center rounded-[24px] bg-surface-muted"
              activeOpacity={0.84}
              disabled={!canShare || createShareLink.isPending}
              onPress={handleNativeShare}
            >
              {createShareLink.isPending ? (
                <ActivityIndicator color="#FF6B2C" size="small" />
              ) : (
                <MaterialIcons name="ios-share" size={22} color="#161616" />
              )}
              <Text className="mt-2 text-sm2 font-medium text-text-primary">Share link</Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="h-[76px] flex-1 items-center justify-center rounded-[24px] bg-surface-muted"
              activeOpacity={0.84}
              disabled={!canShare || createShareLink.isPending}
              onPress={handleCopyLink}
            >
              <MaterialIcons name="content-copy" size={22} color="#161616" />
              <Text className="mt-2 text-sm2 font-medium text-text-primary">Copy link</Text>
            </TouchableOpacity>
          </View>

          <View className="mt-6">
            <Text className="mb-3 text-xs2 uppercase tracking-[1.1px] text-text-muted">
              Conversations
            </Text>

            {!canShare ? (
              <View className="rounded-[24px] bg-surface-muted px-4 py-4">
                <Text className="text-sm2 text-text-secondary">
                  This reel can be shared after processing finishes.
                </Text>
              </View>
            ) : isLoadingConversations ? (
              <View className="items-center rounded-[24px] bg-surface-muted px-4 py-5">
                <ActivityIndicator color="#FF6B2C" size="small" />
              </View>
            ) : targets.length === 0 ? (
              <View className="rounded-[24px] bg-surface-muted px-4 py-4">
                <Text className="text-sm2 text-text-secondary">
                  Start a direct chat to share reels in messages.
                </Text>
              </View>
            ) : (
              <View className="max-h-[280px] gap-2">
                {targets.map((target) => {
                  const initials = getInitials(target.label)
                  const isSharingToTarget =
                    shareReel.isPending &&
                    shareReel.variables?.data.conversationId === target.conversation.id

                  return (
                    <TouchableOpacity
                      key={target.id}
                      className="flex-row items-center rounded-[24px] bg-surface-muted px-4 py-3"
                      activeOpacity={0.84}
                      disabled={shareReel.isPending}
                      onPress={() => handleShareToConversation(target)}
                    >
                      {target.avatarUrl ? (
                        <Image
                          source={{ uri: target.avatarUrl }}
                          contentFit="cover"
                          style={{ width: 44, height: 44, borderRadius: 22 }}
                        />
                      ) : (
                        <View className="h-11 w-11 items-center justify-center rounded-full bg-white">
                          <Text className="font-heading text-sm text-text-primary">{initials}</Text>
                        </View>
                      )}

                      <View className="ml-3 flex-1">
                        <Text className="font-medium text-md text-text-primary" numberOfLines={1}>
                          {target.label}
                        </Text>
                        <Text className="mt-0.5 text-sm2 text-text-secondary" numberOfLines={1}>
                          Send as a reel message
                        </Text>
                      </View>

                      {isSharingToTarget ? (
                        <ActivityIndicator color="#FF6B2C" size="small" />
                      ) : (
                        <MaterialIcons name="send" size={20} color="#FF6B2C" />
                      )}
                    </TouchableOpacity>
                  )
                })}
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  )
}
