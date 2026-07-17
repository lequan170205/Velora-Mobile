package expo.modules.velorasystemcalls

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class VeloraCallExpirationReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != VeloraCallNotifications.incomingCallExpirationAction()) {
      return
    }

    val callId = intent.getStringExtra("callId")?.takeIf { it.isNotBlank() } ?: return
    val expiresAtMs = intent.getLongExtra("expiresAtMs", 0L)
    if (expiresAtMs <= 0L) {
      return
    }

    VeloraCallNotifications.handleIncomingCallExpiration(context, callId, expiresAtMs)
  }
}
