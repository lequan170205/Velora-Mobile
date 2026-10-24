package expo.modules.velorasystemcalls

import android.Manifest
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class VeloraCallForegroundService : Service() {
  private var activeCallId: String? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val currentCall = VeloraSystemCallStore.getCurrentCall(this)
    val callId = intent?.getStringExtra("callId")
      ?: currentCall
        ?.takeIf { it.phase == "active" }
        ?.callId
    if (callId == null || !VeloraSystemCallStore.isActiveCall(this, callId)) {
      stopSelfResult(startId)
      return START_NOT_STICKY
    }

    activeCallId = callId
    val notification = VeloraCallNotifications.ongoingNotification(
      this,
      mapOf(
        "callId" to callId,
        "initiatorDisplayName" to "Velora call",
        "callType" to currentCall?.takeIf { it.callId == callId }?.callType,
      ),
    )

    val notificationId = VeloraCallNotifications.ongoingNotificationId(callId)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && hasRecordAudioPermission()) {
      // Android 11+ silences microphone capture once the app leaves the
      // foreground unless a microphone-type service is running, so the other
      // side heard nothing while the user was outside the app.
      try {
        startForeground(
          notificationId,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL or
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
        )
      } catch (error: SecurityException) {
        // Android 14+ refuses the microphone type while the app is not in an
        // eligible state; keep the call alive as a phone-call service instead.
        startForeground(notificationId, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
      }
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(notificationId, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
    } else {
      startForeground(notificationId, notification)
    }
    return START_STICKY
  }

  private fun hasRecordAudioPermission(): Boolean =
    checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    activeCallId?.let { VeloraSystemCallStore.clearActiveCall(this, it) }
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }
}
