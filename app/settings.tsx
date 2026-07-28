import { MaterialIcons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { OfflineNetworkToggle } from '@/components/dev/OfflineNetworkToggle'

import { queryKeys } from '../src/constants/queryKeys'
import { resetLocalDatabase } from '../src/database/DatabaseManager'
import { useReelSavingMode } from '../src/hooks/useReelSavingMode'
import {
  removeFriendMutationsForViewer,
  removeFriendshipQueriesForViewer,
  removeBlockedUsersQueriesForViewer,
} from '../src/lib/friendCache'
import { performLogoutPushTokenCleanup } from '../src/lib/notifications/pushTokenLifecycle'
import { clearTemporaryReelVideoCache } from '../src/lib/offlineReelVideoCache'
import { removeRecommendationQueriesForUser } from '../src/lib/recommendationCache'
import { clearReelPlaybackVideoCache } from '../src/lib/reelPlaybackVideoCache'
import { getSavedReelVideoStorageStats } from '../src/lib/reelVideoStorageStats'
import { reelEventQueue } from '../src/services/reelEventQueue'
import { useAuthStore } from '../src/stores/authStore'
import { useChatStore } from '../src/stores/chatStore'
import { useProfileUiStore } from '../src/stores/profileUiStore'

import type { SavedReelVideoStorageStats } from '../src/lib/reelVideoStorageStats'

type SettingsAction = 'clear-cache' | 'clear-local-database' | 'clear-saved-reel-data' | 'sign-out'

function SettingsSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <View className="mt-7">
      <Text className="mb-3 text-xs2 uppercase tracking-[1.1px] text-text-muted">{title}</Text>
      <View className="gap-3">{children}</View>
    </View>
  )
}

function SettingsActionRow({
  description,
  disabled = false,
  icon,
  isDestructive = false,
  isLoading = false,
  label,
  onPress,
  showsChevron = false,
}: {
  description: string
  disabled?: boolean
  icon: keyof typeof MaterialIcons.glyphMap
  isDestructive?: boolean
  isLoading?: boolean
  label: string
  onPress: () => void
  showsChevron?: boolean
}) {
  const iconBackground = isDestructive ? 'bg-[#FFF1EE]' : 'bg-white'
  const labelClassName = isDestructive
    ? 'font-medium text-md text-status-error'
    : 'font-medium text-md text-text-primary'

  return (
    <Pressable
      accessibilityHint={description}
      accessibilityLabel={label}
      accessibilityRole="button"
      className="min-h-[80px] flex-row items-center rounded-[24px] bg-surface-muted px-4 py-4"
      disabled={disabled}
      onPress={onPress}
      style={{ opacity: disabled ? 0.62 : 1 }}
    >
      <View className={`h-12 w-12 items-center justify-center rounded-full ${iconBackground}`}>
        <MaterialIcons name={icon} size={20} color={isDestructive ? '#FF3B30' : '#161616'} />
      </View>
      <View className="ml-3 flex-1 pr-3">
        <Text className={labelClassName}>{label}</Text>
        <Text className="mt-1 text-sm2 text-text-secondary">{description}</Text>
      </View>
      {isLoading ? (
        <ActivityIndicator color={isDestructive ? '#FF3B30' : '#161616'} size="small" />
      ) : null}
      {showsChevron && !isLoading ? (
        <MaterialIcons name="chevron-right" size={20} color="#BEBEBE" />
      ) : null}
    </Pressable>
  )
}

function SettingsToggleRow({
  description,
  disabled,
  icon,
  label,
  onValueChange,
  value,
}: {
  description: string
  disabled: boolean
  icon: keyof typeof MaterialIcons.glyphMap
  label: string
  onValueChange: (nextValue: boolean) => void
  value: boolean
}) {
  return (
    <View className="min-h-[80px] flex-row items-center rounded-[24px] bg-surface-muted px-4 py-4">
      <View className="h-12 w-12 items-center justify-center rounded-full bg-white">
        <MaterialIcons name={icon} size={20} color="#161616" />
      </View>
      <View className="ml-3 flex-1 pr-4">
        <Text className="font-medium text-md text-text-primary">{label}</Text>
        <Text className="mt-1 text-sm2 text-text-secondary">{description}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        disabled={disabled}
        ios_backgroundColor="#D9D9D9"
        onValueChange={onValueChange}
        thumbColor="#FFFFFF"
        trackColor={{ false: '#D9D9D9', true: 'rgba(255,107,44,0.72)' }}
        value={value}
      />
    </View>
  )
}

