const fs = require('node:fs')

const replaceRequired = (source, before, after, label) => {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`Native type sync anchor not found: ${label}`)
  return source.replace(before, after)
}

const wrapperPath = 'src/lib/systemCalls/veloraSystemCalls.ts'
let wrapper = fs.readFileSync(wrapperPath, 'utf8')
wrapper = replaceRequired(
  wrapper,
  `  setCallActive: (callId: string) => boolean\n  setSpeakerEnabled: (enabled: boolean) => boolean`,
  `  setCallActive: (callId: string) => boolean\n  setCallType: (callId: string, callType: CallType) => boolean\n  setSpeakerEnabled: (enabled: boolean) => boolean`,
  'TypeScript native module contract',
)
wrapper = replaceRequired(
  wrapper,
  `  setCallActive(callId: string) {\n    return nativeModule?.setCallActive?.(callId) ?? false\n  },\n\n  setSpeakerEnabled(enabled: boolean) {`,
  `  setCallActive(callId: string) {\n    return nativeModule?.setCallActive?.(callId) ?? false\n  },\n\n  setCallType(callId: string, callType: CallType) {\n    return nativeModule?.setCallType?.(callId, callType) ?? false\n  },\n\n  setSpeakerEnabled(enabled: boolean) {`,
  'TypeScript native wrapper method',
)
fs.writeFileSync(wrapperPath, wrapper)

const storePath =
  'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraSystemCallStore.kt'
let store = fs.readFileSync(storePath, 'utf8')
store = replaceRequired(
  store,
  `  data class CurrentCall(\n    val callId: String,\n    val phase: String,\n    val expiresAtMs: Long?,\n  )`,
  `  data class CurrentCall(\n    val callId: String,\n    val phase: String,\n    val expiresAtMs: Long?,\n    val callType: String?,\n  )`,
  'Android CurrentCall callType',
)
store = replaceRequired(
  store,
  `  fun beginRingingCall(context: Context, callId: String, expiresAtMs: Long?): Boolean {`,
  `  fun beginRingingCall(\n    context: Context,\n    callId: String,\n    expiresAtMs: Long?,\n    callType: String? = null,\n  ): Boolean {`,
  'Android beginRingingCall signature',
)
store = replaceRequired(
  store,
  `        phase = PHASE_RINGING,\n        expiresAtMs = expiresAtMs,\n      ),`,
  `        phase = PHASE_RINGING,\n        expiresAtMs = expiresAtMs,\n        callType = callType?.takeIf { it == "VOICE" || it == "VIDEO" },\n      ),`,
  'Android ringing call type storage',
)
store = replaceRequired(
  store,
  `        phase = PHASE_ACTIVE,\n        expiresAtMs = currentCall.expiresAtMs,\n      ),`,
  `        phase = PHASE_ACTIVE,\n        expiresAtMs = currentCall.expiresAtMs,\n        callType = currentCall.callType,\n      ),`,
  'Android active call type preservation',
)
if (!store.includes('fun updateCallType(context: Context, callId: String, callType: String): Boolean')) {
  const anchor = `  @Synchronized\n  fun isActiveCall(context: Context, callId: String): Boolean {`
  if (!store.includes(anchor)) throw new Error('Native type sync anchor not found: Android updateCallType')
  store = store.replace(
    anchor,
    `  @Synchronized\n  fun updateCallType(context: Context, callId: String, callType: String): Boolean {\n    if (callType != "VOICE" && callType != "VIDEO") return false\n    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)\n    val currentCall = readCurrentCall(prefs) ?: return false\n    if (currentCall.callId != callId) return false\n    writeCurrentCall(prefs, currentCall.copy(callType = callType))\n    return true\n  }\n\n${anchor}`,
  )
}
store = replaceRequired(
  store,
  `        expiresAtMs = if (json.has("expiresAtMs")) json.optLong("expiresAtMs") else null,\n      )`,
  `        expiresAtMs = if (json.has("expiresAtMs")) json.optLong("expiresAtMs") else null,\n        callType = json.optString("callType").takeIf { it == "VOICE" || it == "VIDEO" },\n      )`,
  'Android current call type restore',
)
store = replaceRequired(
  store,
  `    call.expiresAtMs?.let { json.put("expiresAtMs", it) }\n    prefs.edit().putString(KEY_CURRENT_CALL, json.toString()).apply()`,
  `    call.expiresAtMs?.let { json.put("expiresAtMs", it) }\n    call.callType?.let { json.put("callType", it) }\n    prefs.edit().putString(KEY_CURRENT_CALL, json.toString()).apply()`,
  'Android current call type persistence',
)
fs.writeFileSync(storePath, store)

