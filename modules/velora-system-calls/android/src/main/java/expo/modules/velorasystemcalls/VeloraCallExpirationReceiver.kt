package expo.modules.velorasystemcalls

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class VeloraCallExpirationReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      VeloraCallNotifications.incomingCallExpirationAction() -> {
        val callId = intent.getStringExtra("callId")?.takeIf { it.isNotBlank() } ?: return
        val expiresAtMs = intent.getLongExtra("expiresAtMs", 0L)
        if (expiresAtMs <= 0L) {
          return
        }

        VeloraCallNotifications.handleIncomingCallExpiration(context, callId, expiresAtMs)
      }
      VeloraCallNotifications.pendingAnswerWatchdogAction() -> {
        val callId = intent.getStringExtra("callId")?.takeIf { it.isNotBlank() } ?: return
        val actionId = intent.getStringExtra("actionId")?.takeIf { it.isNotBlank() } ?: return
        VeloraCallNotifications.handlePendingAnswerWatchdog(context, callId, actionId)
      }
    }
  }
}
