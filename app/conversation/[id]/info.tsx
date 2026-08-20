import { MaterialIcons } from '@expo/vector-icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as ImagePicker from 'expo-image-picker'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { conversationApi } from '../../../src/api/conversation.api'
import { mediaApi } from '../../../src/api/media.api'
import { AppPressable, AppText, AppTextInput } from '../../../src/components/base'
import { SafeTouchableOpacity } from '../../../src/components/common/SafeTouchableOpacity'
import { queryKeys } from '../../../src/constants/queryKeys'
import { removeConversationLocalData } from '../../../src/database/conversationBootstrap'
import { useFriends } from '../../../src/hooks/useFriends'
import { useAuthStore } from '../../../src/stores/authStore'
import { useChatStore } from '../../../src/stores/chatStore'

import type {
  Conversation,
  ConversationMember,
  ConversationMemberRole,
} from '../../../src/types/conversation.types'
import type { FriendSummary } from '../../../src/types/friend.types'

const getFriendName = (friend: FriendSummary) =>
  friend.user.fullName || friend.user.username || 'Velora user'

const getMemberDisplayName = (
  member: ConversationMember,
  participant?: Conversation['participants'] extends (infer T)[] | undefined ? T : never,
) =>
  participant?.name ||
  participant?.fullName ||
  participant?.email ||
  member.user.fullName ||
  member.user.username ||
  member.user.email ||
  'Velora user'

type GroupPictureMimeType = 'image/jpeg' | 'image/png' | 'image/webp'

const resolveGroupPictureMimeType = (
  asset: ImagePicker.ImagePickerAsset,
): GroupPictureMimeType | null => {
  const mimeType = asset.mimeType?.toLowerCase()
  if (mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp') {
    return mimeType
  }

  const source = `${asset.fileName ?? ''} ${asset.uri}`.toLowerCase()
  if (/\.jpe?g(?:\?|$)/.test(source)) return 'image/jpeg'
  if (/\.png(?:\?|$)/.test(source)) return 'image/png'
  if (/\.webp(?:\?|$)/.test(source)) return 'image/webp'
  return null
}

const roleLabel = (role: ConversationMemberRole) =>
  role === 'OWNER' ? 'Owner' : role === 'ADMIN' ? 'Admin' : 'Member'

