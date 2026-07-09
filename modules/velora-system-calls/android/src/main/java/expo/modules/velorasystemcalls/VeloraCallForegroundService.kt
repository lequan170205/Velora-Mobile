package expo.modules.velorasystemcalls

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class VeloraCallForegroundService : Service() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val callId = intent?.getStringExtra("callId") ?: "velora-call"
    val notification = VeloraCallNotifications.ongoingNotification(
      this,
      mapOf(
        "callId" to callId,
        "initiatorDisplayName" to "Velora call",
      ),
    )

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        callId.hashCode(),
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL,
      )
    } else {
      startForeground(callId.hashCode(), notification)
    }
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
