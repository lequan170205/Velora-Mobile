package expo.modules.velorasystemcalls

import android.content.Context
import android.content.Intent
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

object VeloraSystemCallStore {
  private const val PREFS = "velora_system_calls"
  private const val KEY_AUTH_USER_ID = "currentAuthenticatedUserId"
  // Keep the legacy key only long enough to migrate an action captured by an
  // older build. New writes use a bounded per-action journal.
  private const val KEY_LEGACY_PENDING_ACTION = "pendingAction"
  private const val KEY_PENDING_ACTIONS = "pendingActions"
  private const val KEY_COMPLETED_ACTIONS = "completedActions"
  private const val KEY_PENDING_ACTION_REVISION = "pendingActionRevision"
  private const val KEY_CURRENT_CALL = "currentCall"
  private const val KEY_TERMINAL_CALLS = "terminalCalls"
  // Keep server call-state updates independently from the short-lived local
  // terminal tombstone. A delayed incoming push must not resurrect a call
  // after an earlier active/terminal state update has already reached this
  // device.
  private const val KEY_REMOTE_CALL_STATE_UPDATES = "remoteCallStateUpdates"
  private const val PHASE_RINGING = "ringing"
  private const val PHASE_ACTIVE = "active"
  private const val TERMINAL_CALL_TTL_MS = 60_000L
  private const val MAX_TERMINAL_CALLS = 32
  private const val REMOTE_CALL_STATE_UPDATE_RETENTION_MS = 24 * 60 * 60 * 1_000L
  private const val MAX_REMOTE_CALL_STATE_UPDATES = 64
  private const val PENDING_ACTION_JOURNAL_CAPACITY = 16
  private const val COMPLETED_ACTION_JOURNAL_CAPACITY = 64
  private const val COMPLETED_ACTION_TTL_MS = 24 * 60 * 60 * 1_000L
  private const val TERMINAL_ACTION_TTL_MS = 24 * 60 * 60 * 1_000L
  private const val ANSWER_ACTION_FALLBACK_TTL_MS = 60_000L
  private const val ACCEPTED_ANSWER_RECOVERY_TTL_MS = 60_000L
  // Journal records survive app/process restarts. They deliberately contain a
  // minimal call-action contract rather than a raw FCM/APNs payload, which
  // could acquire auth/token fields as upstream payloads evolve.
  private val PENDING_ACTION_JOURNAL_ALLOWED_FIELDS = setOf(
    "type",
    "callId",
    "conversationId",
    "initiatorId",
    "targetUserId",
    "recipientUserId",
    "callerId",
    "callerName",
    "peerName",
    "callType",
    "initiatorDisplayName",
    "initiatorAvatarUrl",
    "ringTimeoutMs",
    "expiresAt",
    "status",
    "reason",
    "at",
    "answerActionId",
    "lifecycleRevision",
    "action",
    "actionId",
    "callUuid",
    "createdAt",
    "createdMonotonicMs",
    "processLaunchId",
    "revision",
    "accountId",
    "journalExpiresAt",
    "journalExpiresAtMs",
  )

  data class CurrentCall(
    val callId: String,
    val phase: String,
    val expiresAtMs: Long?,
    val callType: String?,
  )

  private data class RemoteCallStateUpdate(
    val status: String,
    val eventAtMs: Long,
    val lifecycleRevision: Int?,
    val receivedAtMs: Long,
  )

  private val actionObservers = mutableSetOf<(Map<String, Any?>) -> Unit>()
  private val processLaunchId = UUID.randomUUID().toString()

  fun addActionObserver(observer: (Map<String, Any?>) -> Unit) {
    actionObservers.add(observer)
  }

  fun removeActionObserver(observer: (Map<String, Any?>) -> Unit) {
    actionObservers.remove(observer)
  }

  fun setAuthenticatedUserId(context: Context, userId: String?): String? {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val previousUserId = prefs.getString(KEY_AUTH_USER_ID, null)

    prefs
      .edit()
      .putString(KEY_AUTH_USER_ID, userId)
      .apply()

    // The native incoming presentation can exist before React Native has
    // hydrated a callId. On logout/account switch, hand the caller its id so
    // it can be dismissed without creating a reject action for the server.
    return if (previousUserId != userId) readCurrentCall(prefs)?.callId else null
  }

