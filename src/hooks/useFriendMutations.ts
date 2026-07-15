import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { useRef } from 'react'
import { Alert } from 'react-native'

import { friendApi } from '../api/friend.api'
import { queryKeys } from '../constants/queryKeys'
import {
  insertOrReplaceFriendSummary,
  removeFriendRequestFromPages,
  removeUserFromFriendList,
  updateFriendshipStatus,
  updateIncomingRequestPages,
  updateOutgoingRequestPages,
} from '../lib/friendCache'
import { useAuthStore } from '../stores/authStore'

import type {
  FriendSummary,
  FriendshipActionResponse,
  FriendshipStatusResponse,
  PublicFriendProfile,
} from '../types/friend.types'

type RequestMutationInput = {
  requestId: string
  userId: string
}

export type AcceptFriendRequestInput = RequestMutationInput & {
  requester: PublicFriendProfile
  requestedAt?: string
}

export type RejectFriendRequestInput = RequestMutationInput
export type CancelFriendRequestInput = RequestMutationInput

const getFriendErrorMessage = (error: unknown) => {
  if (isAxiosError(error)) {
    const message = error.response?.data?.message

    if (error.response?.status === 400) {
      if (Array.isArray(message) && message[0]) return message[0]
      if (typeof message === 'string' && message.trim()) return message
    }
  }

  return 'Something went wrong. Please try again.'
}

const shouldRefreshFriendData = (error: unknown) =>
  isAxiosError(error) && [403, 404, 409].includes(error.response?.status ?? 0)

const ensureViewer = (viewerId: string) => {
  if (!viewerId) {
    throw new Error('You need to sign in to manage friends.')
  }
}

const isCurrentViewer = (viewerId: string) => useAuthStore.getState().user?.id === viewerId

const useFriendMutationError = (viewerId: string) => {
  const queryClient = useQueryClient()

  return (error: unknown, targetUserId: string) => {
    if (!isCurrentViewer(viewerId)) return

    if (shouldRefreshFriendData(error) && viewerId) {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.friends.incoming(viewerId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.friends.outgoing(viewerId) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.friends.status(viewerId, targetUserId),
        }),
      ])
      return
    }

    Alert.alert('Error', getFriendErrorMessage(error))
  }
}

const friendSummaryFromAcceptance = (
  input: AcceptFriendRequestInput,
  response: FriendshipActionResponse,
): FriendSummary => ({
  id: response.id ?? input.requestId,
  status: 'friends',
  friendsSince: input.requestedAt ?? new Date().toISOString(),
  user: input.requester,
})

export function useSendFriendRequest() {
  const queryClient = useQueryClient()
  const viewerId = useAuthStore((state) => state.user?.id) ?? ''
  const inFlightTargetIds = useRef(new Set<string>())
  const handleError = useFriendMutationError(viewerId)

  return useMutation({
    mutationKey: [...queryKeys.friends.viewer(viewerId), 'send'] as const,
    mutationFn: async (targetUserId: string) => {
      ensureViewer(viewerId)
      if (inFlightTargetIds.current.has(targetUserId)) {
        throw new Error('This friend request is already in progress.')
      }
      inFlightTargetIds.current.add(targetUserId)

      try {
        return await friendApi.sendRequest(targetUserId)
      } finally {
        inFlightTargetIds.current.delete(targetUserId)
      }
    },
    onSuccess: (response, targetUserId) => {
      if (!isCurrentViewer(viewerId)) return

      updateFriendshipStatus(queryClient, viewerId, targetUserId, {
        status: response.status,
        ...(response.id ? { id: response.id } : {}),
      })

      if (response.status === 'request_sent') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.friends.outgoing(viewerId) })
      }

      if (response.status === 'request_received') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.friends.incoming(viewerId) })
      }

      if (response.status === 'friends') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.friends.list(viewerId, viewerId) })
      }
    },
    onError: (error, targetUserId) => handleError(error, targetUserId),
  })
}

