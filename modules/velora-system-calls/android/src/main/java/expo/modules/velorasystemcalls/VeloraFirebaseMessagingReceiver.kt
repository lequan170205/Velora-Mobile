package expo.modules.velorasystemcalls

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class VeloraFirebaseMessagingReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val payload = VeloraSystemCallStore.normalizePayload(
      VeloraSystemCallStore.payloadFromIntent(intent),
    )

    when (payload["type"]) {
      "INCOMING_CALL" -> VeloraCallNotifications.showIncomingCall(context, payload)
      "CALL_STATE_UPDATE" -> VeloraCallNotifications.handleCallStateUpdate(context, payload)
    }
  }
}