const notificationsPath =
  'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraCallNotifications.kt'
let notifications = fs.readFileSync(notificationsPath, 'utf8')
notifications = replaceRequired(
  notifications,
  `    if (!VeloraSystemCallStore.beginRingingCall(context, callId, expiresAtMs)) {`,
  `    if (\n      !VeloraSystemCallStore.beginRingingCall(\n        context,\n        callId,\n        expiresAtMs,\n        payload["callType"] as? String,\n      )\n    ) {`,
  'Android incoming call type persistence',
)
notifications = replaceRequired(
  notifications,
  `    if (!VeloraSystemCallStore.beginRingingCall(context, callId, null)) {`,
  `    if (\n      !VeloraSystemCallStore.beginRingingCall(\n        context,\n        callId,\n        null,\n        payload["callType"] as? String,\n      )\n    ) {`,
  'Android outgoing call type persistence',
)
if (!notifications.includes('fun updateCallType(context: Context, callId: String, callType: String): Boolean')) {
  const anchor = `  fun endCall(context: Context, callId: String, eventAtMs: Long? = null) {`
  if (!notifications.includes(anchor)) throw new Error('Native type sync anchor not found: Android notification update')
  notifications = notifications.replace(
    anchor,
    `  fun updateCallType(context: Context, callId: String, callType: String): Boolean {\n    if (!VeloraSystemCallStore.updateCallType(context, callId, callType)) return false\n    val currentCall = VeloraSystemCallStore.getCurrentCall(context) ?: return false\n    if (currentCall.phase == "active") {\n      notificationManager(context).notify(\n        ongoingNotificationId(callId),\n        ongoingNotification(\n          context,\n          mapOf(\n            "callId" to callId,\n            "initiatorDisplayName" to "Velora call",\n            "callType" to callType,\n          ),\n        ),\n      )\n    }\n    return true\n  }\n\n${anchor}`,
  )
}
fs.writeFileSync(notificationsPath, notifications)

const foregroundPath =
  'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraCallForegroundService.kt'
let foreground = fs.readFileSync(foregroundPath, 'utf8')
foreground = replaceRequired(
  foreground,
  `    val callId = intent?.getStringExtra("callId")\n      ?: VeloraSystemCallStore.getCurrentCall(this)\n        ?.takeIf { it.phase == "active" }\n        ?.callId`,
  `    val currentCall = VeloraSystemCallStore.getCurrentCall(this)\n    val callId = intent?.getStringExtra("callId")\n      ?: currentCall\n        ?.takeIf { it.phase == "active" }\n        ?.callId`,
  'Android foreground current call snapshot',
)
foreground = replaceRequired(
  foreground,
  `        "callId" to callId,\n        "initiatorDisplayName" to "Velora call",\n      ),`,
  `        "callId" to callId,\n        "initiatorDisplayName" to "Velora call",\n        "callType" to currentCall?.takeIf { it.callId == callId }?.callType,\n      ),`,
  'Android foreground notification callType',
)
fs.writeFileSync(foregroundPath, foreground)

const androidModulePath =
  'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraSystemCallsModule.kt'
let androidModule = fs.readFileSync(androidModulePath, 'utf8')
androidModule = replaceRequired(
  androidModule,
  `    Function("setCallActive") { callId: String ->\n      VeloraCallNotifications.setCallActive(context, callId)\n    }\n\n    Function("setSpeakerEnabled")`,
  `    Function("setCallActive") { callId: String ->\n      VeloraCallNotifications.setCallActive(context, callId)\n    }\n\n    Function("setCallType") { callId: String, callType: String ->\n      VeloraCallNotifications.updateCallType(context, callId, callType)\n    }\n\n    Function("setSpeakerEnabled")`,
  'Android native setCallType function',
)
fs.writeFileSync(androidModulePath, androidModule)

