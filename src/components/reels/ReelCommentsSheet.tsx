import { MaterialIcons } from '@expo/vector-icons'
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet'
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import * as Crypto from 'expo-crypto'
import { Image } from 'expo-image'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  commentPermissions,
  commentScope,
  completePendingComment,
  prependComment,
  pendingCommentId,
  removePendingComment,
  replacePendingComment,
  refreshSeriesCommentCount,
  reelCommentsApi,
  type CommentScope,
  type ReelComment,
  type ReelCommentPage,
} from '../../api/reelComments.api'
import { queryKeys } from '../../constants/queryKeys'
import { colors } from '../../constants/theme'
import { useAuthStore } from '../../stores/authStore'

type CommentListProps = {
  reelId: string
  viewerId: string
  reelOwnerId: string
  scope: CommentScope
  parentId: string | null
  enabled: boolean
  onReply: (comment: ReelComment) => void
  onEdit: (comment: ReelComment) => void
  onDelete: (comment: ReelComment) => void
}

const commentAuthorLabel = (comment: ReelComment) => {
  const username = comment.author?.username?.trim()
  return username ? `@${username}` : comment.author?.displayName?.trim() || 'Velora user'
}

const commentQueryKey = (
  viewerId: string,
  reelId: string,
  scope: CommentScope,
  parentId: string | null,
) => [...queryKeys.reels.comments(viewerId, reelId), scope.version, parentId]

