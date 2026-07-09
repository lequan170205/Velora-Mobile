package expo.modules.velorasystemcalls

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

class VeloraSystemCallsModule : Module() {
  private var callActionObserver: ((Map<String, Any?>) -> Unit)? = null

  override fun definition() = ModuleDefinition {
    Name("VeloraSystemCalls")
    Events("onCallAction", "onVoipTokenUpdated", "onAudioSessionActivated", "onAudioSessionConfigured")

    OnStartObserving("onCallAction") {
      val weakModule = WeakReference(this@VeloraSystemCallsModule)
      val observer: (Map<String, Any?>) -> Unit = { action ->
        weakModule.get()?.sendEvent("onCallAction", action)
      }
      VeloraSystemCallStore.addActionObserver(observer)
      callActionObserver = observer
    }

    OnStopObserving("onCallAction") {
      callActionObserver?.let(VeloraSystemCallStore::removeActionObserver)
      callActionObserver = null
    }

    Function("setAuthenticatedUserId") { userId: String? ->
      VeloraSystemCallStore.setAuthenticatedUserId(context, userId)
    }

    Function("getVoipToken") {
      null
    }

    Function("getPendingCallAction") {
      VeloraSystemCallStore.getPendingAction(context)
    }

    Function("clearPendingCallAction") { actionId: String? ->
      VeloraSystemCallStore.clearPendingAction(context, actionId)
    }

    Function("presentIncomingCall") { payload: Map<String, Any?> ->
      VeloraCallNotifications.showIncomingCall(context, payload)
    }

    Function("registerOutgoingCall") { payload: Map<String, Any?> ->
      VeloraCallNotifications.registerOutgoingCall(context, payload)
    }

    Function("setCallActive") { callId: String ->
      VeloraCallNotifications.setCallActive(context, callId)
    }

    Function("endCall") { callId: String ->
      VeloraCallNotifications.endCall(context, callId)
    }

    Function("dismissIncomingCall") { callId: String ->
      VeloraCallNotifications.dismissCall(context, callId)
    }
  }

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
}
