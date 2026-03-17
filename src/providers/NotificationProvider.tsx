import * as Notifications from 'expo-notifications'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useRef } from 'react'
import { registerPushToken, unregisterAllTokens } from '../api/notification.api'
import { useMessageNotifications } from '../hooks/useMessageNotifications'
import { useAuthStore } from '../stores/authStore'

// Configure notification handler at module level
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

interface NotificationPayload {
  type?: string
  conversationId?: string
  senderId?: string
  senderName?: string
  messageContent?: string
  [key: string]: unknown
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { isAuthenticated, user } = useAuthStore()
  const responseListener = useRef<Notifications.EventSubscription | null>(null)
  const notificationListener = useRef<Notifications.EventSubscription | null>(null)

  // Initialize message notifications hook (handles in-app notifications)
  useMessageNotifications()

  // Handle notification interaction (tap)
  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const payload = response.notification.request.content.data as NotificationPayload

      if (payload?.conversationId) {
        // Navigate to conversation
        router.push(`/conversation/${payload.conversationId}`)
      }
    },
    [router],
  )

  // Register push token when user is authenticated
  useEffect(() => {
    if (isAuthenticated && user) {
      registerPushToken().catch((error) => {
        console.error('Failed to register push token:', error)
      })
    } else if (!isAuthenticated && user === null) {
      // User logged out, unregister tokens
      unregisterAllTokens().catch((error) => {
        console.error('Failed to unregister push tokens:', error)
      })
    }
  }, [isAuthenticated, user])

  // Set up notification listeners
  useEffect(() => {
    // Listener for notifications received while app is in foreground
    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      const payload = notification.request.content.data as NotificationPayload
      console.log('Notification received:', payload)
    })

    // Listener for notification interaction (tap)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse,
    )

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove()
      }
      if (responseListener.current) {
        responseListener.current.remove()
      }
    }
  }, [handleNotificationResponse])

  return children
}
