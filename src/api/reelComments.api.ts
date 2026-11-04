import type { InfiniteData, QueryClient } from '@tanstack/react-query'

import { queryKeys } from '../constants/queryKeys'
import { authTokenSession } from '../lib/auth/tokenSession'
import { useAuthStore } from '../stores/authStore'

import { apiClient } from './client'

import type { ReelAuthor, ReelSeriesEpisodesPage } from '../types/reel.types'

export interface ReelComment {
  id: string
  reelId: string
  parentId: string | null
  text: string | null
  replyCount: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  author: ReelAuthor | null
}

export interface ReelCommentPage {
  items: ReelComment[]
  nextCursor: string | null
}

export const prependComment = (
  data: InfiniteData<ReelCommentPage, string | null> | undefined,
  comment: ReelComment,
): InfiniteData<ReelCommentPage, string | null> => {
  const pages = data?.pages ?? [{ items: [], nextCursor: null }]
  const [first, ...rest] = pages
  return {
    pages: [
      { ...first, items: [comment, ...first.items.filter((item) => item.id !== comment.id)] },
      ...rest,
    ],
    pageParams: data?.pageParams ?? [null],
  }
}

export const replacePendingComment = (
  data: InfiniteData<ReelCommentPage, string | null> | undefined,
  pendingId: string,
  comment: ReelComment,
): InfiniteData<ReelCommentPage, string | null> | undefined => {
  if (!data) return data
  let replaced = false
  const pages = data.pages.map((page) => ({
    ...page,
    items: page.items
      .filter((item) => item.id !== comment.id)
      .map((item) => {
        if (item.id !== pendingId) return item
        replaced = true
        return comment
      }),
  }))
  if (!replaced) pages[0] = { ...pages[0], items: [comment, ...pages[0].items] }
  return { ...data, pages }
}

export const removePendingComment = (
  data: InfiniteData<ReelCommentPage, string | null> | undefined,
  pendingId: string,
): InfiniteData<ReelCommentPage, string | null> | undefined =>
  data
    ? {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items.filter((item) => item.id !== pendingId),
        })),
      }
    : data

let accountVersion = 0
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) {
    accountVersion += 1
  }
})

export const commentScope = (viewerId: string) => {
  const version = `${authTokenSession.getGeneration()}:${accountVersion}`
  const generation = authTokenSession.getGeneration()
  const account = accountVersion
  return Object.assign(
    () =>
      !!authTokenSession.getAccessToken() &&
      authTokenSession.getGeneration() === generation &&
      authTokenSession.getIdentity() === viewerId &&
      useAuthStore.getState().user?.id === viewerId &&
      accountVersion === account,
    { version },
  )
}

export type CommentScope = (() => boolean) & { version: string }

const requestOptions = (scope: CommentScope) => {
  const isCurrent = () => scope()
  if (!isCurrent()) throw new Error('Comment session changed')
  return { commentSessionGuard: isCurrent }
}

const resultForScope = <T>(scope: () => boolean, value: T): T => {
  if (!scope()) throw new Error('Comment session changed')
  return value
}

const pending = new Map<string, string>()
const pendingKey = (viewerId: string, reelId: string, parentId: string | null, text: string) =>
  JSON.stringify([viewerId, reelId, parentId, text])

export const pendingCommentId = (
  viewerId: string,
  reelId: string,
  parentId: string | null,
  text: string,
  createId: () => string,
) => {
  const key = pendingKey(viewerId, reelId, parentId, text)
  let id = pending.get(key)
  if (!id) {
    id = createId()
    pending.set(key, id)
  }
  return id
}

export const completePendingComment = (
  viewerId: string,
  reelId: string,
  parentId: string | null,
  text: string,
  id: string,
) => {
  const key = pendingKey(viewerId, reelId, parentId, text)
  if (pending.get(key) === id) pending.delete(key)
}

export const commentPermissions = (
  comment: ReelComment,
  viewerId: string,
  reelOwnerId: string,
) => ({
  edit: !comment.deletedAt && comment.author?.id === viewerId,
  delete: !comment.deletedAt && (comment.author?.id === viewerId || reelOwnerId === viewerId),
})

export const commentCount = (feedCount?: number, detailCount?: number) =>
  feedCount ?? detailCount ?? 0

const path = (reelId: string) => `/content/reels/${encodeURIComponent(reelId)}/comments`

export const reelCommentsApi = {
  count: async (scope: CommentScope, reelId: string) => {
    const options = requestOptions(scope)
    const response = await apiClient.get<{ commentCount?: number }>(
      `/content/reels/${encodeURIComponent(reelId)}`,
      options,
    )
    return resultForScope(options.commentSessionGuard, response.data.commentCount)
  },
  list: async (scope: CommentScope, reelId: string, parentId: string | null, cursor?: string) => {
    const suffix = parentId ? `/${encodeURIComponent(parentId)}/replies` : ''
    const options = requestOptions(scope)
    const response = await apiClient.get<ReelCommentPage>(path(reelId) + suffix, {
      ...options,
      params: { cursor },
    })
    return resultForScope(options.commentSessionGuard, response.data)
  },
  create: async (
    scope: CommentScope,
    reelId: string,
    parentId: string | null,
    text: string,
    clientRequestId: string,
  ) => {
    const suffix = parentId ? `/${encodeURIComponent(parentId)}/replies` : ''
    const options = requestOptions(scope)
    const response = await apiClient.post<ReelComment>(
      path(reelId) + suffix,
      { text, clientRequestId },
      options,
    )
    return resultForScope(options.commentSessionGuard, response.data)
  },
  update: async (scope: CommentScope, reelId: string, id: string, text: string) => {
    const options = requestOptions(scope)
    const response = await apiClient.patch<ReelComment>(
      `${path(reelId)}/${encodeURIComponent(id)}`,
      { text },
      options,
    )
    return resultForScope(options.commentSessionGuard, response.data)
  },
  delete: async (scope: CommentScope, reelId: string, id: string) => {
    const options = requestOptions(scope)
    await apiClient.delete(`${path(reelId)}/${encodeURIComponent(id)}`, options)
    resultForScope(options.commentSessionGuard, null)
  },
}

export const refreshSeriesCommentCount = async (
  client: QueryClient,
  viewerId: string,
  reelId: string,
  scope: CommentScope,
) => {
  const queryKey = queryKeys.reels.allSeriesEpisodePages(viewerId)
  try {
    const count = await reelCommentsApi.count(scope, reelId)
    if (!scope() || typeof count !== 'number') return
    client.setQueriesData<InfiniteData<ReelSeriesEpisodesPage>>({ queryKey }, (data) => {
      if (!data) return data
      let changed = false
      const pages = data.pages.map((page) => {
        if (!page.items.some((item) => item.id === reelId && item.commentCount !== count))
          return page
        changed = true
        return {
          ...page,
          items: page.items.map((item) =>
            item.id === reelId ? { ...item, commentCount: count } : item,
          ),
        }
      })
      return changed ? { ...data, pages } : data
    })
    return count
  } finally {
    if (scope()) void client.invalidateQueries({ queryKey })
  }
}