export default function GroupInfoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const conversationId = id as string
  const router = useRouter()
  const queryClient = useQueryClient()
  const currentUserId = useAuthStore((state) => state.user?.id)
  const isConversationRevoked = useChatStore((state) =>
    state.revokedConversationIds.has(conversationId),
  )
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
  const currentMember = useMemo(
    () => members.find((member) => member.userId === currentUserId) ?? null,
    [currentUserId, members],
  )
  const currentRole: ConversationMemberRole | null = currentMember?.role ?? null
  const isOwner = currentRole === 'OWNER'
  const isAdmin = currentRole === 'ADMIN'
  const canManageMetadata = isOwner || isAdmin
  const canAddMembers = isOwner || isAdmin
  const { data: friends = [] } = useFriends(undefined, { enabled: canAddMembers })
  const [isEditingName, setIsEditingName] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [showAddMembers, setShowAddMembers] = useState(false)
  const [isUpdatingPicture, setIsUpdatingPicture] = useState(false)
  const [selectedMember, setSelectedMember] = useState<ConversationMember | null>(null)
  const pictureMutationInFlightRef = useRef(false)

  const applyConversation = (nextConversation: Conversation) => {
    queryClient.setQueryData(queryKeys.conversations.detail(conversationId), nextConversation)
    queryClient.setQueryData<Conversation[] | undefined>(queryKeys.conversations.all, (oldData) =>
      Array.isArray(oldData)
        ? oldData.map((item) => (item.id === nextConversation.id ? nextConversation : item))
        : oldData,
    )
  }

  const refreshMembers = async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.conversations.members(conversationId),
    })
  }

  const refreshConversation = async () => {
    const nextConversation = await conversationApi.getById(conversationId)
    applyConversation(nextConversation)
    await refreshMembers()
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

  const updateRole = useMutation({
    mutationFn: async ({
      userId,
      role,
    }: {
      userId: string
      role: Extract<ConversationMemberRole, 'ADMIN' | 'MEMBER'>
    }) => {
      await conversationApi.updateMemberRole(conversationId, userId, role)
      await refreshMembers()
    },
    onError: (error) =>
      Alert.alert(
        'Unable to update role',
        error instanceof Error ? error.message : 'Please try again.',
      ),
  })

  const transferOwnership = useMutation({
    mutationFn: async (userId: string) => {
      await conversationApi.transferOwnership(conversationId, { userId })
      await refreshConversation()
    },
    onError: (error) =>
      Alert.alert(
        'Unable to transfer ownership',
        error instanceof Error ? error.message : 'Please try again.',
      ),
  })

  const leaveGroup = useMutation({
    mutationFn: () => conversationApi.leave(conversationId),
    onSuccess: () => {
      const store = useChatStore.getState()
      store.markConversationRevoked(conversationId)
      store.clearConversationState(conversationId)
      queryClient.setQueryData<Conversation[] | undefined>(
        queryKeys.conversations.all,
        (oldData) =>
          Array.isArray(oldData) ? oldData.filter((item) => item.id !== conversationId) : oldData,
      )
      void queryClient
        .cancelQueries({ queryKey: queryKeys.conversations.detail(conversationId) })
        .finally(() => {
          queryClient.removeQueries({ queryKey: queryKeys.conversations.detail(conversationId) })
        })
      void removeConversationLocalData(conversationId).catch((error) => {
        console.warn('[GroupInfo] Failed to clear local conversation after leaving', error)
      })
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

  useEffect(() => {
    if (isConversationRevoked) {
      router.replace('/')
    }
  }, [isConversationRevoked, router])

  useEffect(() => {
    if (selectedMember && !memberIds.has(selectedMember.userId)) {
      setSelectedMember(null)
    }
  }, [memberIds, selectedMember])

  const pickAndUploadGroupPicture = async () => {
    if (!canManageMetadata || pictureMutationInFlightRef.current) return

    pictureMutationInFlightRef.current = true
    setIsUpdatingPicture(true)

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      })

      if (result.canceled || !result.assets[0]) return

      const asset = result.assets[0]
      const fileType = resolveGroupPictureMimeType(asset)
      if (!fileType) {
        Alert.alert('Unsupported image', 'Please choose a JPEG, PNG, or WebP image.')
        return
      }

      const { uploadUrl, key } = await mediaApi.getChatUploadUrl({
        fileType,
        purpose: 'chat',
      })
      const localResponse = await fetch(asset.uri)
      if (!localResponse.ok) {
        throw new Error('Unable to read the selected image.')
      }
      const blob = await localResponse.blob()
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': fileType },
        body: blob,
      })
      if (!uploadResponse.ok) {
        throw new Error(`Group photo upload failed (${uploadResponse.status}).`)
      }

      const finalized = await mediaApi.finalizeChatUpload({ key, fileType })
      if (!finalized.fileUrl) {
        throw new Error('The uploaded group photo did not return a public URL.')
      }

      const nextConversation = await conversationApi.updateGroup(conversationId, {
        picture: finalized.fileUrl,
      })
      applyConversation(nextConversation)
    } catch (error) {
      Alert.alert(
        'Unable to update group photo',
        error instanceof Error ? error.message : 'Please try again.',
      )
    } finally {
      pictureMutationInFlightRef.current = false
      setIsUpdatingPicture(false)
    }
  }

  const removeGroupPicture = () => {
    if (
      !canManageMetadata ||
      !conversation?.picture ||
      isUpdatingPicture ||
      pictureMutationInFlightRef.current
    ) {
      return
    }

    Alert.alert('Remove group photo?', 'The group will use its name initial instead.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          if (pictureMutationInFlightRef.current) return

          pictureMutationInFlightRef.current = true
          setIsUpdatingPicture(true)
          void conversationApi
            .updateGroup(conversationId, { picture: null })
            .then(applyConversation)
            .catch((error) => {
              Alert.alert(
                'Unable to remove group photo',
                error instanceof Error ? error.message : 'Please try again.',
              )
            })
            .finally(() => {
              pictureMutationInFlightRef.current = false
              setIsUpdatingPicture(false)
            })
        },
      },
    ])
  }

  if (isConversationRevoked) {
    return <SafeAreaView className="flex-1 bg-bg-primary" />
  }

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

  const canTransferMemberOwnership = (member: ConversationMember) =>
    isOwner && member.role !== 'OWNER' && member.userId !== currentUserId

  const canChangeMemberRole = (member: ConversationMember) =>
    isOwner && member.role !== 'OWNER' && member.userId !== currentUserId

  const canRemoveGroupMember = (member: ConversationMember) =>
    memberCount > 2 &&
    member.userId !== currentUserId &&
    member.role !== 'OWNER' &&
    (isOwner || (isAdmin && member.role === 'MEMBER'))

  const hasMemberActions = (member: ConversationMember) =>
    canChangeMemberRole(member) ||
    canTransferMemberOwnership(member) ||
    canRemoveGroupMember(member)

  const confirmRemoveMember = (member: ConversationMember) => {
    const name = getMemberDisplayName(member, participantById.get(member.userId))
    Alert.alert('Remove member?', `${name} will lose access to this group.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeMember.mutate(member.userId) },
    ])
  }

  const confirmRoleChange = (member: ConversationMember) => {
    const name = getMemberDisplayName(member, participantById.get(member.userId))
    const nextRole = member.role === 'ADMIN' ? 'MEMBER' : 'ADMIN'
    Alert.alert(
      nextRole === 'ADMIN' ? 'Make admin?' : 'Remove admin role?',
      nextRole === 'ADMIN'
        ? `${name} will be able to rename the group, change its photo, add members, and remove regular members.`
        : `${name} will return to regular member permissions.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextRole === 'ADMIN' ? 'Make admin' : 'Remove admin',
          onPress: () => updateRole.mutate({ userId: member.userId, role: nextRole }),
        },
      ],
    )
  }

  const confirmTransferOwnership = (member: ConversationMember) => {
    const name = getMemberDisplayName(member, participantById.get(member.userId))
    Alert.alert(
      'Transfer ownership?',
      `${name} will become the group owner. You will stay in the group as a regular member.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Transfer', onPress: () => transferOwnership.mutate(member.userId) },
      ],
    )
  }

  const confirmLeave = () => {
    Alert.alert('Leave group?', 'You will no longer receive messages from this group.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => leaveGroup.mutate() },
    ])
  }

  const handleLeavePress = () => {
    if (isOwner) {
      Alert.alert(
        'Transfer ownership first',
        'Choose another member and transfer ownership before leaving this group.',
      )
      return
    }

    if (memberCount <= 2) {
      Alert.alert('Unable to leave', 'At least two active members must remain in the group.')
      return
    }

    confirmLeave()
  }

  const closeMemberActionsAndRun = (
    member: ConversationMember,
    action: (target: ConversationMember) => void,
  ) => {
    setSelectedMember(null)
    action(member)
  }

  const selectedMemberName = selectedMember
    ? getMemberDisplayName(selectedMember, participantById.get(selectedMember.userId))
    : ''

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

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <View className="items-center px-5 pb-7 pt-6">
          <View className="relative">
            {conversation.picture ? (
              <Image source={{ uri: conversation.picture }} className="h-28 w-28 rounded-full" />
            ) : (
              <View className="h-28 w-28 items-center justify-center rounded-full bg-surface-input">
                <AppText className="text-[32px] font-semibold text-text-primary">
                  {groupName.charAt(0).toUpperCase()}
                </AppText>
              </View>
            )}
            {canManageMetadata ? (
              <SafeTouchableOpacity
                className="absolute -bottom-1 -right-1 h-10 w-10 items-center justify-center rounded-full border-2 border-bg-primary bg-surface-input"
                onPress={() => void pickAndUploadGroupPicture()}
                disabled={isUpdatingPicture}
                accessibilityRole="button"
                accessibilityLabel="Change group photo"
              >
                {isUpdatingPicture ? (
                  <ActivityIndicator size="small" color="#FF6B2C" />
                ) : (
                  <MaterialIcons name="photo-camera" size={19} color="#161616" />
                )}
              </SafeTouchableOpacity>
            ) : null}
          </View>

          {canManageMetadata && conversation.picture ? (
            <SafeTouchableOpacity
              className="mt-2 px-3 py-1.5"
              onPress={removeGroupPicture}
              disabled={isUpdatingPicture}
            >
              <AppText className="text-xs2 font-medium text-[#D84A3A]">Remove photo</AppText>
            </SafeTouchableOpacity>
          ) : null}

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
            <View className="mt-4 items-center px-4">
              <View className="max-w-full flex-row items-center">
                <AppText
                  className="max-w-[85%] text-center text-xl font-semibold text-text-primary"
                  numberOfLines={2}
                >
                  {groupName}
                </AppText>
                {canManageMetadata ? (
                  <SafeTouchableOpacity
                    className="ml-2 h-8 w-8 shrink-0 items-center justify-center"
                    onPress={() => {
                      setDraftName(groupName)
                      setIsEditingName(true)
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Rename group"
                  >
                    <MaterialIcons name="edit" size={17} color="#767676" />
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
          <View className="flex-row items-center justify-between px-5 pb-2 pt-5">
            <AppText className="text-sm2 font-semibold text-text-primary">Members</AppText>
            <AppText className="text-xs2 text-text-muted">{memberCount}</AppText>
          </View>

          {canAddMembers ? (
            <SafeTouchableOpacity
              className="flex-row items-center px-5 py-3.5"
              onPress={() => setShowAddMembers((value) => !value)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={showAddMembers ? 'Hide add members' : 'Add members'}
            >
              <View className="h-10 w-10 items-center justify-center rounded-full bg-surface-input">
                <MaterialIcons name="person-add" size={20} color="#161616" />
              </View>
              <AppText className="ml-3 flex-1 font-medium text-text-primary">Add members</AppText>
              <MaterialIcons
                name={showAddMembers ? 'expand-less' : 'expand-more'}
                size={23}
                color="#8A8A8A"
              />
            </SafeTouchableOpacity>
          ) : null}

          {showAddMembers && canAddMembers ? (
            <View className="border-y border-border-light bg-surface-card px-5 py-2">
              {addCandidates.length === 0 ? (
                <AppText className="py-4 text-sm2 text-text-secondary">
                  No friends available to add.
                </AppText>
              ) : (
                addCandidates.map((item) => {
                  const name = getFriendName(item)
                  return (
                    <View key={item.user.id} className="flex-row items-center py-2.5">
                      {item.user.picture ? (
                        <Image source={{ uri: item.user.picture }} className="h-10 w-10 rounded-full" />
                      ) : (
                        <View className="h-10 w-10 items-center justify-center rounded-full bg-surface-input">
                          <AppText className="text-xs2 font-medium text-text-primary">
                            {name.charAt(0).toUpperCase()}
                          </AppText>
                        </View>
                      )}
                      <View className="ml-3 min-w-0 flex-1">
                        <AppText className="font-medium text-text-primary" numberOfLines={1}>
                          {name}
                        </AppText>
                        <AppText className="mt-0.5 text-xs2 text-text-muted" numberOfLines={1}>
                          {item.user.email}
                        </AppText>
                      </View>
                      <AppPressable
                        className="ml-3 rounded-full bg-brand px-3 py-2"
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
              const displayName = getMemberDisplayName(member, participant)
              const picture = participant?.picture || member.user.picture || undefined
              const memberIsSelf = member.userId === currentUserId
              const memberHasActions = hasMemberActions(member)

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
                  <View className="ml-3 min-w-0 flex-1">
                    <View className="min-w-0 flex-row items-center">
                      <AppText
                        className="min-w-0 flex-1 font-medium text-text-primary"
                        numberOfLines={1}
                      >
                        {memberIsSelf ? 'You' : displayName}
                      </AppText>
                      {member.role !== 'MEMBER' ? (
                        <View className="ml-2 shrink-0 rounded-full bg-surface-accent px-2 py-1">
                          <AppText className="text-[10px] font-medium text-brand">
                            {roleLabel(member.role)}
                          </AppText>
                        </View>
                      ) : null}
                    </View>
                    <AppText className="mt-0.5 min-w-0 text-xs2 text-text-muted" numberOfLines={1}>
                      {member.user.email}
                    </AppText>
                  </View>
                  {memberHasActions ? (
                    <SafeTouchableOpacity
                      className="ml-2 h-10 w-10 shrink-0 items-center justify-center"
                      onPress={() => setSelectedMember(member)}
                      accessibilityRole="button"
                      accessibilityLabel={`Actions for ${displayName}`}
                    >
                      <MaterialIcons name="more-vert" size={22} color="#767676" />
                    </SafeTouchableOpacity>
                  ) : null}
                </View>
              )
            })
          )}
        </View>

        <View className="mt-3 border-t border-border-light px-5 pt-2">
          <AppPressable
            className="flex-row items-center py-4"
            disabled={leaveGroup.isPending || !currentRole}
            onPress={handleLeavePress}
          >
            <View className="h-10 w-10 items-center justify-center rounded-full bg-[#FFF0EC]">
              {leaveGroup.isPending ? (
                <ActivityIndicator size="small" color="#D84A3A" />
              ) : (
                <MaterialIcons name="logout" size={20} color="#D84A3A" />
              )}
            </View>
            <View className="ml-3 flex-1">
              <AppText className="font-semibold text-[#D84A3A]">Leave group</AppText>
              {isOwner ? (
                <AppText className="mt-0.5 text-xs2 text-text-muted">
                  Transfer ownership before leaving.
                </AppText>
              ) : memberCount <= 2 ? (
                <AppText className="mt-0.5 text-xs2 text-text-muted">
                  At least two members must remain.
                </AppText>
              ) : null}
            </View>
          </AppPressable>
        </View>
      </ScrollView>

      <Modal
        visible={Boolean(selectedMember)}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setSelectedMember(null)}
      >
        <View
          className="flex-1 justify-end"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.32)' }}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelectedMember(null)} />
          {selectedMember ? (
            <View className="rounded-t-[28px] bg-bg-primary px-5 pb-8 pt-3">
              <View className="mx-auto mb-4 h-1 w-10 rounded-full bg-border-light" />
              <View className="mb-2 px-1">
                <AppText className="text-base2 font-semibold text-text-primary" numberOfLines={1}>
                  {selectedMemberName}
                </AppText>
                <AppText className="mt-0.5 text-xs2 text-text-muted">
                  {roleLabel(selectedMember.role)}
                </AppText>
              </View>

              {canChangeMemberRole(selectedMember) ? (
                <SafeTouchableOpacity
                  className="flex-row items-center py-3.5"
                  disabled={updateRole.isPending}
                  onPress={() =>
                    closeMemberActionsAndRun(selectedMember, confirmRoleChange)
                  }
                >
                  <View className="h-10 w-10 items-center justify-center rounded-full bg-surface-input">
                    <MaterialIcons
                      name={
                        selectedMember.role === 'ADMIN'
                          ? 'remove-moderator'
                          : 'admin-panel-settings'
                      }
                      size={20}
                      color="#161616"
                    />
                  </View>
                  <AppText className="ml-3 font-medium text-text-primary">
                    {selectedMember.role === 'ADMIN' ? 'Remove admin role' : 'Make admin'}
                  </AppText>
                </SafeTouchableOpacity>
              ) : null}

              {canTransferMemberOwnership(selectedMember) ? (
                <SafeTouchableOpacity
                  className="flex-row items-center py-3.5"
                  disabled={transferOwnership.isPending}
                  onPress={() =>
                    closeMemberActionsAndRun(selectedMember, confirmTransferOwnership)
                  }
                >
                  <View className="h-10 w-10 items-center justify-center rounded-full bg-surface-input">
                    <MaterialIcons name="swap-horiz" size={21} color="#161616" />
                  </View>
                  <AppText className="ml-3 font-medium text-text-primary">
                    Transfer ownership
                  </AppText>
                </SafeTouchableOpacity>
              ) : null}

              {canRemoveGroupMember(selectedMember) ? (
                <SafeTouchableOpacity
                  className="flex-row items-center py-3.5"
                  disabled={removeMember.isPending}
                  onPress={() =>
                    closeMemberActionsAndRun(selectedMember, confirmRemoveMember)
                  }
                >
                  <View className="h-10 w-10 items-center justify-center rounded-full bg-[#FFF0EC]">
                    <MaterialIcons name="person-remove" size={20} color="#D84A3A" />
                  </View>
                  <AppText className="ml-3 font-medium text-[#D84A3A]">
                    Remove from group
                  </AppText>
                </SafeTouchableOpacity>
              ) : null}

              <SafeTouchableOpacity
                className="mt-2 items-center rounded-[16px] bg-surface-input py-3.5"
                onPress={() => setSelectedMember(null)}
              >
                <AppText className="font-semibold text-text-primary">Cancel</AppText>
              </SafeTouchableOpacity>
            </View>
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  )
}
