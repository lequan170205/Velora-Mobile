package expo.modules.velorasystemcalls

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class VeloraFirebaseMessagingReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val payload = VeloraSystemCallStore.payloadFromIntent(intent)

    when (payload["type"]) {
      "INCOMING_CALL" -> {
        VeloraCallNotifications.showIncomingCall(context, payload)
      }
      "CALL_STATE_UPDATE" -> {
        (payload["callId"] as? String)?.let { callId ->
          VeloraCallNotifications.dismissCall(context, callId)
        }
      }
    }
  }
}
