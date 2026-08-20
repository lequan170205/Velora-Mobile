package expo.modules.velorasystemcalls

import android.app.ActivityManager
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Person
import android.content.Context
import android.content.Intent
import android.os.Build

object VeloraCallNotifications {
  private const val CALL_CHANNEL_ID = "velora_calls"
  private const val RINGING_NOTIFICATION_SALT = 1
  private const val ONGOING_NOTIFICATION_SALT = 2
  private const val DISMISS_INCOMING_ACTIVITY_ACTION =
    "expo.modules.velorasystemcalls.DISMISS_INCOMING_ACTIVITY"
  private const val EXPIRE_INCOMING_CALL_ACTION =
    "expo.modules.velorasystemcalls.EXPIRE_INCOMING_CALL"
  private const val EXPIRY_ALARM_SALT = 4

  fun showIncomingCall(context: Context, rawPayload: Map<String, Any?>) {
    val payload = VeloraSystemCallStore.normalizePayload(rawPayload)
    if (!VeloraSystemCallStore.shouldAcceptIncomingPayload(context, payload)) {
      return
    }

    val callId = payload["callId"] as? String ?: return
    val expiresAtMs = (payload["expiresAt"] as? String)?.let(VeloraSystemCallStore::parseIsoDateMs)
    if (!VeloraSystemCallStore.beginRingingCall(context, callId, expiresAtMs)) {
      return
    }
    expiresAtMs?.let { scheduleIncomingCallExpiration(context, callId, it) }
    ensureCallChannel(context)

    val fullScreenIntent = Intent(context, VeloraIncomingCallActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
      putPayload(payload)
    }
    val fullScreenPendingIntent = PendingIntent.getActivity(
      context,
      requestCode(callId, 1),
      fullScreenIntent,
      pendingIntentFlags(),
    )

    val answerIntent = Intent(context, VeloraIncomingCallActivity::class.java).apply {
      flags =
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_CLEAR_TOP or
          Intent.FLAG_ACTIVITY_SINGLE_TOP
      action = "expo.modules.velorasystemcalls.ANSWER"
      putExtra("veloraAction", "answer")
      putPayload(payload)
    }
    val rejectIntent = Intent(context, VeloraCallActionReceiver::class.java).apply {
      action = "expo.modules.velorasystemcalls.REJECT"
      putExtra("veloraAction", "reject")
      putPayload(payload)
    }
    val answerPendingIntent = PendingIntent.getActivity(
      context,
      requestCode(callId, 2),
      answerIntent,
      pendingIntentFlags(),
    )
    val rejectPendingIntent = PendingIntent.getBroadcast(
      context,
      requestCode(callId, 3),
      rejectIntent,
      pendingIntentFlags(),
    )
    val callerName = callerName(payload)
    val incomingLabel = if (isVideoCall(payload)) "Incoming video call" else "Incoming voice call"
    val smallIcon = context.applicationInfo.icon

    val builder = notificationBuilder(context)
      .setSmallIcon(smallIcon)
      .setContentTitle(callerName)
      .setContentText(incomingLabel)
      .setCategory(Notification.CATEGORY_CALL)
      .setOngoing(true)
      .setAutoCancel(false)
      .setFullScreenIntent(fullScreenPendingIntent, true)
      .setPriority(Notification.PRIORITY_MAX)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setStyle(
        Notification.CallStyle.forIncomingCall(
          Person.Builder().setName(callerName).build(),
          rejectPendingIntent,
          answerPendingIntent,
        ),
      )
    } else {
      builder.addAction(Notification.Action.Builder(smallIcon, "Decline", rejectPendingIntent).build())
      builder.addAction(Notification.Action.Builder(smallIcon, "Answer", answerPendingIntent).build())
    }