function CommentList({
  reelId,
  viewerId,
  reelOwnerId,
  scope,
  parentId,
  enabled,
  onReply,
  onEdit,
  onDelete,
}: CommentListProps) {
  const [expanded, setExpanded] = useState<string[]>([])
  const query = useInfiniteQuery({
    queryKey: commentQueryKey(viewerId, reelId, scope, parentId),
    queryFn: ({ pageParam }) =>
      reelCommentsApi.list(scope, reelId, parentId, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: enabled && !!viewerId,
  })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  if (query.isPending && query.fetchStatus !== 'idle')
    return (
      <View className="items-center pt-8">
        <ActivityIndicator color={colors.brand.primary} />
      </View>
    )
  if (query.isError && !query.data)
    return (
      <Pressable onPress={() => void query.refetch()} accessibilityRole="button">
        <Text className="text-center text-text-secondary">
          Could not load comments. Tap to retry.
        </Text>
      </Pressable>
    )
  if (!items.length)
    return (
      <Text className="py-6 text-center text-text-secondary">
        {parentId ? 'No replies yet.' : 'No comments yet. Start the conversation.'}
      </Text>
    )
  return (
    <View>
      {items.map((comment) => {
        const name = commentAuthorLabel(comment)
        const avatarName = comment.author?.username || comment.author?.displayName || 'Velora user'
        const isExpanded = expanded.includes(comment.id)
        const permissions = commentPermissions(comment, viewerId, reelOwnerId)
        return (
          <View key={comment.id} className={parentId ? 'ml-6 mt-3' : 'mt-4'}>
            <View className="flex-row items-start">
              <View className="mr-3 h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-brand-soft">
                {comment.deletedAt ? (
                  <Text className="font-semibold text-brand">–</Text>
                ) : comment.author?.avatarUrl?.trim() ? (
                  <Image
                    source={{ uri: comment.author.avatarUrl }}
                    contentFit="cover"
                    style={styles.avatar}
                  />
                ) : (
                  <Text className="font-semibold text-brand">
                    {avatarName.slice(0, 1).toUpperCase()}
                  </Text>
                )}
              </View>
              <View className="flex-1">
                <Text className="font-semibold text-text-primary">
                  {comment.deletedAt ? 'Deleted comment' : name}
                </Text>
                <Text className="mt-1 text-text-primary">
                  {comment.text ?? 'This comment was deleted.'}
                </Text>
                {comment.id.startsWith('pending:') ? (
                  <Text className="mt-1 text-xs2 text-text-muted">Sending…</Text>
                ) : null}
                <View className="mt-2 flex-row gap-4">
                  {!comment.deletedAt && !parentId ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setExpanded((current) =>
                          current.includes(comment.id) ? current : [...current, comment.id],
                        )
                        onReply(comment)
                      }}
                    >
                      <Text className="text-xs2 font-semibold text-text-secondary">Reply</Text>
                    </Pressable>
                  ) : null}
                  {permissions.edit ? (
                    <Pressable accessibilityRole="button" onPress={() => onEdit(comment)}>
                      <Text className="text-xs2 font-semibold text-text-secondary">Edit</Text>
                    </Pressable>
                  ) : null}
                  {permissions.delete ? (
                    <Pressable accessibilityRole="button" onPress={() => onDelete(comment)}>
                      <Text className="text-xs2 font-semibold text-text-secondary">Delete</Text>
                    </Pressable>
                  ) : null}
                </View>
                {!parentId && comment.replyCount > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      setExpanded((current) =>
                        isExpanded
                          ? current.filter((id) => id !== comment.id)
                          : [...current, comment.id],
                      )
                    }
                  >
                    <Text className="mt-2 text-xs2 font-semibold text-brand">
                      {isExpanded ? 'Hide replies' : `View replies (${comment.replyCount})`}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
            {isExpanded ? (
              <CommentList
                reelId={reelId}
                viewerId={viewerId}
                reelOwnerId={reelOwnerId}
                scope={scope}
                parentId={comment.id}
                enabled={enabled}
                onReply={onReply}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ) : null}
          </View>
        )
      })}
      {query.hasNextPage ? (
        <Pressable
          accessibilityRole="button"
          disabled={query.isFetchingNextPage}
          onPress={() => void query.fetchNextPage()}
        >
          <Text className="py-4 text-center font-semibold text-brand">
            {query.isFetchingNextPage
              ? 'Loading…'
              : query.isFetchNextPageError
                ? 'Retry loading more'
                : 'Load more'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

export function ReelCommentsSheet({
  visible,
  reelId,
  viewerId,
  reelOwnerId,
  onCommentCountChange,
  onClose,
}: {
  visible: boolean
  reelId: string
  viewerId: string
  reelOwnerId: string
  onCommentCountChange: (count: number) => void
  onClose: () => void
}) {
  const sheetRef = useRef<BottomSheetModal>(null)
  const presented = useRef(false)
  const scope = useMemo(() => commentScope(viewerId), [viewerId])
  const busy = useRef(false)
  const [text, setText] = useState('')
  const [target, setTarget] = useState<{ kind: 'reply' | 'edit'; comment: ReelComment } | null>(
    null,
  )
  const [saving, setSaving] = useState(false)
  const insets = useSafeAreaInsets()
  const client = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const syncCommentCount = useCallback(async () => {
    const count = await refreshSeriesCommentCount(client, viewerId, reelId, scope)
    if (scope() && typeof count === 'number') onCommentCountChange(count)
  }, [client, onCommentCountChange, reelId, scope, viewerId])
  useEffect(() => {
    if (visible && viewerId) {
      if (!presented.current) {
        presented.current = true
        sheetRef.current?.present()
      }
      void syncCommentCount().catch(() => {})
    } else if (presented.current) {
      presented.current = false
      sheetRef.current?.dismiss()
    }
  }, [syncCommentCount, visible, viewerId])
  const backdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.46}
        pressBehavior="close"
      />
    ),
    [],
  )
  const refresh = () => {
    if (!scope()) return
    void syncCommentCount().catch(() => {})
    void client.invalidateQueries({ queryKey: queryKeys.reels.comments(viewerId, reelId) })
    void client.invalidateQueries({ queryKey: queryKeys.reels.detail(viewerId, reelId) })
    void client.invalidateQueries({ queryKey: queryKeys.reels.lists(viewerId) })
    void client.invalidateQueries({ queryKey: queryKeys.reels.contexts(viewerId) })
    void client.invalidateQueries({ queryKey: queryKeys.reels.recommended(viewerId).slice(0, 3) })
    void client.invalidateQueries({ queryKey: queryKeys.reels.friends(viewerId) })
  }
  const submit = async () => {
    const value = text.trim()
    if (!value || busy.current || !scope()) return
    busy.current = true
    setSaving(true)
    let optimisticId: string | null = null
    let cacheKey: ReturnType<typeof commentQueryKey> | null = null
    try {
      if (target?.kind === 'edit')
        await reelCommentsApi.update(scope, reelId, target.comment.id, value)
      else {
        const parentId = target?.comment.id ?? null
        const id = pendingCommentId(viewerId, reelId, parentId, value, Crypto.randomUUID)
        const pendingId = `pending:${id}`
        const queryKey = commentQueryKey(viewerId, reelId, scope, parentId)
        optimisticId = pendingId
        cacheKey = queryKey
        await client.cancelQueries({ queryKey })
        client.setQueryData<InfiniteData<ReelCommentPage, string | null>>(queryKey, (data) =>
          prependComment(data, {
            id: pendingId,
            reelId,
            parentId,
            text: value,
            replyCount: 0,
            deletedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            author: user
              ? {
                  id: user.id,
                  username: user.username ?? null,
                  displayName: user.fullName ?? null,
                  avatarUrl: user.picture ?? null,
                  isVerified: null,
                }
              : null,
          }),
        )
        const created = await reelCommentsApi.create(scope, reelId, parentId, value, id)
        client.setQueryData<InfiniteData<ReelCommentPage, string | null>>(queryKey, (data) =>
          replacePendingComment(data, pendingId, created),
        )
        completePendingComment(viewerId, reelId, parentId, value, id)
      }
      setText('')
      setTarget(null)
      refresh()
    } catch {
      if (optimisticId && cacheKey) {
        const pendingId = optimisticId
        client.setQueryData<InfiniteData<ReelCommentPage, string | null>>(cacheKey, (data) =>
          removePendingComment(data, pendingId),
        )
      }
      if (scope()) Alert.alert('Comment not saved', 'Please try again.')
    } finally {
      busy.current = false
      setSaving(false)
    }
  }
  const remove = (comment: ReelComment) =>
    Alert.alert('Delete comment?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (busy.current || !scope()) return
          busy.current = true
          setSaving(true)
          try {
            await reelCommentsApi.delete(scope, reelId, comment.id)
            refresh()
          } catch {
            if (scope()) Alert.alert('Could not delete comment', 'Please try again.')
          } finally {
            busy.current = false
            setSaving(false)
          }
        },
      },
    ])
  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={['80%']}
      enableDynamicSizing={false}
      enablePanDownToClose
      backdropComponent={backdrop}
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.handle}
      onDismiss={() => {
        presented.current = false
        onClose()
      }}
      keyboardBehavior="interactive"
      android_keyboardInputMode="adjustResize"
    >
      <View className="flex-1">
        <View className="flex-row items-center justify-between border-b border-border-light px-5 pb-3">
          <View className="w-10" />
          <Text className="font-heading text-lg text-text-primary">Comments</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close comments"
            onPress={() => {
              presented.current = false
              onClose()
              sheetRef.current?.dismiss()
            }}
            className="h-10 w-10 items-center justify-center"
          >
            <MaterialIcons name="close" size={22} color={colors.text.primary} />
          </Pressable>
        </View>
        <BottomSheetScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
        >
          <CommentList
            reelId={reelId}
            viewerId={viewerId}
            reelOwnerId={reelOwnerId}
            scope={scope}
            parentId={null}
            enabled={visible}
            onReply={(comment) => {
              if (busy.current) return
              setTarget({ kind: 'reply', comment })
              setText('')
            }}
            onEdit={(comment) => {
              if (busy.current) return
              setTarget({ kind: 'edit', comment })
              setText(comment.text ?? '')
            }}
            onDelete={remove}
          />
        </BottomSheetScrollView>
        <View
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
          className="border-t border-border-light px-4 pt-3"
        >
          {target ? (
            <View className="mb-2 flex-row justify-between">
              <Text className="text-xs2 text-text-secondary">
                {target.kind === 'edit'
                  ? 'Editing comment'
                  : `Replying to ${commentAuthorLabel(target.comment)}`}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (busy.current) return
                  setTarget(null)
                  setText('')
                }}
              >
                <Text className="text-xs2 text-brand">Cancel</Text>
              </Pressable>
            </View>
          ) : null}
          <View className="flex-row items-center rounded-full bg-surface-muted px-4">
            <BottomSheetTextInput
              accessibilityLabel="Write a comment"
              editable={!saving}
              value={text}
              onChangeText={setText}
              maxLength={2000}
              multiline
              placeholder="Add a comment…"
              placeholderTextColor={colors.text.tertiary}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={target?.kind === 'edit' ? 'Save comment' : 'Post comment'}
              disabled={!text.trim() || saving}
              onPress={() => void submit()}
            >
              <Text className="font-semibold text-brand">
                {saving ? 'Saving…' : target?.kind === 'edit' ? 'Save' : 'Post'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </BottomSheetModal>
  )
}

const styles = StyleSheet.create({
  avatar: { height: '100%', width: '100%' },
  background: {
    backgroundColor: colors.surface.modal,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },
  handle: { backgroundColor: colors.border.strong, width: 56 },
  input: {
    color: colors.text.primary,
    flex: 1,
    maxHeight: 100,
    minHeight: 48,
    paddingVertical: 10,
  },
})
