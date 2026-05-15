import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useCallback } from 'react'

import { prefetchMessages } from './useMessages'

const CONVERSATION_NAVIGATION_LOCK_MS = 500

let activeConversationEntryKey: string | null = null
let conversationNavigationLockedUntil = 0

const isConversationNavigationLocked = () => conversationNavigationLockedUntil > Date.now()

const lockConversationNavigation = () => {
  conversationNavigationLockedUntil = Date.now() + CONVERSATION_NAVIGATION_LOCK_MS
}

export function useConversationNavigation() {
  const router = useRouter()
  const queryClient = useQueryClient()

  const prefetchConversation = useCallback(
    (conversationId: string) => {
      if (!conversationId) {
        return
      }

      void prefetchMessages(queryClient, conversationId)
    },
    [queryClient],
  )

  const openConversation = useCallback(
    (conversationId: string) => {
      if (!conversationId || isConversationNavigationLocked()) {
        return false
      }

      lockConversationNavigation()
      prefetchConversation(conversationId)
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
