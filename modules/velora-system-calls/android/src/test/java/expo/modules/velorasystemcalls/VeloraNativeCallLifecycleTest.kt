package expo.modules.velorasystemcalls

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Looper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class VeloraNativeCallLifecycleTest {
  private lateinit var context: Context

  @Before
  fun setUp() {
    context = RuntimeEnvironment.getApplication()
    context.getSharedPreferences("velora_system_calls", Context.MODE_PRIVATE)
      .edit()
      .clear()
      .commit()
    VeloraSystemCallStore.setAuthenticatedUserId(context, "user-1")
  }

  @Test
  fun `ringing call transitions to active without cancelling ongoing notification`() {
    val callId = "call-active"
    val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val ringingId = VeloraCallNotifications.ringingNotificationId(callId)
    val ongoingId = VeloraCallNotifications.ongoingNotificationId(callId)

    assertTrue(VeloraSystemCallStore.beginRingingCall(context, callId, null))
    notificationManager.notify(ringingId, notification())
    notificationManager.notify(ongoingId, notification())
    VeloraSystemCallStore.storePendingAction(context, "answer", mapOf("callId" to callId))

    VeloraCallNotifications.handleCallStateUpdate(context, callStateUpdate(callId, "active"))

    assertEquals("active", VeloraSystemCallStore.getCurrentCall(context)?.phase)
    assertNull(shadowOf(notificationManager).getNotification(ringingId))
    assertNotNull(shadowOf(notificationManager).getNotification(ongoingId))
    assertNotNull(VeloraSystemCallStore.getPendingAction(context))
  }

  @Test
  fun `terminal cleanup clears matching native state and both notifications`() {
    val callId = "call-terminal"
    val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val ringingId = VeloraCallNotifications.ringingNotificationId(callId)
    val ongoingId = VeloraCallNotifications.ongoingNotificationId(callId)

    assertTrue(VeloraSystemCallStore.beginRingingCall(context, callId, null))
    assertTrue(VeloraSystemCallStore.markCallActive(context, callId))
    VeloraSystemCallStore.storePendingAction(context, "reject", mapOf("callId" to callId))
    notificationManager.notify(ringingId, notification())
    notificationManager.notify(ongoingId, notification())

    VeloraCallNotifications.handleCallStateUpdate(context, callStateUpdate(callId, "ended"))

    assertNull(VeloraSystemCallStore.getCurrentCall(context))
    assertNull(VeloraSystemCallStore.getPendingAction(context))
    assertNull(shadowOf(notificationManager).getNotification(ringingId))
    assertNull(shadowOf(notificationManager).getNotification(ongoingId))
    assertEquals(
      VeloraCallForegroundService::class.java.name,
      shadowOf(context as Application).getNextStoppedService().component?.className,
    )
  }

  @Test
  fun `terminal update for an older call does not replace an active call`() {
    val oldCallId = "call-old"
    val activeCallId = "call-active"
    val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    VeloraSystemCallStore.terminateCall(context, oldCallId, System.currentTimeMillis())
    assertTrue(VeloraSystemCallStore.beginRingingCall(context, activeCallId, null))
    assertTrue(VeloraSystemCallStore.markCallActive(context, activeCallId))
    notificationManager.notify(
      VeloraCallNotifications.ongoingNotificationId(activeCallId),
      notification(),
    )

    VeloraCallNotifications.handleCallStateUpdate(context, callStateUpdate(oldCallId, "ended"))

    assertEquals(activeCallId, VeloraSystemCallStore.getCurrentCall(context)?.callId)
    assertTrue(VeloraSystemCallStore.isActiveCall(context, activeCallId))
    assertNotNull(
      shadowOf(notificationManager).getNotification(
        VeloraCallNotifications.ongoingNotificationId(activeCallId),
      ),
    )
    assertNull(shadowOf(context as Application).getNextStoppedService())
  }

  @Test
  fun `terminal tombstone suppresses late incoming call until it expires`() {
    val callId = "call-late"

    VeloraSystemCallStore.terminateCall(context, callId, System.currentTimeMillis())
    assertFalse(VeloraSystemCallStore.beginRingingCall(context, callId, null))

    VeloraSystemCallStore.terminateCall(context, "call-delayed", System.currentTimeMillis() - 60_001)
    assertFalse(VeloraSystemCallStore.beginRingingCall(context, "call-delayed", null))
  }

  @Test
  fun `active update received before incoming call suppresses the late presentation`() {
    val callId = "call-active-before-incoming"

    VeloraCallNotifications.handleCallStateUpdate(context, callStateUpdate(callId, "active"))

    assertFalse(VeloraSystemCallStore.beginRingingCall(context, callId, null))
  }

  @Test
  fun `incoming payload with an invalid expiry is rejected`() {
    VeloraSystemCallStore.setAuthenticatedUserId(context, "user-1")

    assertFalse(
      VeloraSystemCallStore.shouldAcceptIncomingPayload(
        context,
        mapOf(
          "type" to "INCOMING_CALL",
          "callType" to "VOICE",
          "callId" to "call-invalid-expiry",
          "recipientUserId" to "user-1",
          "expiresAt" to "not-a-date",
        ),
      ),
    )
  }

  @Test
  fun `local expiry ends a ringing call and queues remote cleanup for React Native`() {
    val callId = "call-local-expiry"
    val expiresAtMs = System.currentTimeMillis() - 1
    val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    assertTrue(VeloraSystemCallStore.beginRingingCall(context, callId, expiresAtMs))
    notificationManager.notify(VeloraCallNotifications.ringingNotificationId(callId), notification())

    VeloraCallNotifications.handleIncomingCallExpiration(context, callId, expiresAtMs)

    assertNull(VeloraSystemCallStore.getCurrentCall(context))
    assertNull(shadowOf(notificationManager).getNotification(
      VeloraCallNotifications.ringingNotificationId(callId),
    ))
    assertEquals("remote_end", VeloraSystemCallStore.getPendingAction(context)?.get("action"))
    assertEquals("ended", VeloraSystemCallStore.getPendingAction(context)?.get("status"))
  }

  @Test
  fun `active update closes the matching incoming activity`() {
    val callId = "call-activity"
    assertTrue(VeloraSystemCallStore.beginRingingCall(context, callId, null))

    val activity = Robolectric.buildActivity(
      VeloraIncomingCallActivity::class.java,
      Intent(context, VeloraIncomingCallActivity::class.java).putExtra("callId", callId),
    ).setup().get()

    VeloraCallNotifications.handleCallStateUpdate(context, callStateUpdate(callId, "active"))
    shadowOf(Looper.getMainLooper()).idle()

    assertTrue(activity.isFinishing)
  }

  @Test
  fun `state update for another user cannot end this users active call`() {
    val callId = "call-wrong-recipient"
    assertTrue(VeloraSystemCallStore.beginRingingCall(context, callId, null))
    assertTrue(VeloraSystemCallStore.markCallActive(context, callId))

    VeloraCallNotifications.handleCallStateUpdate(
      context,
      callStateUpdate(callId, "ended", recipientUserId = "user-2"),
    )

    assertTrue(VeloraSystemCallStore.isActiveCall(context, callId))
  }

  @Test
  fun `malformed state update timestamp is ignored`() {
    val callId = "call-invalid-state-timestamp"
    assertTrue(VeloraSystemCallStore.beginRingingCall(context, callId, null))

    VeloraCallNotifications.handleCallStateUpdate(
      context,
      callStateUpdate(callId, "ended", at = "not-a-date"),
    )

    assertEquals(callId, VeloraSystemCallStore.getCurrentCall(context)?.callId)
  }

  @Test
  fun `account transition returns an existing native call for dismissal`() {
    val callId = "call-account-transition"
    assertTrue(VeloraSystemCallStore.beginRingingCall(context, callId, null))

    assertEquals(
      callId,
      VeloraSystemCallStore.setAuthenticatedUserId(context, null),
    )
    VeloraCallNotifications.endCall(context, callId)

    assertNull(VeloraSystemCallStore.getCurrentCall(context))
    assertFalse(VeloraSystemCallStore.beginRingingCall(context, callId, null))
  }

  private fun callStateUpdate(
    callId: String,
    status: String,
    recipientUserId: String = "user-1",
    at: String = "2026-07-17T00:00:00.000Z",
  ): Map<String, Any?> = mapOf(
    "type" to "CALL_STATE_UPDATE",
    "callId" to callId,
    "recipientUserId" to recipientUserId,
    "status" to status,
    "at" to at,
  )

  private fun notification(): Notification {
    val channelId = "test-calls"
    val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      notificationManager.createNotificationChannel(
        NotificationChannel(channelId, "Test calls", NotificationManager.IMPORTANCE_HIGH),
      )
    }
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, channelId)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }
      .setSmallIcon(android.R.drawable.sym_def_app_icon)
      .setContentTitle("Test call")
      .build()
  }
}
