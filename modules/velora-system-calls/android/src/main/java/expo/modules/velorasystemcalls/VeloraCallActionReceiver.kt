package expo.modules.velorasystemcalls

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class VeloraCallActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val payload = VeloraSystemCallStore.payloadFromIntent(intent)
    val callId = payload["callId"] as? String ?: return
    val action = intent.getStringExtra("veloraAction") ?: return

    VeloraSystemCallStore.storePendingAction(context, action, payload)
    VeloraCallNotifications.dismissIncomingPresentation(context, callId)
    VeloraCallNotifications.launchMainActivity(context)
  }
}
