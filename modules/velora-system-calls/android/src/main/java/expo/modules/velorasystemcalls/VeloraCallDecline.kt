package expo.modules.velorasystemcalls

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors

/**
 * Declines an incoming call from the notification while the app process (and
 * so the call socket) is gone. The push carries a signed, per-recipient
 * `declineToken`; the server verifies it and rejects that one invitation.
 * Without a token, an API address or a working network the app is opened
 * instead and replays the journaled reject, as before.
 */
object VeloraCallDecline {
  private const val TIMEOUT_MS = 5_000
  private val executor = Executors.newSingleThreadExecutor()

  /** Replaced in tests; returns the HTTP status code of the POST. */
  internal var post: (url: String, body: String) -> Int = ::postJson

  fun handleReject(context: Context, payload: Map<String, Any?>, onFinished: () -> Unit = {}) {
    val callId = payload["callId"] as? String ?: return onFinished()
    val appContext = context.applicationContext
    VeloraSystemCallStore.storePendingAction(appContext, "reject", payload)
    VeloraCallNotifications.dismissIncomingPresentation(appContext, callId)

    val token = (payload["declineToken"] as? String)?.takeIf { it.isNotBlank() }
    val baseUrl = VeloraSystemCallStore.getCallApiBaseUrl(appContext)
    if (token == null || baseUrl == null) {
      VeloraCallNotifications.launchMainActivity(appContext)
      return onFinished()
    }

    executor.execute {
      try {
        if (declineOverHttp(baseUrl, callId, token)) {
          VeloraSystemCallStore.pendingActionId(appContext, callId, "reject")
            ?.let { VeloraSystemCallStore.clearPendingAction(appContext, it) }
          VeloraCallNotifications.endCall(appContext, callId)
        } else {
          VeloraCallNotifications.launchMainActivity(appContext)
        }
      } finally {
        onFinished()
      }
    }
  }

  /**
   * True when the server no longer needs the app to do anything: the decline
   * was applied, the call was already answered/ended, or the token expired.
   */
  internal fun declineOverHttp(baseUrl: String, callId: String, token: String): Boolean {
    val url = "$baseUrl/calls/${URLEncoder.encode(callId, "UTF-8")}/decline"
    val status = try {
      post(url, JSONObject().put("token", token).toString())
    } catch (error: Exception) {
      return false
    }
    // 4xx other than a rate limit is final: retrying through the app cannot
    // change the outcome. Network errors and 5xx fall back to opening the app.
    return status in 200..299 || (status in 400..499 && status != 408 && status != 429)
  }

  private fun postJson(url: String, body: String): Int {
    val connection = URL(url).openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "POST"
      connection.connectTimeout = TIMEOUT_MS
      connection.readTimeout = TIMEOUT_MS
      connection.doOutput = true
      connection.setRequestProperty("Content-Type", "application/json")
      connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      return connection.responseCode
    } finally {
      connection.disconnect()
    }
  }
}