export function useAcceptFriendRequest() {
  const queryClient = useQueryClient()
  const viewerId = useAuthStore((state) => state.user?.id) ?? ''
  const inFlightRequestIds = useRef(new Set<string>())
  const handleError = useFriendMutationError(viewerId)

  return useMutation({
    mutationKey: [...queryKeys.friends.viewer(viewerId), 'accept'] as const,
    mutationFn: async (input: AcceptFriendRequestInput) => {
      ensureViewer(viewerId)
      if (inFlightRequestIds.current.has(input.requestId)) {
        throw new Error('This friend request is already in progress.')
      }
      inFlightRequestIds.current.add(input.requestId)

      try {
        return await friendApi.acceptRequest(input.requestId)
      } finally {
        inFlightRequestIds.current.delete(input.requestId)
      }
    },
    onSuccess: (response, input) => {
      if (!isCurrentViewer(viewerId)) return

      updateIncomingRequestPages(queryClient, viewerId, (data) =>
        removeFriendRequestFromPages(data, input.requestId),
      )
      updateFriendshipStatus(queryClient, viewerId, input.userId, {
        status: response.status,
        ...(response.id ? { id: response.id } : {}),
      })

      if (response.status === 'friends') {
        queryClient.setQueryData<FriendSummary[]>(
          queryKeys.friends.list(viewerId, viewerId),
          (data) =>
            insertOrReplaceFriendSummary(data, friendSummaryFromAcceptance(input, response)),
        )
      }

      void queryClient.invalidateQueries({ queryKey: queryKeys.friends.list(viewerId, viewerId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.friends.outgoing(viewerId) })

      if (response.conversationId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
      }
    },
    onError: (error, input) => handleError(error, input.userId),
  })
}

export function useRejectFriendRequest() {
  const queryClient = useQueryClient()
  const viewerId = useAuthStore((state) => state.user?.id) ?? ''
  const inFlightRequestIds = useRef(new Set<string>())
  const handleError = useFriendMutationError(viewerId)

  return useMutation({
    mutationKey: [...queryKeys.friends.viewer(viewerId), 'reject'] as const,
    mutationFn: async (input: RejectFriendRequestInput) => {
      ensureViewer(viewerId)
      if (inFlightRequestIds.current.has(input.requestId)) {
        throw new Error('This friend request is already in progress.')
      }
      inFlightRequestIds.current.add(input.requestId)

      try {
        return await friendApi.rejectRequest(input.requestId)
      } finally {
        inFlightRequestIds.current.delete(input.requestId)
      }
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.friends.incoming(viewerId) })
      const incoming = queryClient.getQueryData(queryKeys.friends.incoming(viewerId))
      const status = queryClient.getQueryData<FriendshipStatusResponse>(
        queryKeys.friends.status(viewerId, input.userId),
      )
      updateIncomingRequestPages(queryClient, viewerId, (data) =>
        removeFriendRequestFromPages(data, input.requestId),
      )
      updateFriendshipStatus(queryClient, viewerId, input.userId, { status: 'none' })
      return { incoming, status }
    },
    onSuccess: (response, input) => {
      if (!isCurrentViewer(viewerId)) return

      updateFriendshipStatus(queryClient, viewerId, input.userId, {
        status: response.status,
        ...(response.id ? { id: response.id } : {}),
      })
    },
    onError: (error, input, context) => {
      if (!isCurrentViewer(viewerId)) return

      queryClient.setQueryData(queryKeys.friends.incoming(viewerId), context?.incoming)
      queryClient.setQueryData(queryKeys.friends.status(viewerId, input.userId), context?.status)
      handleError(error, input.userId)
    },
    onSettled: () => {
      if (!isCurrentViewer(viewerId)) return
      return queryClient.invalidateQueries({ queryKey: queryKeys.friends.incoming(viewerId) })
    },
  })
}

