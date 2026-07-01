import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useCallback } from 'react'

import { useNetworkStatus } from '../providers/NetworkProvider'

import { prefetchMessages } from './useMessages'

const CONVERSATION_NAVIGATION_LOCK_MS = 500

let activeConversationEntryKey: string | null = null
let conversationNavigationLockedUntil = 0

const isConversationNavigationLocked = () => conversationNavigationLockedUntil > Date.now()

const lockConversationNavigation = () => {
  conversationNavigationLockedUntil = Date.now() + CONVERSATION_NAVIGATION_LOCK_MS
}

export const navigationBypass = { targetId: null as string | null, timestamp: 0 }

export function useConversationNavigation() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { isNetworkResolved, isOnline } = useNetworkStatus()

  const prefetchConversation = useCallback(
    (conversationId: string) => {
      if (!conversationId) {
        return
      }

      void prefetchMessages(queryClient, conversationId, { isNetworkResolved, isOnline })
    },
    [isNetworkResolved, isOnline, queryClient],
  )

  const openConversation = useCallback(
    (conversationId: string) => {
      if (!conversationId || isConversationNavigationLocked()) {
        return false
      }

      lockConversationNavigation()
      prefetchConversation(conversationId)

      navigationBypass.targetId = conversationId
      navigationBypass.timestamp = Date.now()

      router.push(`/conversation/${conversationId}`)
      return true
    },
    [prefetchConversation, router],
  )

  const runConversationEntry = useCallback(async <T>(key: string, task: () => Promise<T>) => {
    if (!key || activeConversationEntryKey || isConversationNavigationLocked()) {
      return null
    }

    activeConversationEntryKey = key

    try {
      return await task()
    } finally {
      if (activeConversationEntryKey === key) {
        activeConversationEntryKey = null
      }
    }
  }, [])

  return {
    openConversation,
    prefetchConversation,
    runConversationEntry,
  }
}