export default function SettingsScreen() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const insets = useSafeAreaInsets()
  const isMountedRef = useRef(true)
  const pendingActionRef = useRef<SettingsAction | null>(null)
  const { user, clearAuth } = useAuthStore()
  const { clearCache } = useChatStore()
  const { reelSavingModeEnabled, setReelSavingModeEnabled } = useReelSavingMode()
  const clearPendingFeedbackMessage = useProfileUiStore(
    (state) => state.clearPendingFeedbackMessage,
  )
  const pendingFeedbackMessage = useProfileUiStore((state) => state.pendingFeedbackMessage)
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<SettingsAction | null>(null)
  const [savedReelVideoStorageStats, setSavedReelVideoStorageStats] =
    useState<SavedReelVideoStorageStats | null>(null)

  const isBusy = pendingAction !== null

  const loadSavedReelVideoStorageStats = useCallback(async () => {
    try {
      const stats = await getSavedReelVideoStorageStats()

      if (isMountedRef.current) {
        setSavedReelVideoStorageStats(stats)
      }
    } catch {
      if (isMountedRef.current) {
        setSavedReelVideoStorageStats(null)
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!feedbackMessage) {
      return
    }

    const timeoutId = setTimeout(() => {
      setFeedbackMessage(null)
    }, 2200)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [feedbackMessage])

  useFocusEffect(
    useCallback(() => {
      void loadSavedReelVideoStorageStats()

      if (pendingFeedbackMessage) {
        setFeedbackMessage(pendingFeedbackMessage)
        clearPendingFeedbackMessage()
      }
    }, [clearPendingFeedbackMessage, loadSavedReelVideoStorageStats, pendingFeedbackMessage]),
  )

  const closeSettings = useCallback(() => {
    if (router.canGoBack()) {
      router.back()
      return
    }

    router.replace('/(tabs)/profile')
  }, [router])

  const runAction = useCallback(
    async (action: SettingsAction) => {
      if (pendingActionRef.current) {
        return
      }

      pendingActionRef.current = action
      setPendingAction(action)

      try {
        if (action === 'clear-cache') {
          await clearCache()
          queryClient.clear()
          setFeedbackMessage('Cache cleared')
          return
        }

        if (action === 'clear-local-database') {
          queryClient.removeQueries({ queryKey: queryKeys.conversations.all })
          await resetLocalDatabase()
          setFeedbackMessage('Local database cleared')
          return
        }

        if (action === 'clear-saved-reel-data') {
          await Promise.all([clearTemporaryReelVideoCache(), clearReelPlaybackVideoCache()])
          setFeedbackMessage('Saved reel data cleared')
          await loadSavedReelVideoStorageStats()
          return
        }

        const logoutResult = await performLogoutPushTokenCleanup()

        if (!logoutResult.ok) {
          console.error('[Settings] Logout cleanup will retry when possible')
        }

        await clearCache()
        await resetLocalDatabase()

        if (user?.id) {
          await reelEventQueue.clearUser(user.id)
          removeRecommendationQueriesForUser(queryClient, user.id)
          removeFriendshipQueriesForViewer(queryClient, user.id)
          removeBlockedUsersQueriesForViewer(queryClient, user.id)
          removeFriendMutationsForViewer(queryClient, user.id)
          queryClient.removeQueries({ queryKey: queryKeys.reels.friends(user.id) })
        }
      } catch (error) {
        console.error(`[Settings] Failed to ${action}`, error)

        if (isMountedRef.current) {
          setFeedbackMessage(
            action === 'clear-local-database'
              ? 'Failed to clear local database'
              : action === 'clear-saved-reel-data'
                ? 'Failed to clear saved reel data'
                : action === 'clear-cache'
                  ? 'Failed to clear cache'
                  : 'Failed to sign out',
          )
        }
      } finally {
        pendingActionRef.current = null

        if (action === 'sign-out') {
          clearAuth()
        } else if (isMountedRef.current) {
          setPendingAction(null)
        }
      }
    },
    [clearAuth, clearCache, loadSavedReelVideoStorageStats, queryClient, user?.id],
  )

  const confirmAction = useCallback(
    (action: SettingsAction) => {
      if (isBusy) {
        return
      }

      const copy = {
        'clear-cache': {
          confirm: 'Clear',
          message:
            'Messages will sync again from the server the next time you open the conversation.',
          title: 'Clear cache?',
        },
        'clear-local-database': {
          confirm: 'Delete',
          message:
            'This deletes the on-device message database. Conversations will sync again when you reopen them.',
          title: 'Clear local database?',
        },
        'clear-saved-reel-data': {
          confirm: 'Clear',
          message: 'This removes temporary reel videos stored on this device.',
          title: 'Clear saved reel data?',
        },
        'sign-out': {
          confirm: 'Sign out',
          message: 'This ends the current session on this device and clears the local cache.',
          title: 'Sign out?',
        },
      }[action]

      Alert.alert(copy.title, copy.message, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: copy.confirm,
          style:
            action === 'clear-local-database' || action === 'sign-out' ? 'destructive' : 'default',
          onPress: () => {
            void runAction(action)
          },
        },
      ])
    },
    [isBusy, runAction],
  )

  const clearSavedReelDataDescription =
    savedReelVideoStorageStats && savedReelVideoStorageStats.videoCount > 0
      ? `Removes temporary reel videos stored on this device. Reel videos: ${savedReelVideoStorageStats.sizeLabel}.`
      : 'Removes temporary reel videos stored on this device.'

  if (!user) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-bg-primary">
        <ActivityIndicator color="#FF6B2C" size="large" />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary" edges={['top']}>
      {feedbackMessage ? (
        <View
          pointerEvents="none"
          className="absolute inset-x-0 z-20 items-center"
          style={{ top: insets.top + 8 }}
        >
          <View className="rounded-full px-4 py-2" style={{ backgroundColor: '#161616' }}>
            <Text className="text-sm2 text-white">{feedbackMessage}</Text>
          </View>
        </View>
      ) : null}

      <View className="flex-row items-center px-5 pb-4 pt-2">
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          className="mr-3 h-11 w-11 items-center justify-center rounded-full border border-border-light bg-surface-card"
          disabled={isBusy}
          onPress={closeSettings}
        >
          <MaterialIcons name="arrow-back" size={22} color="#161616" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-xs2 uppercase tracking-[1.2px] text-text-muted">Profile</Text>
          <Text className="mt-1 font-heading text-[28px] text-text-primary">Settings</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom, 24) + 32,
          paddingHorizontal: 20,
        }}
        showsVerticalScrollIndicator={false}
      >
        <SettingsSection title="Account">
          <SettingsActionRow
            description="Update your name and username."
            icon="person-outline"
            label="Edit profile"
            onPress={() => router.push('/account')}
            showsChevron
          />
        </SettingsSection>

        <SettingsSection title="Privacy">
          <SettingsActionRow
            description="Review accounts you have blocked."
            icon="block"
            label="Blocked accounts"
            onPress={() => router.push('/blocked-accounts')}
            showsChevron
          />
        </SettingsSection>

        <SettingsSection title="Reels & storage">
          <SettingsToggleRow
            description="Save nearby reels so they can play when your connection is poor."
            disabled={isBusy}
            icon="play-circle-outline"
            label="Reel saving mode"
            onValueChange={setReelSavingModeEnabled}
            value={reelSavingModeEnabled}
          />
          <SettingsActionRow
            description={clearSavedReelDataDescription}
            disabled={isBusy}
            icon="delete-sweep"
            isLoading={pendingAction === 'clear-saved-reel-data'}
            label="Clear saved reel data"
            onPress={() => confirmAction('clear-saved-reel-data')}
          />
        </SettingsSection>

        <SettingsSection title="Device data">
          <SettingsActionRow
            description="Remove local chat data from this device."
            disabled={isBusy}
            icon="delete-sweep"
            isLoading={pendingAction === 'clear-cache'}
            label="Clear cache"
            onPress={() => confirmAction('clear-cache')}
          />
          <OfflineNetworkToggle />
          <SettingsActionRow
            description="Delete the on-device message database."
            disabled={isBusy}
            icon="storage"
            isDestructive
            isLoading={pendingAction === 'clear-local-database'}
            label="Clear local database"
            onPress={() => confirmAction('clear-local-database')}
          />
        </SettingsSection>

        <SettingsSection title="Danger zone">
          <SettingsActionRow
            description="End the current session on this device."
            disabled={isBusy}
            icon="logout"
            isDestructive
            isLoading={pendingAction === 'sign-out'}
            label="Sign out"
            onPress={() => confirmAction('sign-out')}
          />
        </SettingsSection>
      </ScrollView>
    </SafeAreaView>
  )
}
