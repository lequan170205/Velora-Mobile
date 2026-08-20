const fs = require('node:fs')

const replaceRequired = (source, before, after, label) => {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`Patch anchor not found: ${label}`)
  return source.replace(before, after)
}

const typesPath = 'src/types/call.types.ts'
let types = fs.readFileSync(typesPath, 'utf8')
types = types.replace(/telemetryToken\?: string/g, 'telemetryToken: string')
fs.writeFileSync(typesPath, types)

const swiftPath = 'modules/velora-system-calls/ios/VeloraSystemCallsModule.swift'
let swift = fs.readFileSync(swiftPath, 'utf8')
swift = replaceRequired(
  swift,
  'configuration.supportsVideo = false',
  'configuration.supportsVideo = true',
  'CXProviderConfiguration.supportsVideo',
)
swift = replaceRequired(
  swift,
  'let update = callUpdate(displayName: callerName(from: payload))',
  'let update = callUpdate(\n      displayName: callerName(from: payload),\n      isVideo: nonEmptyString(payload["callType"]) == "VIDEO"\n    )',
  'incoming call update',
)
swift = replaceRequired(
  swift,
  'action.isVideo = false',
  'action.isVideo = nonEmptyString(payload["callType"]) == "VIDEO"',
  'outgoing video action',
)
swift = replaceRequired(
  swift,
  'private func callUpdate(displayName: String) -> CXCallUpdate {',
  'private func callUpdate(displayName: String, isVideo: Bool) -> CXCallUpdate {',
  'call update signature',
)
swift = replaceRequired(
  swift,
  'update.hasVideo = false',
  'update.hasVideo = isVideo',
  'call update video flag',
)
swift = replaceRequired(
  swift,
  'let update = callUpdate(displayName: "Velora call")',
  'let update = callUpdate(displayName: "Velora call", isVideo: false)',
  'fallback call update signature',
)
swift = replaceRequired(
  swift,
  `    if payload["callType"] as? String == "VIDEO" {\n      return (\n        false,\n        callId,\n        "unsupported_call_type",\n        "VoIP incoming call reporting only supports audio calls."\n      )\n    }`,
  `    if let callType = nonEmptyString(payload["callType"]),\n       callType != "VOICE" && callType != "VIDEO" {\n      return (\n        false,\n        callId,\n        "unsupported_call_type",\n        "VoIP incoming call reporting only supports VOICE or VIDEO calls."\n      )\n    }`,
  'native incoming call type validation',
)
swift = replaceRequired(
  swift,
  `      let unsupportedVideo = validateIncomingPayload(\n        validPayload.merging(["callType": "VIDEO"]) { _, latest in latest },\n        authenticatedUserIdOverride: "debug-user"\n      )\n      assert(unsupportedVideo.errorCode == "unsupported_call_type")\n      assert(\n        pushKitHandlingStrategy(validationAccepted: unsupportedVideo.accepted, existingState: nil)\n          == .reportFallbackAndEnd\n      )`,
  `      let supportedVideo = validateIncomingPayload(\n        validPayload.merging(["callType": "VIDEO"]) { _, latest in latest },\n        authenticatedUserIdOverride: "debug-user"\n      )\n      assert(supportedVideo.accepted)\n      assert(supportedVideo.errorCode == nil)\n      assert(\n        pushKitHandlingStrategy(validationAccepted: supportedVideo.accepted, existingState: nil)\n          == .reportValidatedIncomingCall\n      )\n\n      let unsupportedCallType = validateIncomingPayload(\n        validPayload.merging(["callType": "SCREEN_SHARE"]) { _, latest in latest },\n        authenticatedUserIdOverride: "debug-user"\n      )\n      assert(unsupportedCallType.errorCode == "unsupported_call_type")`,
  'native DEBUG video validation coverage',
)
fs.writeFileSync(swiftPath, swift)

const pluginPath = 'plugins/withVeloraSystemCalls.js'
let plugin = fs.readFileSync(pluginPath, 'utf8')
if (!plugin.includes('native incoming VOICE/VIDEO validation')) {
  const insertAnchor = `  source = replaceRequired(\n    source,\n    'update.hasVideo = false',\n    'update.hasVideo = isVideo',\n    'incoming CXCallUpdate.hasVideo',\n  )`
  const addition = `${insertAnchor}\n  source = replaceRequired(\n    source,\n    'let update = callUpdate(displayName: "Velora call")',\n    'let update = callUpdate(displayName: "Velora call", isVideo: false)',\n    'fallback incoming call update signature',\n  )\n  source = replaceRequired(\n    source,\n    'if payload["callType"] as? String == "VIDEO" {\\n      return (\\n        false,\\n        callId,\\n        "unsupported_call_type",\\n        "VoIP incoming call reporting only supports audio calls."\\n      )\\n    }',\n    'if let callType = nonEmptyString(payload["callType"]),\\n       callType != "VOICE" && callType != "VIDEO" {\\n      return (\\n        false,\\n        callId,\\n        "unsupported_call_type",\\n        "VoIP incoming call reporting only supports VOICE or VIDEO calls."\\n      )\\n    }',\n    'native incoming VOICE/VIDEO validation',\n  )`
  if (!plugin.includes(insertAnchor)) throw new Error('Plugin video patch insertion anchor not found')
  plugin = plugin.replace(insertAnchor, addition)
}
fs.writeFileSync(pluginPath, plugin)

console.log('Video-call native/contract patch applied successfully')
