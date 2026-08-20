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
fs.writeFileSync(swiftPath, swift)

console.log('Video-call native/contract patch applied successfully')