const swiftPath = 'modules/velora-system-calls/ios/VeloraSystemCallsModule.swift'
let swift = fs.readFileSync(swiftPath, 'utf8')
swift = replaceRequired(
  swift,
  `    Function("setCallActive") { (callId: String) -> Bool in\n      let callCenter = VeloraSystemCallCenter.shared\n      return callCenter.runOnMain {\n        callCenter.setCallActive(callId: callId)\n      }\n    }\n\n    Function("setSpeakerEnabled")`,
  `    Function("setCallActive") { (callId: String) -> Bool in\n      let callCenter = VeloraSystemCallCenter.shared\n      return callCenter.runOnMain {\n        callCenter.setCallActive(callId: callId)\n      }\n    }\n\n    Function("setCallType") { (callId: String, callType: String) -> Bool in\n      let callCenter = VeloraSystemCallCenter.shared\n      return callCenter.runOnMain {\n        callCenter.setCallType(callId: callId, callType: callType)\n      }\n    }\n\n    Function("setSpeakerEnabled")`,
  'iOS module setCallType function',
)
if (!swift.includes('func setCallType(callId: String, callType: String) -> Bool')) {
  const anchor = `  func setSpeakerEnabled(_ enabled: Bool) -> Bool {`
  if (!swift.includes(anchor)) throw new Error('Native type sync anchor not found: iOS call center setCallType')
  swift = swift.replace(
    anchor,
    `  func setCallType(callId: String, callType: String) -> Bool {\n    guard (callType == "VOICE" || callType == "VIDEO"),\n          let uuid = uuidsByCallId[callId],\n          var payload = payloadsByCallId[callId] else {\n      return false\n    }\n\n    payload["callType"] = callType\n    payloadsByCallId[callId] = payload\n    let displayName = payload["type"] as? String == "INCOMING_CALL"\n      ? callerName(from: payload)\n      : peerName(from: payload)\n    provider.reportCall(\n      with: uuid,\n      updated: callUpdate(displayName: displayName, isVideo: callType == "VIDEO")\n    )\n    return true\n  }\n\n${anchor}`,
  )
}
fs.writeFileSync(swiftPath, swift)

const providerPath = 'src/providers/CallProvider.tsx'
let provider = fs.readFileSync(providerPath, 'utf8')
provider = replaceRequired(
  provider,
  `    const handleCallTypeChanged = (payload: CallTypeChangedPayload) => {\n      if (!isCurrentCall(payload.callId)) return\n      const previousType = useCallStore.getState().callType\n      useCallStore.getState().patch({\n        callType: payload.callType,\n        remoteVideoState: payload.callType === 'VIDEO' ? 'waiting' : 'idle',\n      })\n      if (payload.callType === 'VOICE') {\n        deactivateLocalVideo()\n        clearRemoteVideoRuntime('idle')\n        return\n      }\n      if (\n        previousType !== 'VIDEO' &&\n        payload.changedByUserId !== currentUserId &&\n        useCallStore.getState().hasCameraPermission === true\n      ) {\n        void activateLocalVideo({ requestPermission: false })\n      }\n    }`,
  `    const handleCallTypeChanged = (payload: CallTypeChangedPayload) => {\n      if (!isCurrentCall(payload.callId)) return\n      veloraSystemCalls.setCallType(payload.callId, payload.callType)\n      useCallStore.getState().patch({\n        callType: payload.callType,\n        remoteVideoState: payload.callType === 'VIDEO' ? 'waiting' : 'idle',\n      })\n      if (payload.callType === 'VOICE') {\n        deactivateLocalVideo()\n        clearRemoteVideoRuntime('idle')\n      }\n    }`,
  'CallProvider native type sync and peer-camera privacy',
)
const duplicateRemoteDelete = `      remoteVideoEnabledByProducerRef.current.delete(payload.producerId)\n`
while (provider.includes(`${duplicateRemoteDelete}${duplicateRemoteDelete}`)) {
  provider = provider.replace(`${duplicateRemoteDelete}${duplicateRemoteDelete}`, duplicateRemoteDelete)
}
provider = provider.replace(
  `  if (payload.reason === 'unsupported_video') {\n    return 'Video calls are not supported yet'\n  }`,
  `  if (payload.reason === 'camera_permission_denied') {\n    return 'The other person needs camera access to answer a video call'\n  }\n\n  if (payload.reason === 'unsupported_video') {\n    return 'The other person is using a version that does not support video calls'\n  }`,
)

