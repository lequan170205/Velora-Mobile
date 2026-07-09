package expo.modules.velorasystemcalls

import android.content.Context
import android.content.Intent
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

object VeloraSystemCallStore {
  private const val PREFS = "velora_system_calls"
  private const val KEY_AUTH_USER_ID = "currentAuthenticatedUserId"
  private const val KEY_PENDING_ACTION = "pendingAction"

  private val actionObservers = mutableSetOf<(Map<String, Any?>) -> Unit>()

  fun addActionObserver(observer: (Map<String, Any?>) -> Unit) {
    actionObservers.add(observer)
  }

  fun removeActionObserver(observer: (Map<String, Any?>) -> Unit) {
    actionObservers.remove(observer)
  }

  fun setAuthenticatedUserId(context: Context, userId: String?) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_AUTH_USER_ID, userId)
      .apply()
  }

  fun shouldAcceptIncomingPayload(context: Context, payload: Map<String, Any?>): Boolean {
    if (payload["type"] != "INCOMING_CALL" || payload["callType"] == "VIDEO") {
      return false
    }

    val callId = payload["callId"] as? String ?: return false
    if (callId.isBlank()) {
      return false
    }

    val recipientUserId = payload["recipientUserId"] as? String ?: return false
    val authenticatedUserId = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_AUTH_USER_ID, null)

    if (recipientUserId != authenticatedUserId) {
      return false
    }

    val expiresAt = payload["expiresAt"] as? String
    if (expiresAt != null && parseIsoDateMs(expiresAt)?.let { it <= System.currentTimeMillis() } == true) {
      return false
    }

    return true
  }

  fun storePendingAction(context: Context, action: String, payload: Map<String, Any?>) {
    val record = payload.toMutableMap()
    record["action"] = action
    record["actionId"] = java.util.UUID.randomUUID().toString()

    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_PENDING_ACTION, JSONObject(record).toString())
      .apply()

    actionObservers.forEach { observer -> observer(record) }
  }

  fun getPendingAction(context: Context): Map<String, Any?>? {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_PENDING_ACTION, null)
      ?: return null

    return jsonToMap(JSONObject(raw))
  }

  fun clearPendingAction(context: Context, actionId: String?) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val pendingActionId = getPendingAction(context)?.get("actionId") as? String

    if (actionId == null || pendingActionId == actionId) {
      prefs.edit().remove(KEY_PENDING_ACTION).apply()
    }
  }

  fun payloadFromIntent(intent: Intent): Map<String, Any?> {
    val extras = intent.extras ?: return emptyMap()
    return extras.keySet().associateWith { key -> extras.get(key) }
  }

  fun normalizePayload(payload: Map<String, Any?>): Map<String, Any?> {
    return payload.mapValues { (_, value) ->
      when (value) {
        is Number, is Boolean, is String -> value
        else -> value?.toString()
      }
    }
  }

  private fun jsonToMap(json: JSONObject): Map<String, Any?> {
    return json.keys().asSequence().associateWith { key -> json.opt(key) }
  }

  private fun parseIsoDateMs(value: String): Long? {
    val patterns = listOf(
      "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
      "yyyy-MM-dd'T'HH:mm:ss'Z'",
    )

    return patterns.firstNotNullOfOrNull { pattern ->
      runCatching {
        SimpleDateFormat(pattern, Locale.US).apply {
          timeZone = TimeZone.getTimeZone("UTC")
        }.parse(value)?.time
      }.getOrNull()
    }
  }
}
