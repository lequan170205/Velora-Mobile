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

    VeloraCallNotifications.handleCallStateUpdate(context, callId, "active", null)

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

    VeloraCallNotifications.handleCallStateUpdate(context, callId, "ended", null)

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

    VeloraCallNotifications.handleCallStateUpdate(context, oldCallId, "ended", null)

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

    VeloraSystemCallStore.terminateCall(context, "call-expired", System.currentTimeMillis() - 60_001)
    assertTrue(VeloraSystemCallStore.beginRingingCall(context, "call-expired", null))
  }

  @Test
  fun `active update closes the matching incoming activity`() {
    val callId = "call-activity"
    assertTrue(VeloraSystemCallStore.beginRingingCall(context, callId, null))

    val activity = Robolectric.buildActivity(
      VeloraIncomingCallActivity::class.java,
      Intent(context, VeloraIncomingCallActivity::class.java).putExtra("callId", callId),
    ).setup().get()

    VeloraCallNotifications.handleCallStateUpdate(context, callId, "active", null)
    shadowOf(Looper.getMainLooper()).idle()

    assertTrue(activity.isFinishing)
  }

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
