package expo.modules.velorasystemcalls

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class VeloraCallForegroundService : Service() {
  private var activeCallId: String? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val callId = intent?.getStringExtra("callId")
      ?: VeloraSystemCallStore.getCurrentCall(this)
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
      ),
    )

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        VeloraCallNotifications.ongoingNotificationId(callId),
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL,
      )
    } else {
      startForeground(VeloraCallNotifications.ongoingNotificationId(callId), notification)
    }
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    activeCallId?.let { VeloraSystemCallStore.clearActiveCall(this, it) }
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }
}