  fun shouldAcceptIncomingPayload(context: Context, payload: Map<String, Any?>): Boolean {
    if (payload["type"] != "INCOMING_CALL") {
      return false
    }

    val callType = payload["callType"] as? String
    if (callType != null && callType !in setOf("VOICE", "VIDEO")) {
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
    if (expiresAt != null) {
      val expiresAtMs = parseIsoDateMs(expiresAt) ?: return false
      if (expiresAtMs <= System.currentTimeMillis()) {
        return false
      }
    }

    return true
  }

  fun shouldAcceptCallStateUpdatePayload(context: Context, payload: Map<String, Any?>): Boolean {
    if (payload["type"] != "CALL_STATE_UPDATE") {
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

    val status = payload["status"] as? String
    if (status !in setOf("active", "rejected", "ended", "cancelled")) {
      return false
    }

    val eventAt = payload["at"] as? String ?: return false
    if (parseIsoDateMs(eventAt) == null) {
      return false
    }

    return !payload.containsKey("lifecycleRevision") ||
      parseLifecycleRevision(payload["lifecycleRevision"]) != null
  }

  /**
   * Records the newest authoritative state update for a call. Terminal state
   * is a safety boundary: a delayed active update must never undo it. For
   * same-kind updates, prefer the server lifecycle revision and keep the
   * timestamp only as the compatibility fallback for older deployments.
   */
  @Synchronized
  fun storeRemoteCallStateUpdate(
    context: Context,
    callId: String,
    status: String,
    eventAtMs: Long,
    lifecycleRevision: Int?,
  ): Boolean {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val nowMs = System.currentTimeMillis()
    val updates = readRemoteCallStateUpdates(prefs)
      .filterValues { update -> nowMs - update.receivedAtMs <= REMOTE_CALL_STATE_UPDATE_RETENTION_MS }
      .toMutableMap()
    val candidate = RemoteCallStateUpdate(
      status = status,
      eventAtMs = eventAtMs,
      lifecycleRevision = lifecycleRevision,
      receivedAtMs = nowMs,
    )
    val existing = updates[callId]
    if (existing != null && !shouldReplaceRemoteCallStateUpdate(candidate, existing)) {
      writeRemoteCallStateUpdates(prefs, updates)
      return false
    }

    updates[callId] = candidate
    writeRemoteCallStateUpdates(prefs, updates)
    return true
  }

  @Synchronized
  fun storePendingAction(
    context: Context,
    action: String,
    payload: Map<String, Any?>,
    notifyObservers: Boolean = true,
  ) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val pendingActions = readPendingActions(prefs)
    val callId = (payload["callId"] as? String)?.takeIf { it.isNotBlank() } ?: return

    // Answer is an idempotent native intent. A duplicate Android notification
    // tap must replay the first action id rather than create a second server
    // contender for the same device.
    if (action == "answer") {
      val existing = pendingActions.firstOrNull {
        it["callId"] == callId && it["action"] == "answer"
      }
      if (existing != null) {
        if (notifyObservers) {
          actionObservers.forEach { observer -> observer(existing) }
        }
        return
      }
    }

    val nowMs = System.currentTimeMillis()
    val record = sanitizePendingActionRecord(payload).toMutableMap()
    record["action"] = action
    record["actionId"] = UUID.randomUUID().toString()
    record["callId"] = callId
    record["createdAt"] = isoTimestamp(nowMs)
    record["createdMonotonicMs"] = SystemClock.elapsedRealtime()
    record["processLaunchId"] = processLaunchId
    record["revision"] = nextPendingActionRevision(prefs)
    // The native action can be emitted after logout/account switching has
    // already updated KEY_AUTH_USER_ID. Prefer the immutable owner carried by
    // the original call payload, otherwise a stale CallKit/notification action
    // can be replayed as if it belonged to the newly signed-in account.
    val callOwnerId = (
      record["recipientUserId"] as? String
    )?.takeIf { it.isNotBlank() } ?: (
      record["accountId"] as? String
    )?.takeIf { it.isNotBlank() } ?: prefs.getString(KEY_AUTH_USER_ID, null)
    callOwnerId?.let { record["accountId"] = it }
    val expiresAtMs = pendingActionExpirationMs(action, record, nowMs)
    record["journalExpiresAt"] = isoTimestamp(expiresAtMs)
    record["journalExpiresAtMs"] = expiresAtMs

    if (isTerminalPendingAction(action)) {
      val superseded = pendingActions.filter { it["callId"] == callId }
      superseded.forEach { completePendingActionRecord(prefs, it, "superseded_by_terminal") }
      pendingActions.removeAll { it["callId"] == callId }
    }

    pendingActions.add(record)
    persistPendingActions(prefs, pendingActions.takeLast(PENDING_ACTION_JOURNAL_CAPACITY))
    if (notifyObservers) {
      actionObservers.forEach { observer -> observer(record) }
    }
  }

  @Synchronized
  fun getPendingAction(context: Context): Map<String, Any?>? {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return readPendingActions(prefs).maxWithOrNull(
      compareBy<MutableMap<String, Any?>>(
        { pendingActionPriority(it["action"] as? String) },
        { pendingActionRevision(it) },
      ),
    )
  }

  @Synchronized
  fun pendingWinningAnswerActionId(context: Context, callId: String): String? {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val pendingAction = readPendingActions(prefs).firstOrNull {
      it["callId"] == callId && (it["action"] == "answer" || it["action"] == "resume")
    } ?: return null

    return if (pendingAction["action"] == "resume") {
      pendingAction["answerActionId"] as? String
    } else {
      pendingAction["actionId"] as? String
    }
  }

  /**
   * Returns the still-pending native answer record for a call. This lets the
   * platform watchdog preserve the original action deadline across duplicate
   * notification taps instead of extending it each time.
   */
  @Synchronized
  fun pendingAnswerAction(context: Context, callId: String): Map<String, Any?>? {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return readPendingActions(prefs).firstOrNull {
      it["callId"] == callId && it["action"] == "answer"
    }
  }

  @Synchronized
  fun hasPendingAnswerAction(
    context: Context,
    callId: String,
    actionId: String,
  ): Boolean {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return readPendingActions(prefs).any {
      it["callId"] == callId &&
        it["action"] == "answer" &&
        it["actionId"] == actionId
    }
  }

  @Synchronized
  fun pendingActionCallId(context: Context, actionId: String): String? {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return readPendingActions(prefs).firstOrNull {
      it["actionId"] == actionId
    }?.get("callId") as? String
  }

  /**
   * Android has no CXAnswerCallAction to fulfill, but it still needs the same
   * durable completion semantics as iOS so a retry/restart cannot process an
   * accepted native answer twice.
   */
  @Synchronized
  fun completePendingAnswer(
    context: Context,
    actionId: String,
    success: Boolean,
    reason: String?,
  ): Boolean {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val pendingActions = readPendingActions(prefs)
    val action = pendingActions.firstOrNull { it["actionId"] == actionId }

    if (action == null) {
      return completedPendingActions(prefs).any {
        it["actionId"] == actionId && it["outcome"] == "accepted"
      }
    }
    if (action["action"] != "answer") return false

    pendingActions.removeAll { it["actionId"] == actionId }
    persistPendingActions(prefs, pendingActions)
    completePendingActionRecord(prefs, action, if (success) "accepted" else reason ?: "answer_rejected")
    if (success) {
      storePendingAction(
        context,
        "resume",
        action + mapOf("answerActionId" to actionId),
        notifyObservers = false,
      )
    }
    return true
  }

  @Synchronized
  fun completePendingResume(context: Context, callId: String): Boolean {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val pendingActions = readPendingActions(prefs)
    val resumes = pendingActions.filter {
      it["callId"] == callId && it["action"] == "resume"
    }
    if (resumes.isEmpty()) return false

    resumes.forEach { completePendingActionRecord(prefs, it, "active") }
    pendingActions.removeAll { action -> resumes.any { it["actionId"] == action["actionId"] } }
    persistPendingActions(prefs, pendingActions)
    return true
  }

  @Synchronized
  fun clearPendingAction(context: Context, actionId: String?) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val pendingActions = readPendingActions(prefs)
    val completed = if (actionId == null) {
      pendingActions.toList()
    } else {
      pendingActions.filter { it["actionId"] == actionId }
    }
    if (completed.isEmpty()) return

    completed.forEach { completePendingActionRecord(prefs, it, "cleared_by_js") }
    pendingActions.removeAll { action -> completed.any { it["actionId"] == action["actionId"] } }
    persistPendingActions(prefs, pendingActions)
  }

