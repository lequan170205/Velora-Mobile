import type { InfiniteData, QueryClient } from '@tanstack/react-query'

import { queryKeys } from '../constants/queryKeys'

import {
  getMessageIdentityKey,
  isSameMessageIdentity,
  mergeMessageRecords,
} from './messageIdentity'

import type { Conversation, Message } from '../types/conversation.types'

const getConversationActivityAt = (conversation: Partial<Conversation>) => {
  const value = conversation.lastMessageAt ?? conversation.updatedAt ?? conversation.createdAt
  return value ? new Date(value).getTime() : 0
}

const sortConversations = (conversations: Conversation[]) => {
  return [...conversations].sort(
    (left, right) => getConversationActivityAt(right) - getConversationActivityAt(left),
  )
}

export const upsertConversationSummaryInCache = (
  queryClient: QueryClient,
  patch: Partial<Conversation> & Pick<Conversation, 'id'>,
) => {
  queryClient.setQueryData<Conversation[] | undefined>(queryKeys.conversations.all, (oldData) => {
    if (!Array.isArray(oldData)) {
      return oldData
    }

    const existingIndex = oldData.findIndex((conversation) => conversation.id === patch.id)
    if (existingIndex === -1) {
      return oldData
    }

    const existingConversation = oldData[existingIndex]
    const mergedConversation: Conversation = {
      ...existingConversation,
      ...patch,
      id: patch.id,
      participantIds: patch.participantIds ?? existingConversation.participantIds,
      createdAt: patch.createdAt ?? existingConversation.createdAt,
      updatedAt: patch.updatedAt ?? existingConversation.updatedAt,
      lastMessage: patch.lastMessage ?? existingConversation.lastMessage ?? null,
      lastMessageAt: patch.lastMessageAt ?? existingConversation.lastMessageAt ?? null,
      isGroup: patch.isGroup ?? existingConversation.isGroup,
    }

    const nextConversations = oldData.map((conversation, index) =>
      index === existingIndex ? mergedConversation : conversation,
    )

    return sortConversations(nextConversations)
  })
}

export const patchConversationMessagesInCache = (
  queryClient: QueryClient,
  conversationId: string,
  updater: (message: Message) => Message,
) => {
  queryClient.setQueryData<InfiniteData<Message[]> | Message[] | undefined>(
    queryKeys.conversations.messages(conversationId),
    (oldData) => {
      if (!oldData) {
        return oldData
      }

      if ('pages' in oldData) {
        return {
          ...oldData,
          pages: oldData.pages.map((page) => page.map(updater)),
        }
      }

      if (Array.isArray(oldData)) {
        return oldData.map(updater)
      }

      return oldData
    },
  )
}

export const patchMessagesAcrossConversationCaches = (
  queryClient: QueryClient,
  updater: (message: Message) => Message,
) => {
  const allQueries = queryClient.getQueriesData<InfiniteData<Message[]> | Message[] | undefined>({
    queryKey: ['conversations'],
  })

  for (const [queryKey] of allQueries) {
    if (!Array.isArray(queryKey) || queryKey.length !== 3 || queryKey[2] !== 'messages') {
      continue
    }

    queryClient.setQueryData(
      queryKey,
      (oldData: InfiniteData<Message[]> | Message[] | undefined) => {
        if (!oldData) {
          return oldData
        }

        if ('pages' in oldData) {
          return {
            ...oldData,
            pages: oldData.pages.map((page) => page.map(updater)),
          }
        }

        if (Array.isArray(oldData)) {
          return oldData.map(updater)
        }

        return oldData
      },
    )
  }
}

export const upsertMessageIntoConversationCache = (queryClient: QueryClient, message: Message) => {
  const queryKey = queryKeys.conversations.messages(message.conversationId)

  queryClient.setQueryData<InfiniteData<Message[]> | Message[] | undefined>(queryKey, (oldData) => {
    if (!oldData) {
      return {
        pages: [[message]],
        pageParams: [undefined],
      } as InfiniteData<Message[]>
    }

    const upsertPage = (page: Message[]) => {
      const existingIndex = page.findIndex((item) => isSameMessageIdentity(item, message))

      if (existingIndex === -1) {
        return [message, ...page]
      }

      return page.map((item, index) =>
        index === existingIndex ? mergeMessageRecords(item, message) : item,
      )
    }

    if ('pages' in oldData) {
      const exists = oldData.pages.some((page) =>
        page.some((item) => isSameMessageIdentity(item, message)),
      )

      if (exists) {
        return {
          ...oldData,
          pages: oldData.pages.map((page) =>
            page.map((item) =>
              isSameMessageIdentity(item, message) ? mergeMessageRecords(item, message) : item,
            ),
          ),
        }
      }

      const [firstPage = [], ...restPages] = oldData.pages

      return {
        ...oldData,
        pages: [upsertPage(firstPage), ...restPages],
      }
    }

    if (Array.isArray(oldData)) {
      return upsertPage(oldData)
    }

    return oldData
  })
}

export const findMessageInConversationCache = (
  queryClient: QueryClient,
  conversationId: string,
  clientMessageId: string,
) => {
  const data = queryClient.getQueryData<InfiniteData<Message[]> | Message[] | undefined>(
    queryKeys.conversations.messages(conversationId),
  )

  const matcher = (message: Message) => getMessageIdentityKey(message) === clientMessageId

  if (!data) {
    return null
  }

  if ('pages' in data) {
    for (const page of data.pages) {
      const match = page.find(matcher)
      if (match) {
        return match
      }
    }
    return null
  }

  return Array.isArray(data) ? (data.find(matcher) ?? null) : null
}
