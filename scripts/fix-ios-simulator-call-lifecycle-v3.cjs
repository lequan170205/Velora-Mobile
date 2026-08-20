const fs = require('node:fs')

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error('Missing simulator-call anchor: ' + label)
  return source.replace(before, after)
}

const providerPath = 'src/providers/CallProvider.tsx'
let provider = fs.readFileSync(providerPath, 'utf8')
provider = replaceRequired(
  provider,
  "      veloraSystemCalls.presentIncomingCall(nativePayload)\n    },",
  "      if (veloraSystemCalls.isIosSimulator) {\n        router.push(`/call/${payload.callId}` as never)\n      } else {\n        veloraSystemCalls.presentIncomingCall(nativePayload)\n      }\n    },",
  'simulator incoming route',
)
provider = replaceRequired(
  provider,
  "        debugCall('[Call] Waiting for configured native audio session...')\n        const audioSessionConfiguration = await waitForConfiguredAudioSession(setupToken, callId)",
  "        debugCall('[Call] Waiting for configured native audio session...')\n        if (\n          veloraSystemCalls.isIosSimulator &&\n          !veloraSystemCalls.activateSimulatorAudioSession(callId)\n        ) {\n          throw new Error('simulator_audio_session_activation_failed')\n        }\n        const audioSessionConfiguration = await waitForConfiguredAudioSession(setupToken, callId)",
  'incoming simulator audio activation',
)
provider = replaceRequired(
  provider,
  "        const audioSessionConfiguration = await waitForConfiguredAudioSession(\n          setupToken,\n          joined.callId,\n        )",
  "        if (\n          veloraSystemCalls.isIosSimulator &&\n          !veloraSystemCalls.activateSimulatorAudioSession(joined.callId)\n        ) {\n          throw new Error('simulator_audio_session_activation_failed')\n        }\n        const audioSessionConfiguration = await waitForConfiguredAudioSession(\n          setupToken,\n          joined.callId,\n        )",
  'outgoing simulator audio activation',
)
if ((provider.match(/activateSimulatorAudioSession\(/g) ?? []).length < 2) {
  throw new Error('Expected both simulator audio activation paths')
}
fs.writeFileSync(providerPath, provider)

const callScreenPath = 'app/call/[id].tsx'
let screen = fs.readFileSync(callScreenPath, 'utf8')
screen = replaceRequired(
  screen,
  "  const { endCall, switchCallType, switchCamera, toggleCamera, toggleMute, toggleSpeaker } =\n    useCall()",
  "  const {\n    acceptIncomingCall,\n    endCall,\n    rejectIncomingCall,\n    switchCallType,\n    switchCamera,\n    toggleCamera,\n    toggleMute,\n    toggleSpeaker,\n  } = useCall()",
  'call screen actions',
)
screen = replaceRequired(
  screen,
  "      phase === 'outgoing_ringing' ||\n      phase === 'connecting' ||",
  "      phase === 'incoming_ringing' ||\n      phase === 'outgoing_ringing' ||\n      phase === 'connecting' ||",
  'incoming phase validity',
)
screen = replaceRequired(
  screen,
  "    if (phase === 'outgoing_ringing') return 'Calling...'",
  "    if (phase === 'incoming_ringing')\n      return callType === 'VIDEO' ? 'Incoming video call' : 'Incoming call'\n    if (phase === 'outgoing_ringing') return 'Calling...'",
  'incoming status label',
)
const controlsOpen = "        <View className={`z-20 w-full pb-8 pt-5 ${isVideo ? 'bg-black/20' : ''}`}>\n          <View className=\"flex-row flex-wrap items-center justify-center gap-4 px-6\">"
const controlsReplacement = "        <View className={`z-20 w-full pb-8 pt-5 ${isVideo ? 'bg-black/20' : ''}`}>\n          {phase === 'incoming_ringing' ? (\n            <View className=\"flex-row items-center justify-center gap-12 px-6\">\n              <TouchableOpacity\n                className=\"h-20 w-20 items-center justify-center rounded-full bg-status-error\"\n                onPress={() => void rejectIncomingCall()}\n                accessibilityRole=\"button\"\n                accessibilityLabel=\"Decline call\"\n              >\n                <MaterialIcons name=\"call-end\" size={36} color=\"#FFFFFF\" />\n              </TouchableOpacity>\n              <TouchableOpacity\n                className=\"h-20 w-20 items-center justify-center rounded-full bg-call-green\"\n                onPress={() => void acceptIncomingCall('ui')}\n                accessibilityRole=\"button\"\n                accessibilityLabel=\"Answer call\"\n              >\n                <MaterialIcons name={isVideo ? 'videocam' : 'call'} size={36} color=\"#FFFFFF\" />\n              </TouchableOpacity>\n            </View>\n          ) : (\n            <>\n          <View className=\"flex-row flex-wrap items-center justify-center gap-4 px-6\">"
screen = replaceRequired(screen, controlsOpen, controlsReplacement, 'incoming controls open')
const controlsClose = "          <View className=\"mt-7 items-center\">\n            <TouchableOpacity\n              className=\"h-20 w-20 items-center justify-center rounded-full bg-status-error\"\n              onPress={() => void endCall()}\n              activeOpacity={0.8}\n              accessibilityRole=\"button\"\n              accessibilityLabel=\"End call\"\n            >\n              <MaterialIcons name=\"call-end\" size={36} color=\"#FFFFFF\" />\n            </TouchableOpacity>\n          </View>\n        </View>"
const controlsCloseReplacement = "          <View className=\"mt-7 items-center\">\n            <TouchableOpacity\n              className=\"h-20 w-20 items-center justify-center rounded-full bg-status-error\"\n              onPress={() => void endCall()}\n              activeOpacity={0.8}\n              accessibilityRole=\"button\"\n              accessibilityLabel=\"End call\"\n            >\n              <MaterialIcons name=\"call-end\" size={36} color=\"#FFFFFF\" />\n            </TouchableOpacity>\n          </View>\n            </>\n          )}\n        </View>"
screen = replaceRequired(screen, controlsClose, controlsCloseReplacement, 'incoming controls close')
fs.writeFileSync(callScreenPath, screen)

const swiftPath = 'modules/velora-system-calls/ios/VeloraSystemCallsModule.swift'
let swift = fs.readFileSync(swiftPath, 'utf8')
swift = replaceRequired(
  swift,
  "    AsyncFunction(\"dismissIncomingCall\") { (callId: String, promise: Promise) in\n      let callCenter = VeloraSystemCallCenter.shared\n      callCenter.runOnMain {\n        callCenter.endCall(callId: callId) { result in\n          promise.resolve(result)\n        }\n      }\n    }\n  }\n}",
  "    AsyncFunction(\"dismissIncomingCall\") { (callId: String, promise: Promise) in\n      let callCenter = VeloraSystemCallCenter.shared\n      callCenter.runOnMain {\n        callCenter.endCall(callId: callId) { result in\n          promise.resolve(result)\n        }\n      }\n    }\n\n    Function(\"activateSimulatorAudioSession\") { (callId: String) -> Bool in\n      let callCenter = VeloraSystemCallCenter.shared\n      return callCenter.runOnMain { callCenter.activateSimulatorAudioSession(callId: callId) }\n    }\n\n    Function(\"deactivateSimulatorAudioSession\") { (callId: String) -> Bool in\n      let callCenter = VeloraSystemCallCenter.shared\n      return callCenter.runOnMain { callCenter.deactivateSimulatorAudioSession(callId: callId) }\n    }\n  }\n}",
  'swift module simulator methods',
)
if (!swift.includes('func activateSimulatorAudioSession(callId: String)')) {
  const anchor = "  private func prepareWebRtcAudioSessionForCallKit(callId: String?, callUuid: UUID?) {"
  if (!swift.includes(anchor)) throw new Error('Missing swift simulator audio anchor')
  const methods = "  func activateSimulatorAudioSession(callId: String) -> Bool {\n    #if targetEnvironment(simulator)\n      let audioSession = AVAudioSession.sharedInstance()\n      resetAudioConfigurationState()\n      speakerOverrideEnabled = false\n      do {\n        try audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP, .allowBluetoothA2DP])\n        try audioSession.setActive(true)\n        isNativeAudioSessionActivated = true\n        nativeAudioSessionActivatedAt = Date()\n        nativeAudioSessionDeactivatedAt = nil\n        nativeAudioSessionActivationSequence += 1\n        nativeAudioSessionCallUuid = uuidsByCallId[callId]\n        configureWebRtcAudioSession(audioSession)\n        logOperationalNotice(layer: \"simulator\", event: \"simulator_audio_session_activated\", callId: callId, success: isAudioSessionConfigured)\n        return isAudioSessionConfigured\n      } catch {\n        audioSessionConfigurationErrorCode = \"simulator_audio_session_activation_failed\"\n        logOperationalNotice(layer: \"simulator\", event: \"simulator_audio_session_activation_failed\", callId: callId, success: false, errorCode: audioSessionConfigurationErrorCode)\n        return false\n      }\n    #else\n      return false\n    #endif\n  }\n\n  func deactivateSimulatorAudioSession(callId: String) -> Bool {\n    #if targetEnvironment(simulator)\n      let audioSession = AVAudioSession.sharedInstance()\n      RTCAudioSession.sharedInstance().isAudioEnabled = false\n      do {\n        try audioSession.setActive(false, options: .notifyOthersOnDeactivation)\n      } catch {\n        logOperationalNotice(layer: \"simulator\", event: \"simulator_audio_session_deactivation_failed\", callId: callId, success: false, errorCode: \"simulator_audio_session_deactivation_failed\")\n        return false\n      }\n      isNativeAudioSessionActivated = false\n      nativeAudioSessionDeactivatedAt = Date()\n      nativeAudioSessionCallUuid = nil\n      resetAudioConfigurationState()\n      logOperationalNotice(layer: \"simulator\", event: \"simulator_audio_session_deactivated\", callId: callId, success: true)\n      return true\n    #else\n      return false\n    #endif\n  }\n\n"
  swift = swift.replace(anchor, methods + anchor)
}
fs.writeFileSync(swiftPath, swift)

const testPath = 'tests/video-call-1to1-contract.test.cjs'
let test = fs.readFileSync(testPath, 'utf8')
if (!test.includes('iOS Simulator uses in-app ringing and isolates CallKit lifecycle')) {
  test += "\n\ntest('iOS Simulator uses in-app ringing and isolates CallKit lifecycle', () => {\n" +
    "  const systemCalls = fs.readFileSync('src/lib/systemCalls/veloraSystemCalls.ts', 'utf8')\n" +
    "  const provider = fs.readFileSync('src/providers/CallProvider.tsx', 'utf8')\n" +
    "  const callScreen = fs.readFileSync('app/call/[id].tsx', 'utf8')\n" +
    "  const swift = fs.readFileSync('modules/velora-system-calls/ios/VeloraSystemCallsModule.swift', 'utf8')\n" +
    "  assert.ok(systemCalls.includes(\"Platform.OS === 'ios' && !Device.isDevice\"))\n" +
    "  assert.ok(systemCalls.includes('if (isIosSimulator || !nativeModule?.addListener)'))\n" +
    "  assert.ok(provider.includes('router.push(`/call/${payload.callId}` as never)'))\n" +
    "  assert.ok(provider.includes('activateSimulatorAudioSession(callId)'))\n" +
    "  assert.ok(provider.includes('activateSimulatorAudioSession(joined.callId)'))\n" +
    "  assert.ok(callScreen.includes(\"phase === 'incoming_ringing'\"))\n" +
    "  assert.ok(callScreen.includes(\"acceptIncomingCall('ui')\"))\n" +
    "  assert.ok(callScreen.includes('rejectIncomingCall()'))\n" +
    "  assert.ok(swift.includes('#if targetEnvironment(simulator)'))\n" +
    "  assert.ok(swift.includes('simulator_audio_session_activated'))\n" +
    "  assert.ok(swift.includes('deactivateSimulatorAudioSession'))\n" +
    "})\n"
}
fs.writeFileSync(testPath, test)

console.log('Finalized iOS Simulator call lifecycle isolation')
