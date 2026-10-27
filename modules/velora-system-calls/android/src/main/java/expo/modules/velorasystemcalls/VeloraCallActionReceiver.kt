package expo.modules.velorasystemcalls

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class VeloraCallActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val payload = VeloraSystemCallStore.payloadFromIntent(intent)
    val callId = payload["callId"] as? String ?: return
    val action = intent.getStringExtra("veloraAction") ?: return

    if (action == "reject") {
      // Keep the receiver alive while the decline request is in flight.
      val pending = goAsync()
      VeloraCallDecline.handleReject(context, payload) { pending.finish() }
      return
    }

    VeloraSystemCallStore.storePendingAction(context, action, payload)
    VeloraCallNotifications.dismissIncomingPresentation(context, callId)
    VeloraCallNotifications.launchMainActivity(context)
  }
}