export function useCancelFriendRequest() {
  const queryClient = useQueryClient()
  const viewerId = useAuthStore((state) => state.user?.id) ?? ''
  const inFlightRequestIds = useRef(new Set<string>())
  const handleError = useFriendMutationError(viewerId)

  return useMutation({
    mutationKey: [...queryKeys.friends.viewer(viewerId), 'cancel'] as const,
    mutationFn: async (input: CancelFriendRequestInput) => {
      ensureViewer(viewerId)
      if (inFlightRequestIds.current.has(input.requestId)) {
        throw new Error('This friend request is already in progress.')
      }
      inFlightRequestIds.current.add(input.requestId)

      try {
        return await friendApi.cancelRequest(input.requestId)
      } finally {
        inFlightRequestIds.current.delete(input.requestId)
      }
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.friends.outgoing(viewerId) })
      const outgoing = queryClient.getQueryData(queryKeys.friends.outgoing(viewerId))
      const status = queryClient.getQueryData<FriendshipStatusResponse>(
        queryKeys.friends.status(viewerId, input.userId),
      )
      updateOutgoingRequestPages(queryClient, viewerId, (data) =>
        removeFriendRequestFromPages(data, input.requestId),
      )
      updateFriendshipStatus(queryClient, viewerId, input.userId, { status: 'none' })
      return { outgoing, status }
    },
    onSuccess: (response, input) => {
      if (!isCurrentViewer(viewerId)) return

      updateFriendshipStatus(queryClient, viewerId, input.userId, {
        status: response.status,
        ...(response.id ? { id: response.id } : {}),
      })
    },
    onError: (error, input, context) => {
      if (!isCurrentViewer(viewerId)) return

      queryClient.setQueryData(queryKeys.friends.outgoing(viewerId), context?.outgoing)
      queryClient.setQueryData(queryKeys.friends.status(viewerId, input.userId), context?.status)
      handleError(error, input.userId)
    },
    onSettled: () => {
      if (!isCurrentViewer(viewerId)) return
      return queryClient.invalidateQueries({ queryKey: queryKeys.friends.outgoing(viewerId) })
    },
  })
}

export function useRemoveFriend() {
  const queryClient = useQueryClient()
  const viewerId = useAuthStore((state) => state.user?.id) ?? ''
  const inFlightUserIds = useRef(new Set<string>())
  const handleError = useFriendMutationError(viewerId)

  return useMutation({
    mutationKey: [...queryKeys.friends.viewer(viewerId), 'remove'] as const,
    mutationFn: async (userId: string) => {
      ensureViewer(viewerId)
      if (inFlightUserIds.current.has(userId)) {
        throw new Error('This friend action is already in progress.')
      }
      inFlightUserIds.current.add(userId)

      try {
        return await friendApi.removeFriend(userId)
      } finally {
        inFlightUserIds.current.delete(userId)
      }
    },
    onMutate: async (userId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.friends.list(viewerId, viewerId) })
      const friends = queryClient.getQueryData<FriendSummary[]>(
        queryKeys.friends.list(viewerId, viewerId),
      )
      const status = queryClient.getQueryData<FriendshipStatusResponse>(
        queryKeys.friends.status(viewerId, userId),
      )
      queryClient.setQueryData<FriendSummary[]>(
        queryKeys.friends.list(viewerId, viewerId),
        (data) => removeUserFromFriendList(data, userId),
      )
      updateFriendshipStatus(queryClient, viewerId, userId, { status: 'none' })
      return { friends, status }
    },
    onSuccess: (response, userId) => {
      if (!isCurrentViewer(viewerId)) return

      updateFriendshipStatus(queryClient, viewerId, userId, {
        status: response.status,
        ...(response.id ? { id: response.id } : {}),
      })
    },
    onError: (error, userId, context) => {
      if (!isCurrentViewer(viewerId)) return

      queryClient.setQueryData(queryKeys.friends.list(viewerId, viewerId), context?.friends)
      queryClient.setQueryData(queryKeys.friends.status(viewerId, userId), context?.status)
      handleError(error, userId)
    },
    onSettled: () => {
      if (!isCurrentViewer(viewerId)) return
      return queryClient.invalidateQueries({ queryKey: queryKeys.friends.list(viewerId, viewerId) })
    },
  })
}