    notificationManager(context).notify(ringingNotificationId(callId), builder.build())
  }

  fun registerOutgoingCall(context: Context, payload: Map<String, Any?>) {
    val callId = payload["callId"] as? String ?: return
    if (!VeloraSystemCallStore.beginRingingCall(context, callId, null)) {
      return
    }
    ensureCallChannel(context)
    notificationManager(context).notify(ringingNotificationId(callId), ongoingNotification(context, payload))
  }

  fun setCallActive(context: Context, callId: String): Boolean {
    if (!VeloraSystemCallStore.markCallActive(context, callId)) {
      return false
    }
    cancelIncomingCallExpiration(context, callId)
    dismissIncomingPresentation(context, callId)

    val intent = Intent(context, VeloraCallForegroundService::class.java).apply {
      action = "expo.modules.velorasystemcalls.START"
      putExtra("callId", callId)
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(intent)
    } else {
      context.startService(intent)
    }
    return true
  }

  fun endCall(context: Context, callId: String, eventAtMs: Long? = null) {
    cancelIncomingCallExpiration(context, callId)
    val shouldStopForegroundService = VeloraSystemCallStore.terminateCall(context, callId, eventAtMs)
    dismissIncomingPresentation(context, callId)
    if (shouldStopForegroundService) {
      context.stopService(Intent(context, VeloraCallForegroundService::class.java))
    }
    notificationManager(context).cancel(ongoingNotificationId(callId))
  }

  fun handleCallStateUpdate(context: Context, rawPayload: Map<String, Any?>) {
    val payload = VeloraSystemCallStore.normalizePayload(rawPayload)
    if (!VeloraSystemCallStore.shouldAcceptCallStateUpdatePayload(context, payload)) {
      return
    }

    val callId = payload["callId"] as String
    val status = payload["status"] as String
    val eventAt = payload["at"] as String

    when (status) {
      "active" -> {
        if (!VeloraSystemCallStore.markCallActive(context, callId)) {
          VeloraSystemCallStore.terminateCall(
            context,
            callId,
            VeloraSystemCallStore.parseIsoDateMs(eventAt),
          )
        }
        dismissIncomingPresentation(context, callId)
      }
      "rejected", "ended", "cancelled" -> {
        endCall(context, callId, VeloraSystemCallStore.parseIsoDateMs(eventAt))
      }
    }
  }

  internal fun handleIncomingCallExpiration(
    context: Context,
    callId: String,
    expiresAtMs: Long,
  ) {
    val currentCall = VeloraSystemCallStore.getCurrentCall(context)
    if (
      currentCall?.callId != callId ||
      currentCall.phase != "ringing" ||
      currentCall.expiresAtMs != expiresAtMs ||
      expiresAtMs > System.currentTimeMillis()
    ) {
      return
    }

    endCall(context, callId, eventAtMs = expiresAtMs)
    VeloraSystemCallStore.storePendingAction(
      context,
      "remote_end",
      mapOf(
        "callId" to callId,
        "status" to "ended",
        "reason" to "no_answer",
      ),
    )
  }

  fun dismissIncomingPresentation(context: Context, callId: String) {
    notificationManager(context).cancel(ringingNotificationId(callId))
    context.sendBroadcast(
      Intent(DISMISS_INCOMING_ACTIVITY_ACTION)
        .setPackage(context.packageName)
        .putExtra("callId", callId),
    )
  }

  fun launchMainActivity(context: Context) {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    context.startActivity(intent)
  }

  fun ongoingNotification(context: Context, payload: Map<String, Any?>): Notification {
    ensureCallChannel(context)
    val smallIcon = context.applicationInfo.icon
    val callerName = callerName(payload)
    val progressLabel = if (isVideoCall(payload)) "Velora video call in progress" else "Velora call in progress"

    return notificationBuilder(context)
      .setSmallIcon(smallIcon)
      .setContentTitle(callerName)
      .setContentText(progressLabel)
      .setCategory(Notification.CATEGORY_CALL)
      .setOngoing(true)
      .setPriority(Notification.PRIORITY_HIGH)
      .build()
  }

  fun isAppInForeground(context: Context): Boolean {
    val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      ?: return false
    val packageName = context.packageName
    return activityManager.runningAppProcesses?.any { process ->
      process.processName == packageName &&
        process.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    } == true
  }

  private fun ensureCallChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(
      CALL_CHANNEL_ID,
      "Calls",
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = "Incoming and active Velora calls"
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      enableVibration(true)
    }
    notificationManager(context).createNotificationChannel(channel)
  }

  private fun notificationManager(context: Context): NotificationManager =
    context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  private fun notificationBuilder(context: Context): Notification.Builder =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, CALL_CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }

  private fun callerName(payload: Map<String, Any?>): String =
    (payload["initiatorDisplayName"] as? String)?.takeIf { it.isNotBlank() } ?: "Velora call"

  private fun isVideoCall(payload: Map<String, Any?>): Boolean =
    (payload["callType"] as? String)?.uppercase() == "VIDEO"

  private fun Intent.putPayload(payload: Map<String, Any?>) {
    payload.forEach { (key, value) ->
      when (value) {
        is String -> putExtra(key, value)
        is Int -> putExtra(key, value)
        is Long -> putExtra(key, value)
        is Double -> putExtra(key, value)
        is Float -> putExtra(key, value)
        is Boolean -> putExtra(key, value)
        else -> putExtra(key, value?.toString())
      }
    }
  }

  fun ongoingNotificationId(callId: String): Int = notificationId(callId, ONGOING_NOTIFICATION_SALT)
  fun dismissIncomingActivityAction(): String = DISMISS_INCOMING_ACTIVITY_ACTION
  internal fun incomingCallExpirationAction(): String = EXPIRE_INCOMING_CALL_ACTION
  internal fun ringingNotificationId(callId: String): Int = notificationId(callId, RINGING_NOTIFICATION_SALT)
  private fun notificationId(callId: String, salt: Int): Int = 31 * callId.hashCode() + salt
  private fun requestCode(callId: String, salt: Int): Int = 31 * callId.hashCode() + salt

  private fun scheduleIncomingCallExpiration(context: Context, callId: String, expiresAtMs: Long) {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    val pendingIntent = incomingCallExpirationPendingIntent(context, callId, expiresAtMs)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, expiresAtMs, pendingIntent)
    } else {
      alarmManager.set(AlarmManager.RTC_WAKEUP, expiresAtMs, pendingIntent)
    }
  }

  internal fun cancelIncomingCallExpiration(context: Context, callId: String) {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    val pendingIntent = incomingCallExpirationPendingIntent(context, callId, 0L)
    alarmManager.cancel(pendingIntent)
    pendingIntent.cancel()
  }

  private fun incomingCallExpirationPendingIntent(
    context: Context,
    callId: String,
    expiresAtMs: Long,
  ): PendingIntent {
    val intent = Intent(context, VeloraCallExpirationReceiver::class.java).apply {
      action = EXPIRE_INCOMING_CALL_ACTION
      putExtra("callId", callId)
      putExtra("expiresAtMs", expiresAtMs)
    }
    return PendingIntent.getBroadcast(
      context,
      requestCode(callId, EXPIRY_ALARM_SALT),
      intent,
      pendingIntentFlags(),
    )
  }

  private fun pendingIntentFlags(): Int =
    PendingIntent.FLAG_UPDATE_CURRENT or
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
}