const oldSwitchCamera = `  const switchCamera = useCallback(async () => {\n    const state = useCallStore.getState()\n    if (state.phase !== 'active' || state.callType !== 'VIDEO' || !state.cameraEnabled) return\n    const track = localStreamRef.current?.getVideoTracks()[0] as\n      (MediaStreamTrack & { _switchCamera?: () => void }) | undefined\n    if (!track?._switchCamera) return\n    track._switchCamera()\n    useCallStore.getState().patch({\n      cameraFacing: state.cameraFacing === 'user' ? 'environment' : 'user',\n    })\n  }, [])`
const newSwitchCamera = `  const switchCamera = useCallback(async () => {\n    const state = useCallStore.getState()\n    if (state.phase !== 'active' || state.callType !== 'VIDEO' || !state.cameraEnabled) return\n    const nextFacing: CameraFacing = state.cameraFacing === 'user' ? 'environment' : 'user'\n    const track = localStreamRef.current?.getVideoTracks()[0] as\n      | (MediaStreamTrack & {\n          applyConstraints?: (constraints: { facingMode?: CameraFacing }) => Promise<void>\n          _switchCamera?: () => void\n        })\n      | undefined\n    if (!track) return\n\n    if (track.applyConstraints) {\n      try {\n        await track.applyConstraints({ facingMode: nextFacing })\n        useCallStore.getState().patch({ cameraFacing: nextFacing })\n        return\n      } catch {\n        // Fall back to the legacy react-native-webrtc camera switch when constraints fail.\n      }\n    }\n\n    if (!track._switchCamera) return\n    track._switchCamera()\n    useCallStore.getState().patch({ cameraFacing: nextFacing })\n  }, [])`
if (!provider.includes(newSwitchCamera)) {
  if (!provider.includes(oldSwitchCamera)) throw new Error('Native type sync anchor not found: switchCamera')
  provider = provider.replace(oldSwitchCamera, newSwitchCamera)
}
fs.writeFileSync(providerPath, provider)

const testsPath = 'tests/video-call-1to1-contract.test.cjs'
let tests = fs.readFileSync(testsPath, 'utf8')
if (!tests.includes("test('native call type follows active VOICE and VIDEO transitions'")) {
  tests += `\n\ntest('native call type follows active VOICE and VIDEO transitions', () => {\n  const wrapper = read('src/lib/systemCalls/veloraSystemCalls.ts')\n  const provider = read('src/providers/CallProvider.tsx')\n  const androidModule = read(\n    'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraSystemCallsModule.kt',\n  )\n  const androidStore = read(\n    'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraSystemCallStore.kt',\n  )\n  const foreground = read(\n    'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraCallForegroundService.kt',\n  )\n  const swift = read('modules/velora-system-calls/ios/VeloraSystemCallsModule.swift')\n\n  assert.match(wrapper, /setCallType: \\(callId: string, callType: CallType\\) => boolean/)\n  assert.match(provider, /veloraSystemCalls\\.setCallType\\(payload\\.callId, payload\\.callType\\)/)\n  assert.match(androidModule, /Function\\(\\"setCallType\\"\\)/)\n  assert.match(androidStore, /val callType: String\\?/)\n  assert.match(foreground, /\\"callType\\" to currentCall/)\n  assert.match(swift, /func setCallType\\(callId: String, callType: String\\) -> Bool/)\n  assert.match(swift, /provider\\.reportCall\\([\\s\\S]*updated: callUpdate/)\n})\n\ntest('video producer cleanup is not duplicated in CallProvider', () => {\n  const source = read('src/providers/CallProvider.tsx')\n  const marker = 'remoteVideoEnabledByProducerRef.current.delete(payload.producerId)'\n  assert.equal(source.split(marker).length - 1, 1)\n})\n\ntest('peer video upgrade never turns on the local camera automatically', () => {\n  const source = read('src/providers/CallProvider.tsx')\n  assert.doesNotMatch(\n    source,\n    /payload\\.changedByUserId !== currentUserId[\\s\\S]{0,180}activateLocalVideo/,\n  )\n})\n\ntest('camera flip prefers constraints with a legacy WebRTC fallback', () => {\n  const source = read('src/providers/CallProvider.tsx')\n  assert.match(source, /track\\.applyConstraints\\(\\{ facingMode: nextFacing \\}\\)/)\n  assert.match(source, /track\\._switchCamera\\(\\)/)\n})\n`
}
fs.writeFileSync(testsPath, tests)

console.log('Finalized native type sync, camera privacy, flip compatibility and provider cleanup')
