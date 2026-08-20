import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet'
import { useQuery } from '@tanstack/react-query'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Image, ScrollView, Text, TouchableOpacity, View } from 'react-native'

import { conversationApi } from '../../api/conversation.api'
import { useAuthStore } from '../../stores/authStore'

import type { MessageReactionDetail } from '../../types/conversation.types'

interface ReactionDetailsSheetProps {
  sheetRef: React.RefObject<BottomSheetModal | null>
  messageId: string
  initialEmoji: string | null
  reactionSignature: string
  onDismiss: () => void
}

const ALL_FILTER = '__all__'

const getActorLabel = (reaction: MessageReactionDetail, currentUserId?: string) => {
  if (reaction.userId === currentUserId) return 'Bạn'

  const fullName = reaction.user?.fullName?.trim()
  if (fullName) return fullName

  const username = reaction.user?.username?.trim().replace(/^@+/, '')
  if (username) return `@${username}`

  return 'Người dùng'
}

const getActorInitial = (label: string) => {
  const normalized = label.replace(/^@/, '').trim()
  return normalized.charAt(0).toUpperCase() || '?'
}

export function ReactionDetailsSheet({
  sheetRef,
  messageId,
  initialEmoji,
  reactionSignature,
  onDismiss,
}: ReactionDetailsSheetProps) {
  const currentUserId = useAuthStore((state) => state.user?.id)
  const [selectedFilter, setSelectedFilter] = useState(ALL_FILTER)
  const isOpen = initialEmoji !== null

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['message-reaction-details', messageId],
    queryFn: () => conversationApi.getReactionDetails(messageId),
    enabled: isOpen,
    staleTime: 10_000,
  })

  useEffect(() => {
    if (!initialEmoji) return
    setSelectedFilter(initialEmoji)
  }, [initialEmoji])

  useEffect(() => {
    if (!isOpen) return
    void refetch()
  }, [isOpen, reactionSignature, refetch])

  const reactionCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const reaction of data?.reactions ?? []) {
      counts.set(reaction.emoji, (counts.get(reaction.emoji) ?? 0) + 1)
    }
    return Array.from(counts.entries())
  }, [data?.reactions])

  useEffect(() => {
    if (selectedFilter === ALL_FILTER) return
    if (reactionCounts.some(([emoji]) => emoji === selectedFilter)) return
    if (!isLoading) setSelectedFilter(ALL_FILTER)
  }, [isLoading, reactionCounts, selectedFilter])

  const visibleReactions = useMemo(() => {
    const filtered =
      selectedFilter === ALL_FILTER
        ? [...(data?.reactions ?? [])]
        : (data?.reactions ?? []).filter((reaction) => reaction.emoji === selectedFilter)

    return filtered.sort((left, right) => {
      const leftIsCurrentUser = left.userId === currentUserId
      const rightIsCurrentUser = right.userId === currentUserId
      if (leftIsCurrentUser !== rightIsCurrentUser) return leftIsCurrentUser ? -1 : 1
      return Date.parse(left.createdAt) - Date.parse(right.createdAt)
    })
  }, [currentUserId, data?.reactions, selectedFilter])

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
    ),
    [],
  )

  return (
    <BottomSheetModal
      ref={sheetRef}
      index={0}
      snapPoints={['58%']}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: '#FFFFFF' }}
      handleIndicatorStyle={{ backgroundColor: '#D9D9D9' }}
      onDismiss={onDismiss}
    >
      <View className="flex-1 px-4 pb-4">
        <Text className="mb-3 text-center text-[17px] font-semibold text-text-primary">Reactions</Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingBottom: 12 }}
        >
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setSelectedFilter(ALL_FILTER)}
            className={`rounded-full px-3 py-2 ${
              selectedFilter === ALL_FILTER ? 'bg-brand-soft' : 'bg-surface-input'
            }`}
          >
            <Text
              className={`text-sm ${
                selectedFilter === ALL_FILTER ? 'font-semibold text-brand' : 'text-text-secondary'
              }`}
            >
              All {data?.total ?? 0}
            </Text>
          </TouchableOpacity>

          {reactionCounts.map(([emoji, count]) => (
            <TouchableOpacity
              key={emoji}
              activeOpacity={0.8}
              onPress={() => setSelectedFilter(emoji)}
              className={`rounded-full px-3 py-2 ${
                selectedFilter === emoji ? 'bg-brand-soft' : 'bg-surface-input'
              }`}
            >
              <Text
                className={`text-sm ${
                  selectedFilter === emoji ? 'font-semibold text-brand' : 'text-text-secondary'
                }`}
              >
                {emoji} {count}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {isLoading ? (
          <View className="flex-1 items-center justify-center py-12">
            <ActivityIndicator color="#FF6B2C" />
          </View>
        ) : isError ? (
          <View className="items-center py-10">
            <Text className="mb-3 text-sm text-text-muted">Không thể tải danh sách reactions.</Text>
            <TouchableOpacity
              onPress={() => void refetch()}
              className="rounded-full bg-surface-input px-4 py-2"
            >
              <Text className="font-medium text-text-primary">Thử lại</Text>
            </TouchableOpacity>
          </View>
        ) : visibleReactions.length === 0 ? (
          <View className="items-center py-10">
            <Text className="text-sm text-text-muted">Chưa có reaction nào.</Text>
          </View>
        ) : (
          <BottomSheetScrollView showsVerticalScrollIndicator={false}>
            {visibleReactions.map((reaction) => {
              const label = getActorLabel(reaction, currentUserId)
              const picture = reaction.user?.picture?.trim()

              return (
                <View key={reaction.userId} className="flex-row items-center py-2.5">
                  {picture ? (
                    <Image source={{ uri: picture }} className="h-11 w-11 rounded-full bg-surface-input" />
                  ) : (
                    <View className="h-11 w-11 items-center justify-center rounded-full bg-surface-input">
                      <Text className="text-base font-semibold text-text-primary">
                        {getActorInitial(label)}
                      </Text>
                    </View>
                  )}

                  <Text
                    className="ml-3 min-w-0 flex-1 text-[15px] font-medium text-text-primary"
                    numberOfLines={1}
                  >
                    {label}
                  </Text>
                  <Text className="ml-3 text-xl">{reaction.emoji}</Text>
                </View>
              )
            })}
          </BottomSheetScrollView>
        )}
      </View>
    </BottomSheetModal>
  )
}
