import { MaterialIcons } from '@expo/vector-icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Image, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { conversationApi } from '../../../src/api/conversation.api'
import { AppPressable, AppText, AppTextInput } from '../../../src/components/base'
import { SafeTouchableOpacity } from '../../../src/components/common/SafeTouchableOpacity'
import { queryKeys } from '../../../src/constants/queryKeys'
import { useFriends } from '../../../src/hooks/useFriends'
import { useAuthStore } from '../../../src/stores/authStore'

import type { Conversation, ConversationMember } from '../../../src/types/conversation.types'
import type { FriendSummary } from '../../../src/types/friend.types'

const getFriendName = (friend: FriendSummary) =>
  friend.user.fullName || friend.user.username || 'Velora user'

export default function GroupInfoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const conversationId = id as string
  const router = useRouter()
  const queryClient = useQueryClient()
  const currentUserId = useAuthStore((state) => state.user?.id)
  const cachedConversation = queryClient
    .getQueryData<Conversation[] | undefined>(queryKeys.conversations.all)
    ?.find((item) => item.id === conversationId)
  const { data: conversation, isLoading: isConversationLoading } = useQuery({
    queryKey: queryKeys.conversations.detail(conversationId),
    queryFn: () => conversationApi.getById(conversationId),
    initialData: cachedConversation,
  })
  const { data: members = [], isLoading: areMembersLoading } = useQuery({
    queryKey: queryKeys.conversations.members(conversationId),
    queryFn: () => conversationApi.getMembers(conversationId),
    enabled: Boolean(conversation?.isGroup),
  })
  const isOwner = Boolean(currentUserId && conversation?.creatorId === currentUserId)
  const { data: friends = [] } = useFriends(undefined, { enabled: isOwner })
  const [isEditingName, setIsEditingName] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [showAddMembers, setShowAddMembers] = useState(false)

  const applyConversation = (nextConversation: Conversation) => {
    queryClient.setQueryData(queryKeys.conversations.detail(conversationId), nextConversation)
    queryClient.setQueryData<Conversation[] | undefined>(queryKeys.conversations.all, (oldData) =>
      Array.isArray(oldData)
        ? oldData.map((item) => (item.id === nextConversation.id ? nextConversation : item))
        : oldData,
    )
  }

  const refreshConversation = async () => {
    const nextConversation = await conversationApi.getById(conversationId)
    applyConversation(nextConversation)
    await queryClient.invalidateQueries({
      queryKey: queryKeys.conversations.members(conversationId),
    })
    return nextConversation
  }

  const renameGroup = useMutation({
    mutationFn: (nextName: string) =>
      conversationApi.updateGroup(conversationId, { name: nextName }),
    onSuccess: (nextConversation) => {
      applyConversation(nextConversation)
      setIsEditingName(false)
    },
    onError: (error) =>
      Alert.alert(
        'Unable to rename group',
        error instanceof Error ? error.message : 'Please try again.',
      ),
  })

  const addMember = useMutation({
    mutationFn: async (userId: string) => {
      await conversationApi.addMember(conversationId, { userId })
      await refreshConversation()
    },
    onError: (error) =>
      Alert.alert(
        'Unable to add member',
        error instanceof Error ? error.message : 'Please try again.',
      ),
  })

  const removeMember = useMutation({
    mutationFn: async (userId: string) => {
      await conversationApi.removeMember(conversationId, userId)
      await refreshConversation()
    },
    onError: (error) =>
      Alert.alert(
        'Unable to remove member',
        error instanceof Error ? error.message : 'Please try again.',
      ),
  })

  const leaveGroup = useMutation({
    mutationFn: () => conversationApi.leave(conversationId),
    onSuccess: () => {
      queryClient.setQueryData<Conversation[] | undefined>(
        queryKeys.conversations.all,
        (oldData) =>
          Array.isArray(oldData) ? oldData.filter((item) => item.id !== conversationId) : oldData,
      )
      queryClient.removeQueries({ queryKey: queryKeys.conversations.detail(conversationId) })
      queryClient.removeQueries({ queryKey: queryKeys.conversations.members(conversationId) })
      queryClient.removeQueries({ queryKey: queryKeys.conversations.messages(conversationId) })
      router.replace('/')
    },
    onError: (error) =>
      Alert.alert(
        'Unable to leave group',
        error instanceof Error ? error.message : 'Please try again.',
      ),
  })

  const participantById = useMemo(
    () =>
      new Map(
        (conversation?.participants ?? []).map((participant) => [participant.id, participant]),
      ),
    [conversation?.participants],
  )
  const memberIds = useMemo(() => new Set(members.map((member) => member.userId)), [members])
  const addCandidates = useMemo(
    () => friends.filter((friend) => !memberIds.has(friend.user.id)),
    [friends, memberIds],
  )

  if (isConversationLoading || !conversation) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-bg-primary">
        <ActivityIndicator color="#FF6B2C" />
      </SafeAreaView>
    )
  }

  if (!conversation.isGroup) {
    return (
      <SafeAreaView className="flex-1 bg-bg-primary">
        <View className="flex-row items-center border-b border-border-light px-3 py-2">
          <SafeTouchableOpacity
            className="h-11 w-11 items-center justify-center"
            onPress={() => router.back()}
          >
            <MaterialIcons name="chevron-left" size={26} color="#161616" />
          </SafeTouchableOpacity>
          <AppText className="font-semibold text-text-primary">Conversation info</AppText>
        </View>
        <View className="flex-1 items-center justify-center px-6">
          <AppText className="text-center text-text-secondary">
            This conversation is not a group.
          </AppText>
        </View>
      </SafeAreaView>
    )
  }

  const groupName = conversation.name?.trim() || 'Group Chat'
  const memberCount = members.length || conversation.participantIds.length

  const confirmRemoveMember = (member: ConversationMember) => {
    const participant = participantById.get(member.userId)
    const name =
      participant?.name || participant?.fullName || participant?.email || member.user.email
    Alert.alert('Remove member?', `${name} will lose access to this group.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeMember.mutate(member.userId) },
    ])
  }

  const confirmLeave = () => {
    Alert.alert('Leave group?', 'You will no longer receive messages from this group.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => leaveGroup.mutate() },
    ])
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      <View className="flex-row items-center border-b border-border-light px-3 py-2">
        <SafeTouchableOpacity
          className="h-11 w-11 items-center justify-center"
          onPress={() => router.back()}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <MaterialIcons name="chevron-left" size={26} color="#161616" />
        </SafeTouchableOpacity>
        <AppText className="flex-1 text-md font-semibold text-text-primary">Group info</AppText>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View className="items-center px-5 pb-6 pt-7">
          {conversation.picture ? (
            <Image source={{ uri: conversation.picture }} className="h-24 w-24 rounded-full" />
          ) : (
            <View className="h-24 w-24 items-center justify-center rounded-full bg-surface-input">
              <AppText className="text-[28px] font-semibold text-text-primary">
                {groupName.charAt(0).toUpperCase()}
              </AppText>
            </View>
          )}

          {isEditingName ? (
            <View className="mt-4 w-full">
              <AppTextInput
                value={draftName}
                onChangeText={setDraftName}
                maxLength={80}
                autoFocus
                className="h-12 rounded-[16px] border border-border-light bg-surface-card px-4 text-center text-base2 text-text-primary"
              />
              <View className="mt-3 flex-row justify-center gap-2">
                <AppPressable
                  className="rounded-full bg-surface-input px-4 py-2.5"
                  onPress={() => setIsEditingName(false)}
                >
                  <AppText className="font-medium text-text-primary">Cancel</AppText>
                </AppPressable>
                <AppPressable
                  className="rounded-full bg-brand px-4 py-2.5"
                  disabled={!draftName.trim() || renameGroup.isPending}
                  onPress={() => renameGroup.mutate(draftName.trim())}
                >
                  <AppText className="font-semibold text-white">Save</AppText>
                </AppPressable>
              </View>
            </View>
          ) : (
            <View className="mt-4 items-center">
              <View className="flex-row items-center">
                <AppText className="text-xl font-semibold text-text-primary">{groupName}</AppText>
                {isOwner ? (
                  <SafeTouchableOpacity
                    className="ml-2 h-8 w-8 items-center justify-center rounded-full bg-surface-input"
                    onPress={() => {
                      setDraftName(groupName)
                      setIsEditingName(true)
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Rename group"
                  >
                    <MaterialIcons name="edit" size={16} color="#161616" />
                  </SafeTouchableOpacity>
                ) : null}
              </View>
              <AppText className="mt-1 text-sm2 text-text-muted">
                {memberCount} member{memberCount === 1 ? '' : 's'}
              </AppText>
            </View>
          )}
        </View>

        <View className="border-t border-border-light">
          <View className="flex-row items-center justify-between px-5 py-4">
            <AppText className="text-xs uppercase tracking-[1.2px] text-text-muted">
              Members
            </AppText>
            {isOwner ? (
              <SafeTouchableOpacity
                className="flex-row items-center rounded-full bg-surface-input px-3 py-2"
                onPress={() => setShowAddMembers((value) => !value)}
                activeOpacity={0.75}
              >
                <MaterialIcons name="person-add" size={17} color="#161616" />
                <AppText className="ml-1.5 text-xs2 font-medium text-text-primary">Add</AppText>
              </SafeTouchableOpacity>
            ) : null}
          </View>

          {showAddMembers && isOwner ? (
            <View className="border-b border-border-light bg-surface-card px-5 pb-3">
              <AppText className="mb-2 text-xs2 text-text-muted">
                Friends not already in this group
              </AppText>
              {addCandidates.length === 0 ? (
                <AppText className="py-3 text-sm2 text-text-secondary">
                  No friends available to add.
                </AppText>
              ) : (
                addCandidates.map((item) => {
                  const name = getFriendName(item)
                  return (
                    <View key={item.user.id} className="flex-row items-center py-2.5">
                      {item.user.picture ? (
                        <Image
                          source={{ uri: item.user.picture }}
                          className="h-9 w-9 rounded-full"
                        />
                      ) : (
                        <View className="h-9 w-9 items-center justify-center rounded-full bg-surface-input">
                          <AppText className="text-xs2 font-medium text-text-primary">
                            {name.charAt(0).toUpperCase()}
                          </AppText>
                        </View>
                      )}
                      <AppText
                        className="ml-3 flex-1 font-medium text-text-primary"
                        numberOfLines={1}
                      >
                        {name}
                      </AppText>
                      <AppPressable
                        className="rounded-full bg-brand px-3 py-2"
                        disabled={addMember.isPending}
                        onPress={() => addMember.mutate(item.user.id)}
                      >
                        <AppText className="text-xs2 font-semibold text-white">Add</AppText>
                      </AppPressable>
                    </View>
                  )
                })
              )}
            </View>
          ) : null}

          {areMembersLoading ? (
            <View className="items-center py-8">
              <ActivityIndicator color="#FF6B2C" />
            </View>
          ) : (
            members.map((member) => {
              const participant = participantById.get(member.userId)
              const displayName =
                participant?.name ||
                participant?.fullName ||
                participant?.email ||
                member.user.email
              const picture = participant?.picture || member.user.picture || undefined
              const memberIsOwner = member.userId === conversation.creatorId
              const canRemove = isOwner && !memberIsOwner && memberCount > 2

              return (
                <View
                  key={member.userId}
                  className="flex-row items-center border-b border-border-light px-5 py-3.5"
                >
                  {picture ? (
                    <Image source={{ uri: picture }} className="h-11 w-11 rounded-full" />
                  ) : (
                    <View className="h-11 w-11 items-center justify-center rounded-full bg-surface-input">
                      <AppText className="font-medium text-text-primary">
                        {displayName.charAt(0).toUpperCase()}
                      </AppText>
                    </View>
                  )}
                  <View className="ml-3 flex-1">
                    <View className="flex-row items-center">
                      <AppText className="font-medium text-text-primary" numberOfLines={1}>
                        {member.userId === currentUserId ? 'You' : displayName}
                      </AppText>
                      {memberIsOwner ? (
                        <View className="ml-2 rounded-full bg-surface-accent px-2 py-1">
                          <AppText className="text-[10px] font-medium text-brand">Owner</AppText>
                        </View>
                      ) : null}
                    </View>
                    <AppText className="mt-0.5 text-xs2 text-text-muted" numberOfLines={1}>
                      {member.user.email}
                    </AppText>
                  </View>
                  {canRemove ? (
                    <SafeTouchableOpacity
                      className="h-9 w-9 items-center justify-center rounded-full bg-surface-input"
                      onPress={() => confirmRemoveMember(member)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${displayName}`}
                    >
                      <MaterialIcons name="person-remove" size={18} color="#D84A3A" />
                    </SafeTouchableOpacity>
                  ) : null}
                </View>
              )
            })
          )}
        </View>

        <View className="px-5 pt-6">
          {isOwner ? (
            <View className="rounded-[18px] border border-border-light bg-surface-card px-4 py-3.5">
              <AppText className="text-sm2 font-medium text-text-primary">
                You own this group
              </AppText>
              <AppText className="mt-1 text-xs2 leading-5 text-text-muted">
                Ownership transfer is not available yet, so the owner cannot leave the group.
              </AppText>
            </View>
          ) : (
            <AppPressable
              className="items-center rounded-[18px] border border-[#F2C8C2] bg-[#FFF4F1] px-4 py-3.5"
              disabled={leaveGroup.isPending}
              onPress={confirmLeave}
              activeOpacity={0.8}
            >
              <AppText className="font-semibold text-[#C23C2C]">Leave group</AppText>
            </AppPressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
