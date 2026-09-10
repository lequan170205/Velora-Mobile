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
    assertEquals("remote_end", VeloraSystemCallStore.getPendingAction(context)?.get("action"))
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
  fun `remote state persists beyond the short terminal tombstone to suppress a delayed incoming push`() {
    val callId = "call-remote-state-before-incoming"

    VeloraCallNotifications.handleCallStateUpdate(
      context,
      callStateUpdate(callId, "active", lifecycleRevision = "3"),
    )
    // The legacy tombstone only lasts a minute. Removing it here proves the
    // durable remote-state record, rather than that short tombstone, blocks a
    // late incoming notification for the same call.
    context.getSharedPreferences("velora_system_calls", Context.MODE_PRIVATE)
      .edit()
      .remove("terminalCalls")
      .commit()

    assertFalse(VeloraSystemCallStore.beginRingingCall(context, callId, null))
  }

  @Test
  fun `terminal state cannot be undone by a later active update even with a newer revision`() {
    val callId = "call-terminal-state-wins"
    assertTrue(VeloraSystemCallStore.beginRingingCall(context, callId, null))

    VeloraCallNotifications.handleCallStateUpdate(
      context,
      callStateUpdate(callId, "active", lifecycleRevision = "3"),
    )
    VeloraCallNotifications.handleCallStateUpdate(
      context,
      callStateUpdate(callId, "ended", lifecycleRevision = "4"),
    )
    VeloraCallNotifications.handleCallStateUpdate(
      context,
      callStateUpdate(callId, "active", lifecycleRevision = "5"),
    )

    assertNull(VeloraSystemCallStore.getCurrentCall(context))
    assertEquals("remote_end", VeloraSystemCallStore.getPendingAction(context)?.get("action"))
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
  fun `accepted answer becomes a silent resume intent until native media is active`() {
    val callId = "call-journal-answer"
    assertTrue(VeloraSystemCallStore.beginRingingCall(context, callId, null))
    VeloraSystemCallStore.storePendingAction(
      context,
      "answer",
      mapOf(
        "callId" to callId,
        "expiresAt" to futureIsoTimestamp(),
      ),
    )
    val action = VeloraSystemCallStore.getPendingAction(context)
    val actionId = action?.get("actionId") as? String

    assertNotNull(actionId)
    assertEquals("user-1", action?.get("accountId"))
    assertTrue(action?.get("revision") is Number)
    assertTrue(action?.get("journalExpiresAtMs") is Number)
    assertTrue(VeloraSystemCallStore.completePendingAnswer(context, actionId!!, true, null))
    val resume = VeloraSystemCallStore.getPendingAction(context)
    assertEquals("resume", resume?.get("action"))
    assertEquals(actionId, resume?.get("answerActionId"))
    assertTrue(VeloraCallNotifications.setCallActive(context, callId))
    assertNull(VeloraSystemCallStore.getPendingAction(context))
    assertTrue(VeloraSystemCallStore.completePendingAnswer(context, actionId, true, null))
  }

  @Test
  fun `unconfirmed answer journal never outlives the server call deadline`() {
    val callId = "call-answer-deadline"
    val expiresAtMs = System.currentTimeMillis() + 5_000L
    val expiresAt = isoTimestamp(expiresAtMs)

    VeloraSystemCallStore.storePendingAction(
      context,
      "answer",
      mapOf("callId" to callId, "expiresAt" to expiresAt),
    )

    val journalExpiresAtMs = VeloraSystemCallStore.getPendingAction(context)
      ?.get("journalExpiresAtMs") as? Number
    assertNotNull(journalExpiresAtMs)
    assertTrue(journalExpiresAtMs!!.toLong() <= expiresAtMs)
  }

  @Test
  fun `pending action journal keeps the call contract but strips raw push secrets`() {
    val callId = "call-sanitized-journal"
    VeloraSystemCallStore.storePendingAction(
      context,
      "answer",
      mapOf(
        "type" to "INCOMING_CALL",
        "callId" to callId,
        "conversationId" to "conversation-1",
        "initiatorId" to "user-2",
        "targetUserId" to "user-1",
        "recipientUserId" to "user-1",
        "callType" to "VOICE",
        "initiatorDisplayName" to "Caller",
        "ringTimeoutMs" to 30_000,
        "expiresAt" to futureIsoTimestamp(),
        "telemetryToken" to "journalSensitiveToken",
        "authorization" to "Bearer journalSensitiveToken",
        "aps" to mapOf("content-available" to 1),
      ),
    )

    val action = VeloraSystemCallStore.getPendingAction(context)
    val rawJournal = context.getSharedPreferences("velora_system_calls", Context.MODE_PRIVATE)
      .getString("pendingActions", "")

    assertEquals(callId, action?.get("callId"))
    assertEquals("conversation-1", action?.get("conversationId"))
    assertEquals("user-2", action?.get("initiatorId"))
    assertNull(action?.get("telemetryToken"))
    assertNull(action?.get("authorization"))
    assertNull(action?.get("aps"))
    assertFalse(rawJournal.orEmpty().contains("journalSensitiveToken"))
    assertFalse(rawJournal.orEmpty().contains("\"aps\""))
  }

  @Test
  fun `matching active update preserves a pending resume while another device wins over it`() {
    val callId = "call-resume-winner"
    assertTrue(VeloraSystemCallStore.beginRingingCall(context, callId, null))
    VeloraSystemCallStore.storePendingAction(context, "answer", mapOf("callId" to callId))
    val answerActionId = VeloraSystemCallStore.getPendingAction(context)?.get("actionId") as? String
    assertNotNull(answerActionId)
    assertTrue(VeloraSystemCallStore.completePendingAnswer(context, answerActionId!!, true, null))

    VeloraCallNotifications.handleCallStateUpdate(
      context,
      callStateUpdate(callId, "active", answerActionId = answerActionId),
    )
    assertEquals("resume", VeloraSystemCallStore.getPendingAction(context)?.get("action"))

    VeloraCallNotifications.handleCallStateUpdate(
      context,
      callStateUpdate(callId, "active", answerActionId = "another-device-action"),
    )
    assertEquals("remote_end", VeloraSystemCallStore.getPendingAction(context)?.get("action"))
    assertEquals(
      "answered_elsewhere",
      VeloraSystemCallStore.getPendingAction(context)?.get("reason"),
    )
  }

  @Test
  fun `terminal journal action supersedes a late answer on the same call`() {
    val callId = "call-terminal-wins"
    VeloraSystemCallStore.storePendingAction(context, "answer", mapOf("callId" to callId))
    val answerActionId = VeloraSystemCallStore.getPendingAction(context)?.get("actionId") as? String

    VeloraSystemCallStore.storePendingAction(
      context,
      "remote_end",
      mapOf("callId" to callId, "status" to "cancelled", "reason" to "cancelled"),
    )

    assertEquals("remote_end", VeloraSystemCallStore.getPendingAction(context)?.get("action"))
    assertFalse(VeloraSystemCallStore.completePendingAnswer(context, answerActionId!!, true, null))
  }

  @Test
  fun `pending answer watchdog ends only the still-pending native answer`() {
    val callId = "call-answer-watchdog"
    assertTrue(VeloraSystemCallStore.beginRingingCall(context, callId, null))
    VeloraSystemCallStore.storePendingAction(context, "answer", mapOf("callId" to callId))
    val actionId = VeloraSystemCallStore.pendingAnswerAction(context, callId)
      ?.get("actionId") as? String
    assertNotNull(actionId)

    VeloraCallNotifications.handlePendingAnswerWatchdog(context, callId, actionId!!)

    assertNull(VeloraSystemCallStore.getCurrentCall(context))
    assertEquals("remote_end", VeloraSystemCallStore.getPendingAction(context)?.get("action"))
    assertEquals(
      "native_answer_confirmation_timeout",
      VeloraSystemCallStore.getPendingAction(context)?.get("reason"),
    )
  }

  @Test
  fun `pending answer watchdog is ignored after native answer completion`() {
    val callId = "call-answer-watchdog-completed"
    assertTrue(VeloraSystemCallStore.beginRingingCall(context, callId, null))
    VeloraSystemCallStore.storePendingAction(context, "answer", mapOf("callId" to callId))
    val actionId = VeloraSystemCallStore.pendingAnswerAction(context, callId)
      ?.get("actionId") as? String
    assertNotNull(actionId)
    assertTrue(VeloraSystemCallStore.completePendingAnswer(context, actionId!!, true, null))

    VeloraCallNotifications.handlePendingAnswerWatchdog(context, callId, actionId)

    assertEquals(callId, VeloraSystemCallStore.getCurrentCall(context)?.callId)
    assertEquals("resume", VeloraSystemCallStore.getPendingAction(context)?.get("action"))
  }

  @Test
  fun `matching active update converts an unacknowledged native answer into a resume intent`() {
    val callId = "call-active-before-answer-ack"
    assertTrue(VeloraSystemCallStore.beginRingingCall(context, callId, null))
    VeloraSystemCallStore.storePendingAction(context, "answer", mapOf("callId" to callId))
    val actionId = VeloraSystemCallStore.pendingAnswerAction(context, callId)
      ?.get("actionId") as? String
    assertNotNull(actionId)

    VeloraCallNotifications.handleCallStateUpdate(
      context,
      callStateUpdate(callId, "active", answerActionId = actionId),
    )
    // Simulate the alarm firing after the original client ACK was lost. The
    // matching server state must have converted answer -> resume, so it cannot
    // locally end the already-active call.
    VeloraCallNotifications.handlePendingAnswerWatchdog(context, callId, actionId!!)

    assertTrue(VeloraSystemCallStore.isActiveCall(context, callId))
    assertEquals("resume", VeloraSystemCallStore.getPendingAction(context)?.get("action"))
  }

  @Test
  fun `active update from another answer action wins over local pending answer`() {
    val callId = "call-other-device-won"
    assertTrue(VeloraSystemCallStore.beginRingingCall(context, callId, null))
    VeloraSystemCallStore.storePendingAction(context, "answer", mapOf("callId" to callId))

    VeloraCallNotifications.handleCallStateUpdate(
      context,
      callStateUpdate(callId, "active", answerActionId = "another-device-action"),
    )

    assertNull(VeloraSystemCallStore.getCurrentCall(context))
    assertEquals("remote_end", VeloraSystemCallStore.getPendingAction(context)?.get("action"))
    assertEquals(
      "answered_elsewhere",
      VeloraSystemCallStore.getPendingAction(context)?.get("reason"),
    )
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
  fun `malformed lifecycle revision is ignored before it can end a call`() {
    val callId = "call-invalid-lifecycle-revision"
    assertTrue(VeloraSystemCallStore.beginRingingCall(context, callId, null))
    assertTrue(VeloraSystemCallStore.markCallActive(context, callId))

    VeloraCallNotifications.handleCallStateUpdate(
      context,
      callStateUpdate(callId, "ended", lifecycleRevision = "04"),
    )

    assertTrue(VeloraSystemCallStore.isActiveCall(context, callId))
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

  @Test
  fun `journal action keeps the call owner when auth changes before native cleanup`() {
    val callId = "call-account-owner"

    // The incoming payload was created for user-1, but a logout/account switch
    // can complete before CallKit/notification cleanup records its terminal
    // action. That action must never become owned by the newly signed-in user.
    VeloraSystemCallStore.setAuthenticatedUserId(context, "user-2")
    VeloraSystemCallStore.storePendingAction(
      context,
      "end",
      mapOf(
        "callId" to callId,
        "recipientUserId" to "user-1",
      ),
    )

    assertEquals(
      "user-1",
      VeloraSystemCallStore.getPendingAction(context)?.get("accountId"),
    )
  }

  private fun callStateUpdate(
    callId: String,
    status: String,
    recipientUserId: String = "user-1",
    at: String = "2026-07-17T00:00:00.000Z",
    answerActionId: String? = null,
    lifecycleRevision: String? = null,
  ): Map<String, Any?> = buildMap {
    put("type", "CALL_STATE_UPDATE")
    put("callId", callId)
    put("recipientUserId", recipientUserId)
    put("status", status)
    put("at", at)
    answerActionId?.let { put("answerActionId", it) }
    lifecycleRevision?.let { put("lifecycleRevision", it) }
  }

  private fun futureIsoTimestamp(): String = isoTimestamp(System.currentTimeMillis() + 60_000L)

  private fun isoTimestamp(timestampMs: Long): String = java.text.SimpleDateFormat(
    "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
    java.util.Locale.US,
  ).apply {
    timeZone = java.util.TimeZone.getTimeZone("UTC")
  }.format(java.util.Date(timestampMs))

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
