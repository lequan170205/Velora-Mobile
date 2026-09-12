import { MaterialIcons } from '@expo/vector-icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Image, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { conversationApi } from '../../src/api/conversation.api'
import { AppPressable, AppText, AppTextInput } from '../../src/components/base'
import { AppSearchBar } from '../../src/components/common/AppSearchBar'
import { SafeTouchableOpacity } from '../../src/components/common/SafeTouchableOpacity'
import { queryKeys } from '../../src/constants/queryKeys'
import { useFriends } from '../../src/hooks/useFriends'

import type { Conversation } from '../../src/types/conversation.types'
import type { FriendSummary } from '../../src/types/friend.types'

const getFriendName = (friend: FriendSummary) =>
  friend.user.fullName || friend.user.username || 'Velora user'

export default function NewGroupScreen() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: friends = [], isLoading, isError, refetch } = useFriends()
  const [name, setName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())

  const filteredFriends = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return friends

    return friends.filter((friend) => {
      const searchable = [friend.user.fullName, friend.user.username]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return searchable.includes(query)
    })
  }, [friends, searchQuery])

  const normalizedName = name.trim()
  const canCreate = normalizedName.length > 0 && selectedIds.size > 0

  const createGroup = useMutation({
    mutationFn: async () => {
      const created = await conversationApi.create({
        participantIds: Array.from(selectedIds),
        type: 'GROUP',
        name: normalizedName,
      })
      const conversation = await conversationApi.getById(created.id)
      return conversation
    },
    onSuccess: (conversation) => {
      queryClient.setQueryData<Conversation[] | undefined>(
        queryKeys.conversations.all,
        (oldData) => {
          if (!Array.isArray(oldData)) return [conversation]
          return [conversation, ...oldData.filter((item) => item.id !== conversation.id)]
        },
      )
      queryClient.setQueryData(queryKeys.conversations.detail(conversation.id), conversation)
      router.replace({ pathname: '/conversation/[id]', params: { id: conversation.id } })
    },
    onError: (error) => {
      Alert.alert(
        'Unable to create group',
        error instanceof Error ? error.message : 'Please try again.',
      )
    },
  })

  const toggleFriend = (userId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
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
        <AppText className="flex-1 text-md font-semibold text-text-primary">New group</AppText>
        <AppPressable
          className={
            canCreate
              ? 'rounded-full bg-brand px-4 py-2.5'
              : 'rounded-full bg-surface-input px-4 py-2.5'
          }
          disabled={!canCreate || createGroup.isPending}
          onPress={() => createGroup.mutate()}
          activeOpacity={0.8}
        >
          {createGroup.isPending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <AppText
              className={canCreate ? 'font-semibold text-white' : 'font-semibold text-text-muted'}
            >
              Create
            </AppText>
          )}
        </AppPressable>
      </View>

      <View className="px-5 pb-4 pt-5">
        <View className="flex-row items-center">
          <View className="h-14 w-14 items-center justify-center rounded-full bg-surface-input">
            <MaterialIcons name="groups" size={25} color="#FF6B2C" />
          </View>
          <View className="ml-3 flex-1">
            <AppText className="mb-1 text-xs uppercase tracking-[1.2px] text-text-muted">
              Group name
            </AppText>
            <AppTextInput
              value={name}
              onChangeText={setName}
              maxLength={80}
              placeholder="e.g. Weekend crew"
              placeholderTextColor="#A6A6A6"
              className="h-11 rounded-[16px] border border-border-light bg-surface-card px-3 text-base2 text-text-primary"
              returnKeyType="done"
            />
          </View>
        </View>

        <View className="mt-5 flex-row items-center justify-between">
          <AppText className="text-xs uppercase tracking-[1.2px] text-text-muted">Members</AppText>
          <AppText className="text-xs2 text-text-muted">{selectedIds.size} selected</AppText>
        </View>
        <View className="mt-3">
          <AppSearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search friends"
            placeholderTextColor="#A6A6A6"
          />
        </View>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#FF6B2C" />
        </View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center px-6">
          <AppText className="text-center text-base2 text-text-secondary">
            We couldn&apos;t load your friends.
          </AppText>
          <AppPressable
            className="mt-4 rounded-full bg-brand px-5 py-3"
            onPress={() => void refetch()}
          >
            <AppText className="font-medium text-white">Try again</AppText>
          </AppPressable>
        </View>
      ) : (
        <FlatList
          data={filteredFriends}
          keyExtractor={(item) => item.user.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 36 }}
          renderItem={({ item }) => {
            const selected = selectedIds.has(item.user.id)
            const friendName = getFriendName(item)
            return (
              <SafeTouchableOpacity
                className="flex-row items-center border-b border-border-light px-5 py-3.5"
                onPress={() => toggleFriend(item.user.id)}
                activeOpacity={0.75}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
              >
                {item.user.picture ? (
                  <Image source={{ uri: item.user.picture }} className="h-11 w-11 rounded-full" />
                ) : (
                  <View className="h-11 w-11 items-center justify-center rounded-full bg-surface-input">
                    <AppText className="font-medium text-text-primary">
                      {friendName.charAt(0).toUpperCase()}
                    </AppText>
                  </View>
                )}
                <View className="ml-3 flex-1">
                  <AppText className="font-medium text-text-primary" numberOfLines={1}>
                    {friendName}
                  </AppText>
                  {item.user.username ? (
                    <AppText className="mt-0.5 text-xs2 text-text-muted">
                      @{item.user.username}
                    </AppText>
                  ) : null}
                </View>
                <View
                  className={
                    selected
                      ? 'h-6 w-6 items-center justify-center rounded-full bg-brand'
                      : 'h-6 w-6 items-center justify-center rounded-full border border-border-light bg-surface-card'
                  }
                >
                  {selected ? <MaterialIcons name="check" size={16} color="#FFFFFF" /> : null}
                </View>
              </SafeTouchableOpacity>
            )
          }}
          ListEmptyComponent={
            <View className="items-center px-6 pt-10">
              <AppText className="text-center text-base2 text-text-secondary">
                {searchQuery.trim()
                  ? 'No friends match your search.'
                  : 'Add friends before creating a group.'}
              </AppText>
            </View>
          }
        />
      )}
    </SafeAreaView>
  )
}
