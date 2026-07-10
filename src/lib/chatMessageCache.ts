import type { InfiniteData, QueryClient } from '@tanstack/react-query'

import { queryKeys } from '../constants/queryKeys'

import {
  getMessageIdentityKey,
  isSameMessageIdentity,
  mergeMessageRecords,
} from './messageIdentity'

import type { Conversation, Message } from '../types/conversation.types'

type AnchoredMessagesCollection = {
  messages: Message[]
}

type MessagesCollection =
  InfiniteData<Message[]> | Message[] | AnchoredMessagesCollection | undefined

const isInfiniteMessagesCollection = (
  value: MessagesCollection,
): value is InfiniteData<Message[]> => {
  return Boolean(value && typeof value === 'object' && 'pages' in value)
}

const isAnchoredMessagesCollection = (
  value: MessagesCollection,
): value is AnchoredMessagesCollection => {
  return Boolean(value && typeof value === 'object' && 'messages' in value && !('pages' in value))
}

const getConversationActivityAt = (conversation: Partial<Conversation>) => {
  const value = conversation.lastMessageAt ?? conversation.updatedAt ?? conversation.createdAt
  return value ? new Date(value).getTime() : 0
}

const sortConversations = (conversations: Conversation[]) => {
  return [...conversations].sort(
    (left, right) => getConversationActivityAt(right) - getConversationActivityAt(left),
  )
}

const mapMessagesIfChanged = (messages: Message[], updater: (message: Message) => Message) => {
  let hasChanges = false

  const nextMessages = messages.map((message) => {
    const nextMessage = updater(message)

    if (nextMessage !== message) {
      hasChanges = true
    }

    return nextMessage
  })

  return hasChanges ? nextMessages : messages
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
  queryClient.setQueryData<MessagesCollection>(
    queryKeys.conversations.messages(conversationId),
    (oldData) => {
      if (!oldData) {
        return oldData
      }

      if (isInfiniteMessagesCollection(oldData)) {
        let hasChanges = false
        const nextPages = oldData.pages.map((page) => {
          const nextPage = mapMessagesIfChanged(page, updater)
          if (nextPage !== page) {
            hasChanges = true
          }

          return nextPage
        })

        if (!hasChanges) {
          return oldData
        }

        return {
          ...oldData,
          pages: nextPages,
        }
      }

      if (Array.isArray(oldData)) {
        const nextMessages = mapMessagesIfChanged(oldData, updater)
        return nextMessages === oldData ? oldData : nextMessages
      }

      return oldData
    },
  )
}

export const patchConversationAnchoredMessagesInCache = (
  queryClient: QueryClient,
  conversationId: string,
  updater: (message: Message) => Message,
) => {
  const anchorQueries = queryClient.getQueriesData<MessagesCollection>({
    queryKey: queryKeys.conversations.messagesAroundRoot(conversationId),
  })

  for (const [queryKey] of anchorQueries) {
    if (!Array.isArray(queryKey) || queryKey.length !== 4 || queryKey[2] !== 'messagesAround') {
      continue
    }

    queryClient.setQueryData<MessagesCollection>(queryKey, (oldData) => {
      if (!oldData) {
        return oldData
      }

      if (isAnchoredMessagesCollection(oldData)) {
        const nextMessages = mapMessagesIfChanged(oldData.messages, updater)
        return nextMessages === oldData.messages ? oldData : { ...oldData, messages: nextMessages }
      }

      return oldData
    })
  }
}

export const patchConversationMessageCollectionsInCache = (
  queryClient: QueryClient,
  conversationId: string,
  updater: (message: Message) => Message,
) => {
  patchConversationMessagesInCache(queryClient, conversationId, updater)
  patchConversationAnchoredMessagesInCache(queryClient, conversationId, updater)
}

export const patchMessagesAcrossConversationCaches = (
  queryClient: QueryClient,
  updater: (message: Message) => Message,
) => {
  const allQueries = queryClient.getQueriesData<MessagesCollection>({
    queryKey: ['conversations'],
  })

  for (const [queryKey] of allQueries) {
    if (!Array.isArray(queryKey)) {
      continue
    }

    const isLatestMessagesQuery = queryKey.length === 3 && queryKey[2] === 'messages'
    const isAnchoredMessagesQuery = queryKey.length === 4 && queryKey[2] === 'messagesAround'

    if (!isLatestMessagesQuery && !isAnchoredMessagesQuery) {
      continue
    }

    queryClient.setQueryData(queryKey as readonly unknown[], (oldData: MessagesCollection) => {
      if (!oldData) {
        return oldData
      }

      if (isInfiniteMessagesCollection(oldData)) {
        let hasChanges = false
        const nextPages = oldData.pages.map((page) => {
          const nextPage = mapMessagesIfChanged(page, updater)
          if (nextPage !== page) {
            hasChanges = true
          }

          return nextPage
        })

        if (!hasChanges) {
          return oldData
        }

        return {
          ...oldData,
          pages: nextPages,
        }
      }

      if (Array.isArray(oldData)) {
        const nextMessages = mapMessagesIfChanged(oldData, updater)
        return nextMessages === oldData ? oldData : nextMessages
      }

      if (isAnchoredMessagesCollection(oldData)) {
        const nextMessages = mapMessagesIfChanged(oldData.messages, updater)
        if (nextMessages === oldData.messages) {
          return oldData
        }

        return {
          ...oldData,
          messages: nextMessages,
        }
      }

      return oldData
    })
  }
}

export const patchExistingMessageAcrossConversationCaches = (
  queryClient: QueryClient,
  message: Message,
) => {
  patchConversationMessageCollectionsInCache(queryClient, message.conversationId, (candidate) =>
    isSameMessageIdentity(candidate, message) ? mergeMessageRecords(candidate, message) : candidate,
  )
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
