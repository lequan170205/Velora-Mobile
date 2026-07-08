import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useCallback, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  CustomTabBarSurface,
  getDockedTabBarHeight,
  MESSAGES_TAB_INDEX,
  PROFILE_TAB_INDEX,
} from '../../../src/components/navigation/CustomTabBar'
import { ReelsViewer } from '../../../src/components/reels/ReelsViewer'
import { buildSharedReelFromMessage, isSharedReelMessage } from '../../../src/lib/chatReels'

import type { Message } from '../../../src/types/conversation.types'
import type { Reel } from '../../../src/types/reel.types'

type AnchoredMessagesCache = {
  messages?: Message[]
}

const getMessageCreatedAtMs = (message: Message) => {
  const createdAtMs = new Date(message.createdAt).getTime()
  return Number.isFinite(createdAtMs) ? createdAtMs : 0
}

const getCachedMessagePages = (
  data: InfiniteData<Message[]> | Message[] | AnchoredMessagesCache | undefined,
): Message[] => {
  if (!data) {
    return []
  }

  if (!Array.isArray(data) && 'pages' in data) {
    return data.pages.flat()
  }

  if (!Array.isArray(data) && 'messages' in data) {
    return data.messages ?? []
  }

  return Array.isArray(data) ? data : []
}

export default function ReelContextScreen() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const insets = useSafeAreaInsets()
  const { conversationId, id, returnTo, returnUsername } = useLocalSearchParams<{
    conversationId?: string | string[]
    id?: string | string[]
    returnTo?: string | string[]
    returnUsername?: string | string[]
  }>()
  const normalizedConversationId = Array.isArray(conversationId)
    ? conversationId[0]
    : conversationId
  const reelId = Array.isArray(id) ? id[0] : id
  const normalizedReturnTo = Array.isArray(returnTo) ? returnTo[0] : returnTo
  const normalizedReturnUsername = Array.isArray(returnUsername)
    ? returnUsername[0]
    : returnUsername
  const isConversationReturn = normalizedReturnTo === 'conversation'
  const tabBarHeight = getDockedTabBarHeight(insets.bottom)
  const conversationReels = useMemo(() => {
    if (!isConversationReturn || !normalizedConversationId) {
      return []
    }

    const messageQueries = queryClient.getQueriesData<
      InfiniteData<Message[]> | Message[] | AnchoredMessagesCache
    >({
      queryKey: ['conversations', normalizedConversationId],
    })
    const messages = messageQueries.flatMap(([, data]) => getCachedMessagePages(data))

    const reelsById = new Map<string, Reel>()

    messages
      .filter(isSharedReelMessage)
      .sort((left, right) => getMessageCreatedAtMs(left) - getMessageCreatedAtMs(right))
      .forEach((message) => {
        const reel = buildSharedReelFromMessage(message)
        if (reel && !reelsById.has(reel.id)) {
          reelsById.set(reel.id, reel)
        }
      })

    return Array.from(reelsById.values())
  }, [isConversationReturn, normalizedConversationId, queryClient])
  const contextItems = useMemo(() => {
    if (!reelId || conversationReels.some((reel) => reel.id === reelId)) {
      return conversationReels
    }

    return []
  }, [conversationReels, reelId])
  const handleTabSelect = useCallback(
    (_nextIndex: number, routeName: string) => {
      if (routeName === 'index') {
        router.replace('/')
        return true
      }

      router.replace(`/${routeName}` as never)
      return true
    },
    [router],
  )

  if (!reelId) {
    return <ReelsViewer mode="public" />
  }

  return (
    <View className="flex-1 bg-[#050505]">
      <ReelsViewer
        mode="context"
        reelId={reelId}
        contextItems={contextItems}
        contextSource="profile"
        returnConversationId={normalizedConversationId}
        returnTo={normalizedReturnTo}
        returnUsername={normalizedReturnUsername}
        bottomContentInset={tabBarHeight}
        tabBarHeight={tabBarHeight}
      />

      <View pointerEvents="box-none" style={styles.tabBarOverlay}>
        <CustomTabBarSurface
          activeIndex={isConversationReturn ? MESSAGES_TAB_INDEX : PROFILE_TAB_INDEX}
          forceDarkTheme
          forceDockedLayout
          onTabSelect={handleTabSelect}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  tabBarOverlay: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
  },
})