  @Synchronized
  fun beginRingingCall(
    context: Context,
    callId: String,
    expiresAtMs: Long?,
    callType: String? = null,
  ): Boolean {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val now = System.currentTimeMillis()
    val remoteStateUpdates = readRemoteCallStateUpdates(prefs)
      .filterValues { update -> now - update.receivedAtMs <= REMOTE_CALL_STATE_UPDATE_RETENTION_MS }
      .toMutableMap()
    writeRemoteCallStateUpdates(prefs, remoteStateUpdates)
    if (remoteStateUpdates.containsKey(callId)) {
      return false
    }
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
        callType = callType?.takeIf { it == "VOICE" || it == "VIDEO" },
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
        callType = currentCall.callType,
      ),
    )
    return true
  }

  @Synchronized
  fun updateCallType(context: Context, callId: String, callType: String): Boolean {
    if (callType != "VOICE" && callType != "VIDEO") return false
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val currentCall = readCurrentCall(prefs) ?: return false
    if (currentCall.callId != callId) return false
    writeCurrentCall(prefs, currentCall.copy(callType = callType))
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
      now + TERMINAL_CALL_TTL_MS,
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
    return json.keys().asSequence().associateWith { key ->
      json.opt(key).takeUnless { it == JSONObject.NULL }
    }
  }

  private fun readPendingActions(
    prefs: android.content.SharedPreferences,
  ): MutableList<MutableMap<String, Any?>> {
    val rawActions = prefs.getString(KEY_PENDING_ACTIONS, null)
    val legacyAction = prefs.getString(KEY_LEGACY_PENDING_ACTION, null)
    val loadedActions = when {
      rawActions != null -> runCatching {
        val array = JSONArray(rawActions)
        List(array.length()) { index -> jsonToMap(array.getJSONObject(index)).toMutableMap() }
      }.getOrDefault(emptyList())
      legacyAction != null -> runCatching {
        listOf(jsonToMap(JSONObject(legacyAction)).toMutableMap())
      }.getOrDefault(emptyList())
      else -> emptyList()
    }

    val nowMs = System.currentTimeMillis()
    var normalized = rawActions == null && legacyAction != null
    val completedIds = completedPendingActions(prefs)
      .mapNotNull { it["actionId"] as? String }
      .toSet()
    val active = loadedActions.map { action ->
      val sanitized = sanitizePendingActionRecord(action)
      if (sanitized.size != action.size) {
        normalized = true
      }
      sanitized
    }.filter { action ->
      val actionId = action["actionId"] as? String
      if (actionId.isNullOrBlank() || completedIds.contains(actionId)) {
        normalized = true
        return@filter false
      }

      if (action["journalExpiresAtMs"] !is Number) {
        val actionName = action["action"] as? String ?: "answer"
        val expiresAtMs = pendingActionExpirationMs(actionName, action, nowMs)
        action["journalExpiresAtMs"] = expiresAtMs
        action["journalExpiresAt"] = isoTimestamp(expiresAtMs)
        normalized = true
      }

      if (isPendingActionExpired(action, nowMs)) {
        normalized = true
        return@filter false
      }

      true
    }.toMutableList()

    if (normalized || active.size != loadedActions.size) {
      persistPendingActions(prefs, active)
    }
    return active
  }

  private fun persistPendingActions(
    prefs: android.content.SharedPreferences,
    actions: List<Map<String, Any?>>,
  ) {
    val editor = prefs.edit().remove(KEY_LEGACY_PENDING_ACTION)
    if (actions.isEmpty()) {
      editor.remove(KEY_PENDING_ACTIONS).apply()
      return
    }

    val array = JSONArray()
    actions.takeLast(PENDING_ACTION_JOURNAL_CAPACITY).forEach { action ->
      array.put(JSONObject(action))
    }
    editor.putString(KEY_PENDING_ACTIONS, array.toString()).apply()
  }

  private fun sanitizePendingActionRecord(
    payload: Map<String, Any?>,
  ): MutableMap<String, Any?> = payload.entries
    .asSequence()
    .filter { (key, value) ->
      key in PENDING_ACTION_JOURNAL_ALLOWED_FIELDS && isSafePendingActionJournalValue(value)
    }
    .associate { (key, value) -> key to value }
    .toMutableMap()

  private fun isSafePendingActionJournalValue(value: Any?): Boolean = when (value) {
    is String, is Boolean -> true
    is Number -> value.toDouble().isFinite()
    else -> false
  }

  private fun completedPendingActions(
    prefs: android.content.SharedPreferences,
  ): MutableList<MutableMap<String, Any?>> {
    val raw = prefs.getString(KEY_COMPLETED_ACTIONS, null) ?: return mutableListOf()
    val loaded = runCatching {
      val array = JSONArray(raw)
      List(array.length()) { index -> jsonToMap(array.getJSONObject(index)).toMutableMap() }
    }.getOrDefault(emptyList())
    val nowMs = System.currentTimeMillis()
    val active = loaded.filter { action ->
      val expiresAtMs = (action["expiresAtMs"] as? Number)?.toLong() ?: 0L
      expiresAtMs > nowMs
    }.toMutableList()
    if (active.size != loaded.size) {
      persistCompletedPendingActions(prefs, active)
    }
    return active
  }

  private fun persistCompletedPendingActions(
    prefs: android.content.SharedPreferences,
    actions: List<Map<String, Any?>>,
  ) {
    if (actions.isEmpty()) {
      prefs.edit().remove(KEY_COMPLETED_ACTIONS).apply()
      return
    }
    val array = JSONArray()
    actions.takeLast(COMPLETED_ACTION_JOURNAL_CAPACITY).forEach { action ->
      array.put(JSONObject(action))
    }
    prefs.edit().putString(KEY_COMPLETED_ACTIONS, array.toString()).apply()
  }

  private fun completePendingActionRecord(
    prefs: android.content.SharedPreferences,
    action: Map<String, Any?>,
    outcome: String,
  ) {
    val actionId = action["actionId"] as? String ?: return
    val completed = completedPendingActions(prefs)
      .filterNot { it["actionId"] == actionId }
      .toMutableList()
    val nowMs = System.currentTimeMillis()
    val record = mutableMapOf<String, Any?>(
      "actionId" to actionId,
      "callId" to action["callId"],
      "action" to action["action"],
      "revision" to ((action["revision"] as? Number)?.toLong() ?: 0L),
      "outcome" to outcome,
      "processedAt" to isoTimestamp(nowMs),
      "expiresAtMs" to nowMs + COMPLETED_ACTION_TTL_MS,
      "expiresAt" to isoTimestamp(nowMs + COMPLETED_ACTION_TTL_MS),
    )
    (action["accountId"] as? String)?.let { record["accountId"] = it }
    (action["processLaunchId"] as? String)?.let { record["processLaunchId"] = it }
    completed.add(record)
    persistCompletedPendingActions(prefs, completed)
  }

  private fun pendingActionExpirationMs(
    action: String,
    payload: Map<String, Any?>,
    nowMs: Long,
  ): Long {
    if (isTerminalPendingAction(action)) return nowMs + TERMINAL_ACTION_TTL_MS
    if (action == "resume") return nowMs + ACCEPTED_ANSWER_RECOVERY_TTL_MS

    val fallbackExpirationMs = nowMs + ANSWER_ACTION_FALLBACK_TTL_MS
    val callExpirationMs = (payload["expiresAt"] as? String)?.let(::parseIsoDateMs)
    // An unconfirmed answer cannot be replayed past the server-owned call
    // deadline. A confirmed answer becomes `resume`, which gets its own
    // bounded recovery TTL above.
    return callExpirationMs?.let { minOf(it, fallbackExpirationMs) } ?: fallbackExpirationMs
  }

  private fun isPendingActionExpired(action: Map<String, Any?>, nowMs: Long): Boolean =
    ((action["journalExpiresAtMs"] as? Number)?.toLong() ?: 0L) <= nowMs

  private fun nextPendingActionRevision(prefs: android.content.SharedPreferences): Long {
    val nextRevision = prefs.getLong(KEY_PENDING_ACTION_REVISION, 0L) + 1L
    prefs.edit().putLong(KEY_PENDING_ACTION_REVISION, nextRevision).apply()
    return nextRevision
  }

  private fun pendingActionRevision(action: Map<String, Any?>): Long =
    (action["revision"] as? Number)?.toLong() ?: 0L

  private fun pendingActionPriority(action: String?): Int = when (action) {
    "remote_end", "end", "reject" -> 2
    "answer", "resume" -> 1
    else -> 0
  }

  private fun isTerminalPendingAction(action: String): Boolean =
    pendingActionPriority(action) == 2

  fun parseLifecycleRevision(value: Any?): Int? = when (value) {
    is Int -> value.takeIf { it >= 0 }
    is Long -> value.takeIf { it in 0..Int.MAX_VALUE.toLong() }?.toInt()
    is String -> {
      value.takeIf { it.matches(Regex("0|[1-9][0-9]*")) }
        ?.toLongOrNull()
        ?.takeIf { it <= Int.MAX_VALUE.toLong() }
        ?.toInt()
    }
    else -> null
  }

  private fun isTerminalRemoteCallState(status: String): Boolean = status != "active"

  private fun shouldReplaceRemoteCallStateUpdate(
    candidate: RemoteCallStateUpdate,
    existing: RemoteCallStateUpdate,
  ): Boolean {
    val candidateIsTerminal = isTerminalRemoteCallState(candidate.status)
    val existingIsTerminal = isTerminalRemoteCallState(existing.status)
    if (candidateIsTerminal != existingIsTerminal) {
      return candidateIsTerminal
    }

    when {
      candidate.lifecycleRevision != null && existing.lifecycleRevision != null &&
        candidate.lifecycleRevision != existing.lifecycleRevision -> {
        return candidate.lifecycleRevision > existing.lifecycleRevision
      }
      candidate.lifecycleRevision != null && existing.lifecycleRevision == null -> return true
      candidate.lifecycleRevision == null && existing.lifecycleRevision != null -> return false
    }

    return candidate.eventAtMs > existing.eventAtMs
  }

  private fun isoTimestamp(timestampMs: Long = System.currentTimeMillis()): String =
    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
      timeZone = TimeZone.getTimeZone("UTC")
    }.format(Date(timestampMs))

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
        callType = json.optString("callType").takeIf { it == "VOICE" || it == "VIDEO" },
      )
    }.getOrNull()
  }

  private fun writeCurrentCall(prefs: android.content.SharedPreferences, call: CurrentCall) {
    val json = JSONObject()
      .put("callId", call.callId)
      .put("phase", call.phase)
    call.expiresAtMs?.let { json.put("expiresAtMs", it) }
    call.callType?.let { json.put("callType", it) }
    prefs.edit().putString(KEY_CURRENT_CALL, json.toString()).apply()
  }

  private fun clearCurrentCall(prefs: android.content.SharedPreferences) {
    prefs.edit().remove(KEY_CURRENT_CALL).apply()
  }

  private fun readRemoteCallStateUpdates(
    prefs: android.content.SharedPreferences,
  ): Map<String, RemoteCallStateUpdate> {
    val raw = prefs.getString(KEY_REMOTE_CALL_STATE_UPDATES, null) ?: return emptyMap()
    return runCatching {
      val json = JSONObject(raw)
      json.keys().asSequence().mapNotNull { callId ->
        val stored = json.optJSONObject(callId) ?: return@mapNotNull null
        val status = stored.optString("status")
        val eventAtMs = stored.optLong("eventAtMs", 0L)
        val receivedAtMs = stored.optLong("receivedAtMs", eventAtMs)
        val lifecycleRevision = if (stored.has("lifecycleRevision")) {
          parseLifecycleRevision(stored.opt("lifecycleRevision"))
        } else {
          null
        }
        if (
          callId.isBlank() ||
          status !in setOf("active", "rejected", "ended", "cancelled") ||
          eventAtMs <= 0L ||
          receivedAtMs <= 0L ||
          (stored.has("lifecycleRevision") && lifecycleRevision == null)
        ) {
          null
        } else {
          callId to RemoteCallStateUpdate(
            status = status,
            eventAtMs = eventAtMs,
            lifecycleRevision = lifecycleRevision,
            receivedAtMs = receivedAtMs,
          )
        }
      }.toMap()
    }.getOrDefault(emptyMap())
  }

  private fun writeRemoteCallStateUpdates(
    prefs: android.content.SharedPreferences,
    updates: Map<String, RemoteCallStateUpdate>,
  ) {
    val retained = updates.entries
      .sortedByDescending { it.value.receivedAtMs }
      .take(MAX_REMOTE_CALL_STATE_UPDATES)
    if (retained.isEmpty()) {
      prefs.edit().remove(KEY_REMOTE_CALL_STATE_UPDATES).apply()
      return
    }

    val json = JSONObject()
    retained.forEach { (callId, update) ->
      val stored = JSONObject()
        .put("status", update.status)
        .put("eventAtMs", update.eventAtMs)
        .put("receivedAtMs", update.receivedAtMs)
      update.lifecycleRevision?.let { stored.put("lifecycleRevision", it) }
      json.put(callId, stored)
    }
    prefs.edit().putString(KEY_REMOTE_CALL_STATE_UPDATES, json.toString()).apply()
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
    val pendingActions = readPendingActions(prefs)
    val matchingActions = pendingActions.filter { it["callId"] == callId }
    if (matchingActions.isEmpty()) return

    matchingActions.forEach {
      completePendingActionRecord(prefs, it, "superseded_by_terminal")
    }
    pendingActions.removeAll { it["callId"] == callId }
    persistPendingActions(prefs, pendingActions)
  }
}
