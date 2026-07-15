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
  private const val KEY_CURRENT_CALL = "currentCall"
  private const val KEY_TERMINAL_CALLS = "terminalCalls"
  private const val PHASE_RINGING = "ringing"
  private const val PHASE_ACTIVE = "active"
  private const val TERMINAL_CALL_TTL_MS = 60_000L
  private const val MAX_TERMINAL_CALLS = 32

  data class CurrentCall(
    val callId: String,
    val phase: String,
    val expiresAtMs: Long?,
  )

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

  @Synchronized
  fun beginRingingCall(context: Context, callId: String, expiresAtMs: Long?): Boolean {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val now = System.currentTimeMillis()
    val terminalCalls = readTerminalCalls(prefs).filterValues { it > now }.toMutableMap()
    writeTerminalCalls(prefs, terminalCalls)

    if (terminalCalls.containsKey(callId)) {
      return false
    }

    val currentCall = readCurrentCall(prefs)
    if (currentCall?.phase == PHASE_RINGING &&
      currentCall.expiresAtMs != null &&
      currentCall.expiresAtMs <= now
    ) {
      clearCurrentCall(prefs)
    } else if (currentCall != null && currentCall.callId != callId) {
      return false
    }

    writeCurrentCall(
      prefs,
      CurrentCall(
        callId = callId,
        phase = PHASE_RINGING,
        expiresAtMs = expiresAtMs,
      ),
    )
    return true
  }

  @Synchronized
  fun markCallActive(context: Context, callId: String): Boolean {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val now = System.currentTimeMillis()
    val terminalCalls = readTerminalCalls(prefs).filterValues { it > now }.toMutableMap()
    writeTerminalCalls(prefs, terminalCalls)

    if (terminalCalls.containsKey(callId)) {
      return false
    }

    val currentCall = readCurrentCall(prefs) ?: return false
    if (currentCall.callId != callId) {
      return false
    }

    writeCurrentCall(
      prefs,
      CurrentCall(
        callId = callId,
        phase = PHASE_ACTIVE,
        expiresAtMs = currentCall.expiresAtMs,
      ),
    )
    return true
  }

  @Synchronized
  fun isActiveCall(context: Context, callId: String): Boolean {
    return getCurrentCall(context)?.let { it.callId == callId && it.phase == PHASE_ACTIVE } == true
  }

  @Synchronized
  fun getCurrentCall(context: Context): CurrentCall? {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return readCurrentCall(prefs)
  }

  @Synchronized
  fun shouldKeepIncomingPresentation(context: Context, callId: String): Boolean {
    return getCurrentCall(context)?.let { it.callId == callId && it.phase == PHASE_RINGING } == true
  }

  @Synchronized
  fun terminateCall(context: Context, callId: String, eventAtMs: Long?): Boolean {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val now = System.currentTimeMillis()
    val currentCall = readCurrentCall(prefs)
    val shouldStopForegroundService =
      currentCall?.callId == callId && currentCall.phase == PHASE_ACTIVE
    val terminalExpiryMs = maxOf(
      currentCall?.takeIf { it.callId == callId }?.expiresAtMs ?: 0L,
      (eventAtMs ?: now) + TERMINAL_CALL_TTL_MS,
    )
    val terminalCalls = readTerminalCalls(prefs).filterValues { it > now }.toMutableMap()
    terminalCalls[callId] = terminalExpiryMs
    writeTerminalCalls(prefs, terminalCalls)

    if (currentCall?.callId == callId) {
      clearCurrentCall(prefs)
    }
    clearPendingActionForCall(prefs, callId)
    return shouldStopForegroundService
  }

  @Synchronized
  fun clearActiveCall(context: Context, callId: String) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val currentCall = readCurrentCall(prefs)
    if (currentCall?.callId == callId && currentCall.phase == PHASE_ACTIVE) {
      clearCurrentCall(prefs)
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

  fun parseIsoDateMs(value: String): Long? {
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

  private fun readCurrentCall(prefs: android.content.SharedPreferences): CurrentCall? {
    val raw = prefs.getString(KEY_CURRENT_CALL, null) ?: return null
    return runCatching {
      val json = JSONObject(raw)
      val callId = json.optString("callId").takeIf { it.isNotBlank() } ?: return null
      val phase = json.optString("phase")
      if (phase != PHASE_RINGING && phase != PHASE_ACTIVE) {
        return null
      }
      CurrentCall(
        callId = callId,
        phase = phase,
        expiresAtMs = if (json.has("expiresAtMs")) json.optLong("expiresAtMs") else null,
      )
    }.getOrNull()
  }

  private fun writeCurrentCall(prefs: android.content.SharedPreferences, call: CurrentCall) {
    val json = JSONObject()
      .put("callId", call.callId)
      .put("phase", call.phase)
    call.expiresAtMs?.let { json.put("expiresAtMs", it) }
    prefs.edit().putString(KEY_CURRENT_CALL, json.toString()).apply()
  }

  private fun clearCurrentCall(prefs: android.content.SharedPreferences) {
    prefs.edit().remove(KEY_CURRENT_CALL).apply()
  }

  private fun readTerminalCalls(prefs: android.content.SharedPreferences): Map<String, Long> {
    val raw = prefs.getString(KEY_TERMINAL_CALLS, null) ?: return emptyMap()
    return runCatching {
      val json = JSONObject(raw)
      json.keys().asSequence().mapNotNull { callId ->
        val expiresAtMs = json.optLong(callId, 0L)
        callId.takeIf { it.isNotBlank() && expiresAtMs > 0L }?.let { it to expiresAtMs }
      }.toMap()
    }.getOrDefault(emptyMap())
  }

  private fun writeTerminalCalls(
    prefs: android.content.SharedPreferences,
    terminalCalls: Map<String, Long>,
  ) {
    val retained = terminalCalls.entries
      .sortedByDescending { it.value }
      .take(MAX_TERMINAL_CALLS)
      .associate { it.key to it.value }
    val json = JSONObject(retained)
    prefs.edit().putString(KEY_TERMINAL_CALLS, json.toString()).apply()
  }

  private fun clearPendingActionForCall(prefs: android.content.SharedPreferences, callId: String) {
    val raw = prefs.getString(KEY_PENDING_ACTION, null) ?: return
    val pendingCallId = runCatching { JSONObject(raw).optString("callId") }.getOrNull()
    if (pendingCallId == callId) {
      prefs.edit().remove(KEY_PENDING_ACTION).apply()
    }
  }
}
