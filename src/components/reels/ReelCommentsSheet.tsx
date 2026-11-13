import { Ionicons } from '@expo/vector-icons'
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  useBottomSheetInternal,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet'
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import * as Crypto from 'expo-crypto'
import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import React, { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native'
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import Animated, {
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated'
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
import { colors, radius } from '../../constants/theme'
import { useAuthStore } from '../../stores/authStore'
import { ComposerSendButton } from '../chat/ComposerSendButton'

import type { SharedValue } from 'react-native-reanimated'

// Fractions of the screen the sheet covers: resting, and while the keyboard is up.
export const COMMENTS_SHEET_RESTING_SNAP = 0.62
export const COMMENTS_SHEET_TYPING_SNAP = 0.92
const SNAP_POINTS = [
  `${COMMENTS_SHEET_RESTING_SNAP * 100}%`,
  `${COMMENTS_SHEET_TYPING_SNAP * 100}%`,
]
const TYPING_PADDING = 8
const SHEET_HANDLE_HEIGHT = 30

export type ReelCommentsDetails = {
  authorName: string
  avatarUrl?: string | null | undefined
  initials: string
  description?: string | undefined
  hashtags: string[]
}

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
    return parentId ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry loading replies"
        hitSlop={8}
        onPress={() => void query.refetch()}
      >
        <Text className="font-sans py-3 text-xs2 font-semibold text-brand">
          Couldn’t load replies. Retry
        </Text>
      </Pressable>
    ) : (
      <View className="flex-1 items-center justify-center px-8 py-10">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-surface-muted">
          <Ionicons name="cloud-offline-outline" size={26} color={colors.text.secondary} />
        </View>
        <Text className="mt-4 text-center font-heading text-lg text-text-primary">
          Couldn’t load comments
        </Text>
        <Text className="font-sans mt-1 text-center text-sm2 text-text-secondary">
          Check your connection and try again.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading comments"
          disabled={query.isFetching}
          onPress={() => void query.refetch()}
          className="mt-5 h-10 min-w-[120px] items-center justify-center rounded-full bg-brand px-6"
          style={query.isFetching ? { opacity: 0.6 } : undefined}
        >
          {query.isFetching ? (
            <ActivityIndicator color={colors.text.inverse} size="small" />
          ) : (
            <Text className="font-sans text-sm2 font-semibold text-white">Try again</Text>
          )}
        </Pressable>
      </View>
    )
  if (!items.length)
    return parentId ? (
      <Text className="font-sans py-3 text-xs2 text-text-muted">No replies yet.</Text>
    ) : (
      <View className="flex-1 items-center justify-center px-8 py-10">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-brand-soft">
          <Ionicons name="chatbubble-ellipses-outline" size={26} color={colors.brand.primary} />
        </View>
        <Text className="mt-4 text-center font-heading text-lg text-text-primary">
          No comments yet
        </Text>
        <Text className="font-sans mt-1 text-center text-sm2 text-text-secondary">
          Be the first to share what you think.
        </Text>
      </View>
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
              <View className="mr-3 h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-brand-soft">
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
                <Text className="text-sm2 font-semibold text-text-primary">
                  {comment.deletedAt ? 'Deleted comment' : name}
                </Text>
                <Text className="font-sans mt-0.5 text-base2 text-text-primary">
                  {comment.text ?? 'This comment was deleted.'}
                </Text>
                {comment.id.startsWith('pending:') ? (
                  <Text className="font-sans mt-1 text-xs2 text-text-muted">Sending…</Text>
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

// gorhom sizes the sheet to its tallest snap point and slides it down at lower ones, so a
// flex-filled body would leave the composer below the screen edge. Fit the body to the part of
// the sheet that is actually on screen instead: it follows the sheet through every snap point
// and drag, and gives up the keyboard's height while typing (the window does not resize under
// the keyboard, edge-to-edge). The composer therefore always sits at the visible bottom.
function SheetBody({ children }: { children: React.ReactNode }) {
  const { animatedDetentsState, animatedPosition, animatedSheetHeight } = useBottomSheetInternal()
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation()
  const style = useAnimatedStyle(() => {
    const containerHeight =
      (animatedDetentsState.value.highestDetentPosition ?? 0) + animatedSheetHeight.value
    const visible =
      containerHeight -
      animatedPosition.value -
      SHEET_HANDLE_HEIGHT -
      Math.abs(keyboardHeight.value)

    return { height: Math.max(0, visible) }
  })

  return <Animated.View style={style}>{children}</Animated.View>
}

function ReelDetailsHeader({ details }: { details: ReelCommentsDetails }) {
  return (
    <View className="pb-4 pt-1">
      <View className="flex-row items-center">
        <View className="h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-brand-soft">
          {details.avatarUrl?.trim() ? (
            <Image
              source={{ uri: details.avatarUrl }}
              contentFit="cover"
              style={styles.avatar}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <Text className="text-sm2 font-semibold text-brand">{details.initials}</Text>
          )}
        </View>
        <Text
          className="ml-3 min-w-0 flex-1 text-base2 font-semibold text-text-primary"
          numberOfLines={1}
        >
          {details.authorName}
        </Text>
      </View>
      {details.description ? (
        <Text className="font-sans mt-4 text-base2 text-text-primary">{details.description}</Text>
      ) : null}
      {details.hashtags.length ? (
        <Text className="mt-1.5 text-sm2 font-semibold text-brand">
          {details.hashtags.join(' ')}
        </Text>
      ) : null}
    </View>
  )
}

export type ReelCommentsSheetHandle = {
  present: () => void
  dismiss: () => void
}

type ReelCommentsSheetProps = {
  reelId: string
  viewerId: string
  reelOwnerId: string
  details: ReelCommentsDetails
  // Lets the reel behind the sheet follow it as it moves.
  animatedPosition?: SharedValue<number>
  onCommentCountChange: (count: number) => void
  // Reports the sheet's real state (presented / fully dismissed), however it changed.
  onOpenChange: (open: boolean) => void
}

// Opened and closed through the imperative handle rather than a `visible` prop: a tap always
// presents the sheet, and there is no second "is it open" flag here that can drift out of sync
// with the modal.
export const ReelCommentsSheet = React.forwardRef<ReelCommentsSheetHandle, ReelCommentsSheetProps>(
  function ReelCommentsSheet(
    {
      reelId,
      viewerId,
      reelOwnerId,
      details,
      animatedPosition,
      onCommentCountChange,
      onOpenChange,
    },
    ref,
  ) {
    const sheetRef = useRef<BottomSheetModal>(null)
    const scrollRef = useRef<React.ComponentRef<typeof BottomSheetScrollView>>(null)
    const inputRef = useRef<React.ComponentRef<typeof BottomSheetTextInput>>(null)
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
    const { height: keyboardHeight } = useReanimatedKeyboardAnimation()
    const bottomInset = Math.max(insets.bottom, 12)
    const composerInsetStyle = useAnimatedStyle(() => ({
      paddingBottom: interpolate(
        Math.abs(keyboardHeight.value),
        [0, 40],
        [bottomInset, TYPING_PADDING],
        Extrapolation.CLAMP,
      ),
    }))
    const syncCommentCount = useCallback(async () => {
      const count = await refreshSeriesCommentCount(client, viewerId, reelId, scope)
      if (scope() && typeof count === 'number') onCommentCountChange(count)
    }, [client, onCommentCountChange, reelId, scope, viewerId])
    useImperativeHandle(
      ref,
      () => ({
        present: () => {
          sheetRef.current?.present()
          onOpenChange(true)
          void syncCommentCount().catch(() => {})
        },
        dismiss: () => sheetRef.current?.dismiss(),
      }),
      [onOpenChange, syncCommentCount],
    )
    // The reel stays visible above the sheet, so the backdrop only catches taps. It keeps a
    // barely-there tint because fully transparent views are not hit-testable on every platform, and
    // it closes through a plain RN press so the tap cannot also reach the reel's gesture handlers.
    const backdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          opacity={0.02}
          pressBehavior="none"
        >
          <Pressable
            accessibilityLabel="Close comments"
            accessibilityRole="button"
            style={StyleSheet.absoluteFill}
            onPress={() => sheetRef.current?.dismiss()}
          />
        </BottomSheetBackdrop>
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
        Keyboard.dismiss()
        scrollRef.current?.scrollTo({ y: 0, animated: true })
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
    const hasText = text.trim().length > 0
    const isEditing = target?.kind === 'edit'
    const userInitial = (user?.username || user?.fullName || 'V').trim().slice(0, 1).toUpperCase()
    const beginTarget = (kind: 'reply' | 'edit', comment: ReelComment) => {
      if (busy.current) return
      setTarget({ kind, comment })
      setText(kind === 'edit' ? (comment.text ?? '') : '')
      inputRef.current?.focus()
    }
    return (
      <BottomSheetModal
        ref={sheetRef}
        snapPoints={SNAP_POINTS}
        enableDynamicSizing={false}
        enablePanDownToClose
        {...(animatedPosition ? { animatedPosition } : {})}
        backdropComponent={backdrop}
        backgroundStyle={styles.background}
        handleIndicatorStyle={styles.handle}
        onDismiss={() => onOpenChange(false)}
        keyboardBehavior="extend"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
      >
        <SheetBody>
          <BottomSheetScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.listContent}
          >
            <ReelDetailsHeader details={details} />
            <View className="-mx-5 h-px bg-border-light" />
            <CommentList
              reelId={reelId}
              viewerId={viewerId}
              reelOwnerId={reelOwnerId}
              scope={scope}
              parentId={null}
              enabled
              onReply={(comment) => beginTarget('reply', comment)}
              onEdit={(comment) => beginTarget('edit', comment)}
              onDelete={remove}
            />
          </BottomSheetScrollView>
          <Animated.View
            style={composerInsetStyle}
            className="border-t border-border-light px-3 pt-2"
          >
            {target ? (
              <Animated.View
                entering={FadeIn.duration(140)}
                exiting={FadeOut.duration(100)}
                className="mb-2 flex-row justify-between px-1"
              >
                <Text className="font-sans text-xs2 text-text-secondary">
                  {isEditing
                    ? 'Editing comment'
                    : `Replying to ${commentAuthorLabel(target.comment)}`}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                  hitSlop={8}
                  onPress={() => {
                    if (busy.current) return
                    setTarget(null)
                    setText('')
                  }}
                >
                  <Text className="text-xs2 font-semibold text-brand">Cancel</Text>
                </Pressable>
              </Animated.View>
            ) : null}
            <View className="flex-row items-end">
              <View className="mb-1 mr-2 h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-brand-soft">
                {user?.picture?.trim() ? (
                  <Image
                    source={{ uri: user.picture }}
                    contentFit="cover"
                    style={styles.avatar}
                    accessibilityIgnoresInvertColors
                  />
                ) : (
                  <Text className="text-sm2 font-semibold text-brand">{userInitial}</Text>
                )}
              </View>
              <View style={styles.pill}>
                <BottomSheetTextInput
                  ref={inputRef}
                  accessibilityLabel="Write a comment"
                  editable={!saving}
                  value={text}
                  onChangeText={setText}
                  maxLength={2000}
                  multiline
                  placeholder={
                    target?.kind === 'reply'
                      ? `Reply to ${commentAuthorLabel(target.comment)}…`
                      : 'Add a comment…'
                  }
                  placeholderTextColor={colors.text.tertiary}
                  style={styles.input}
                />
                {hasText ? (
                  <Animated.View
                    entering={ZoomIn.duration(140)}
                    exiting={ZoomOut.duration(100)}
                    style={saving ? styles.saving : undefined}
                  >
                    <ComposerSendButton
                      accessibilityLabel={isEditing ? 'Save comment' : 'Post comment'}
                      icon={isEditing ? 'check' : 'send'}
                      disabled={saving}
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                          () => undefined,
                        )
                        void submit()
                      }}
                    />
                  </Animated.View>
                ) : null}
              </View>
            </View>
          </Animated.View>
        </SheetBody>
      </BottomSheetModal>
    )
  },
)

const styles = StyleSheet.create({
  avatar: { height: '100%', width: '100%' },
  background: {
    backgroundColor: colors.surface.modal,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handle: { backgroundColor: colors.border.strong, width: 40 },
  input: {
    color: colors.text.primary,
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    maxHeight: 100,
    minHeight: 40,
    paddingBottom: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  listContent: { flexGrow: 1, paddingBottom: 16, paddingHorizontal: 20 },
  pill: {
    alignItems: 'flex-end',
    backgroundColor: colors.surface.muted,
    borderRadius: radius.xl,
    flex: 1,
    flexDirection: 'row',
    minHeight: 44,
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  saving: { opacity: 0.5 },
})
