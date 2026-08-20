package expo.modules.velorasystemcalls

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class VeloraIncomingCallActivity : Activity() {
  private var payload: Map<String, Any?> = emptyMap()
  private var dismissReceiverRegistered = false
  private val dismissReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      val dismissedCallId = intent.getStringExtra("callId") ?: return
      val currentCallId = payload["callId"] as? String ?: return
      if (dismissedCallId == currentCallId) {
        finish()
      }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    showOverLockScreen()
    payload = VeloraSystemCallStore.payloadFromIntent(intent)

    if (handleNotificationAction(intent)) {
      return
    }

    render()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    payload = VeloraSystemCallStore.payloadFromIntent(intent)

    if (!handleNotificationAction(intent)) {
      render()
    }
  }

  override fun onStart() {
    super.onStart()
    val callId = payload["callId"] as? String
    if (callId == null || !VeloraSystemCallStore.shouldKeepIncomingPresentation(this, callId)) {
      finish()
      return
    }

    val filter = IntentFilter(VeloraCallNotifications.dismissIncomingActivityAction())
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(dismissReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      registerReceiver(dismissReceiver, filter)
    }
    dismissReceiverRegistered = true
  }

  override fun onStop() {
    if (dismissReceiverRegistered) {
      unregisterReceiver(dismissReceiver)
      dismissReceiverRegistered = false
    }
    super.onStop()
  }

  private fun handleNotificationAction(intent: Intent): Boolean {
    val action = intent.getStringExtra("veloraAction")
    if (action != "answer" && action != "reject") {
      return false
    }

    complete(action)
    return true
  }

  private fun render() {
    val callerName = (payload["initiatorDisplayName"] as? String)
      ?.takeIf { it.isNotBlank() }
      ?: "Velora call"
    val isVideoCall = (payload["callType"] as? String)?.uppercase() == "VIDEO"

    val container = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setPadding(48, 48, 48, 48)
      setBackgroundColor(0xFF101820.toInt())
    }
    val title = TextView(this).apply {
      text = callerName
      textSize = 28f
      gravity = Gravity.CENTER
      setTextColor(0xFFFFFFFF.toInt())
    }
    val subtitle = TextView(this).apply {
      text = if (isVideoCall) "Incoming video call" else "Incoming voice call"
      textSize = 16f
      gravity = Gravity.CENTER
      setTextColor(0xFFD6E4EA.toInt())
    }
    val answer = Button(this).apply {
      text = "Answer"
      setOnClickListener { complete("answer") }
    }
    val reject = Button(this).apply {
      text = "Decline"
      setOnClickListener { complete("reject") }
    }

    container.addView(title)
    container.addView(subtitle)
    container.addView(answer)
    container.addView(reject)
    setContentView(container)
  }

  private fun complete(action: String) {
    val callId = payload["callId"] as? String ?: return
    VeloraCallNotifications.cancelIncomingCallExpiration(this, callId)
    VeloraSystemCallStore.storePendingAction(this, action, payload)
    VeloraCallNotifications.dismissIncomingPresentation(this, callId)
    VeloraCallNotifications.launchMainActivity(this)
    finish()
  }

  private fun showOverLockScreen() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
      )
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }
}
