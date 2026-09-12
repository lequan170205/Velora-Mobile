const fs = require('node:fs')

const replaceRequired = (source, before, after, label) => {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`Missing simulator-call anchor: ${label}`)
  return source.replace(before, after)
}

// JS/native wrapper: real iPhones keep CallKit; iOS Simulator uses in-app call UI.
const systemCallsPath = 'src/lib/systemCalls/veloraSystemCalls.ts'
let systemCalls = fs.readFileSync(systemCallsPath, 'utf8')
systemCalls = replaceRequired(
  systemCalls,
  `import { requireOptionalNativeModule } from 'expo'\nimport { Platform } from 'react-native'`,
  `import { requireOptionalNativeModule } from 'expo'\nimport * as Device from 'expo-device'\nimport { Platform } from 'react-native'`,
  'expo-device import',
)
systemCalls = replaceRequired(
  systemCalls,
  `  dismissIncomingCall: (callId: string) => Promise<CallKitTransactionResult>\n}`,
  `  dismissIncomingCall: (callId: string) => Promise<CallKitTransactionResult>\n  activateSimulatorAudioSession: (callId: string) => boolean\n  deactivateSimulatorAudioSession: (callId: string) => boolean\n}`,
  'native simulator audio contract',
)
systemCalls = replaceRequired(
  systemCalls,
  `const nativeModule = requireOptionalNativeModule<VeloraSystemCallsNativeModule>('VeloraSystemCalls')\n\nexport const veloraSystemCalls = {\n  isAvailable: Boolean(nativeModule),`,
  `const nativeModule = requireOptionalNativeModule<VeloraSystemCallsNativeModule>('VeloraSystemCalls')\nconst isIosSimulator = Platform.OS === 'ios' && !Device.isDevice\n\nconst simulatorCallResult = (callId: string): Promise<CallKitTransactionResult> =>\n  Promise.resolve({\n    success: true,\n    callId,\n    callUuid: null,\n    errorCode: null,\n    errorMessage: null,\n  })\n\nexport const veloraSystemCalls = {\n  isAvailable: Boolean(nativeModule),\n  isIosSimulator,\n  usesNativeCallUi: Boolean(nativeModule) && !isIosSimulator,`,
  'simulator capability flags',
)
systemCalls = replaceRequired(
  systemCalls,
  `  getPendingCallAction() {\n    return nativeModule?.getPendingCallAction?.() ?? null\n  },`,
  `  getPendingCallAction() {\n    if (isIosSimulator) return null\n    return nativeModule?.getPendingCallAction?.() ?? null\n  },`,
  'ignore simulator pending CallKit actions',
)
systemCalls = replaceRequired(
  systemCalls,
  `  presentIncomingCall(payload: NativeCallPayload): Promise<CallKitTransactionResult> {\n    return (\n      nativeModule?.presentIncomingCall?.(payload) ??`,
  `  presentIncomingCall(payload: NativeCallPayload): Promise<CallKitTransactionResult> {\n    if (isIosSimulator) return simulatorCallResult(payload.callId)\n    return (\n      nativeModule?.presentIncomingCall?.(payload) ??`,
  'simulator incoming CallKit bypass',
)
systemCalls = replaceRequired(
  systemCalls,
  `  registerOutgoingCall(payload: NativeOutgoingCallPayload): Promise<CallKitTransactionResult> {\n    return (\n      nativeModule?.registerOutgoingCall?.(payload) ??`,
  `  registerOutgoingCall(payload: NativeOutgoingCallPayload): Promise<CallKitTransactionResult> {\n    if (isIosSimulator) return simulatorCallResult(payload.callId)\n    return (\n      nativeModule?.registerOutgoingCall?.(payload) ??`,
  'simulator outgoing CallKit bypass',
)
systemCalls = replaceRequired(
  systemCalls,
  `  setCallActive(callId: string) {\n    return nativeModule?.setCallActive?.(callId) ?? false\n  },`,
  `  setCallActive(callId: string) {\n    if (isIosSimulator) return true\n    return nativeModule?.setCallActive?.(callId) ?? false\n  },`,
  'simulator active state bypass',
)
systemCalls = replaceRequired(
  systemCalls,
  `  setCallType(callId: string, callType: CallType) {\n    return nativeModule?.setCallType?.(callId, callType) ?? false\n  },`,
  `  setCallType(callId: string, callType: CallType) {\n    if (isIosSimulator) return true\n    return nativeModule?.setCallType?.(callId, callType) ?? false\n  },`,
  'simulator call type bypass',
)
systemCalls = replaceRequired(
  systemCalls,
  `  endCall(callId: string): Promise<CallKitTransactionResult> {\n    return (\n      nativeModule?.endCall?.(callId) ??`,
  `  endCall(callId: string): Promise<CallKitTransactionResult> {\n    if (isIosSimulator) {\n      nativeModule?.deactivateSimulatorAudioSession?.(callId)\n      return simulatorCallResult(callId)\n    }\n    return (\n      nativeModule?.endCall?.(callId) ??`,
  'simulator end bypass',
)
systemCalls = replaceRequired(
  systemCalls,
  `  dismissIncomingCall(callId: string): Promise<CallKitTransactionResult> {\n    return (\n      nativeModule?.dismissIncomingCall?.(callId) ??`,
  `  dismissIncomingCall(callId: string): Promise<CallKitTransactionResult> {\n    if (isIosSimulator) {\n      nativeModule?.deactivateSimulatorAudioSession?.(callId)\n      return simulatorCallResult(callId)\n    }\n    return (\n      nativeModule?.dismissIncomingCall?.(callId) ??`,
  'simulator dismiss bypass',
)
systemCalls = replaceRequired(
  systemCalls,
  `  addCallActionListener(listener: (event: NativeCallAction) => void) {\n    if (!nativeModule?.addListener) {`,
  `  activateSimulatorAudioSession(callId: string) {\n    if (!isIosSimulator) return true\n    return nativeModule?.activateSimulatorAudioSession?.(callId) ?? false\n  },\n\n  deactivateSimulatorAudioSession(callId: string) {\n    if (!isIosSimulator) return true\n    return nativeModule?.deactivateSimulatorAudioSession?.(callId) ?? false\n  },\n\n  addCallActionListener(listener: (event: NativeCallAction) => void) {\n    if (isIosSimulator || !nativeModule?.addListener) {`,
  'simulator audio API and action listener bypass',
)
fs.writeFileSync(systemCallsPath, systemCalls)

// Provider: route simulator incoming calls to in-app call screen and activate audio manually.
const providerPath = 'src/providers/CallProvider.tsx'
let provider = fs.readFileSync(providerPath, 'utf8')
provider = replaceRequired(
  provider,
  `      veloraSystemCalls.presentIncomingCall(nativePayload)\n    },`,
  `      if (veloraSystemCalls.isIosSimulator) {\n        router.push(\`/call/\${payload.callId}\` as never)\n      } else {\n        veloraSystemCalls.presentIncomingCall(nativePayload)\n      }\n    },`,
  'simulator incoming route',
)
provider = provider.replace(
  `        debugCall('[Call] Waiting for configured native audio session...')\n        const audioSessionConfiguration = await waitForConfiguredAudioSession(setupToken, callId)`,
  `        debugCall('[Call] Waiting for configured native audio session...')\n        if (veloraSystemCalls.isIosSimulator && !veloraSystemCalls.activateSimulatorAudioSession(callId)) {\n          throw new Error('simulator_audio_session_activation_failed')\n        }\n        const audioSessionConfiguration = await waitForConfiguredAudioSession(setupToken, callId)`,
)
const activationCount = provider.split("activateSimulatorAudioSession(callId)").length - 1
if (activationCount < 2) {
  throw new Error(`Expected simulator audio activation in incoming and outgoing setup, found ${activationCount}`)
}
fs.writeFileSync(providerPath, provider)

// In-app call screen: incoming ringing has explicit Answer/Decline controls for Simulator.
const callScreenPath = 'app/call/[id].tsx'
let callScreen = fs.readFileSync(callScreenPath, 'utf8')
callScreen = replaceRequired(
  callScreen,
  `  const { endCall, switchCallType, switchCamera, toggleCamera, toggleMute, toggleSpeaker } =\n    useCall()`,
  `  const {\n    acceptIncomingCall,\n    endCall,\n    rejectIncomingCall,\n    switchCallType,\n    switchCamera,\n    toggleCamera,\n    toggleMute,\n    toggleSpeaker,\n  } = useCall()`,
  'incoming call actions',
)
callScreen = replaceRequired(
  callScreen,
  `      phase === 'outgoing_ringing' ||\n      phase === 'connecting' ||`,
  `      phase === 'incoming_ringing' ||\n      phase === 'outgoing_ringing' ||\n      phase === 'connecting' ||`,
  'incoming phase validity',
)
callScreen = replaceRequired(
  callScreen,
  `    if (phase === 'outgoing_ringing') return 'Calling...'`,
  `    if (phase === 'incoming_ringing') return callType === 'VIDEO' ? 'Incoming video call' : 'Incoming call'\n    if (phase === 'outgoing_ringing') return 'Calling...'`,
  'incoming status',
)
callScreen = replaceRequired(
  callScreen,
  `        <View className={\`z-20 w-full pb-8 pt-5 \${isVideo ? 'bg-black/20' : ''}\`}>\n          <View className="flex-row flex-wrap items-center justify-center gap-4 px-6">`,
  `        <View className={\`z-20 w-full pb-8 pt-5 \${isVideo ? 'bg-black/20' : ''}\`}>\n          {phase === 'incoming_ringing' ? (\n            <View className="flex-row items-center justify-center gap-12 px-6">\n              <TouchableOpacity\n                className="h-20 w-20 items-center justify-center rounded-full bg-status-error"\n                onPress={() => void rejectIncomingCall()}\n                accessibilityRole="button"\n                accessibilityLabel="Decline call"\n              >\n                <MaterialIcons name="call-end" size={36} color="#FFFFFF" />\n              </TouchableOpacity>\n              <TouchableOpacity\n                className="h-20 w-20 items-center justify-center rounded-full bg-call-green"\n                onPress={() => void acceptIncomingCall('ui')}\n                accessibilityRole="button"\n                accessibilityLabel="Answer call"\n              >\n                <MaterialIcons name={isVideo ? 'videocam' : 'call'} size={36} color="#FFFFFF" />\n              </TouchableOpacity>\n            </View>\n          ) : (\n            <>\n          <View className="flex-row flex-wrap items-center justify-center gap-4 px-6">`,
  'incoming controls opening',
)
callScreen = replaceRequired(
  callScreen,
  `          <View className="mt-7 items-center">\n            <TouchableOpacity\n              className="h-20 w-20 items-center justify-center rounded-full bg-status-error"\n              onPress={() => void endCall()}\n              activeOpacity={0.8}\n              accessibilityRole="button"\n              accessibilityLabel="End call"\n            >\n              <MaterialIcons name="call-end" size={36} color="#FFFFFF" />\n            </TouchableOpacity>\n          </View>\n        </View>`,
  `          <View className="mt-7 items-center">\n            <TouchableOpacity\n              className="h-20 w-20 items-center justify-center rounded-full bg-status-error"\n              onPress={() => void endCall()}\n              activeOpacity={0.8}\n              accessibilityRole="button"\n              accessibilityLabel="End call"\n            >\n              <MaterialIcons name="call-end" size={36} color="#FFFFFF" />\n            </TouchableOpacity>\n          </View>\n            </>\n          )}\n        </View>`,
  'incoming controls closing',
)
fs.writeFileSync(callScreenPath, callScreen)

// Native iOS: simulator-only manual AVAudioSession/WebRTC activation and teardown.
const swiftPath = 'modules/velora-system-calls/ios/VeloraSystemCallsModule.swift'
let swift = fs.readFileSync(swiftPath, 'utf8')
swift = replaceRequired(
  swift,
  `    AsyncFunction("dismissIncomingCall") { (callId: String, promise: Promise) in\n      let callCenter = VeloraSystemCallCenter.shared\n      callCenter.runOnMain {\n        callCenter.endCall(callId: callId) { result in\n          promise.resolve(result)\n        }\n      }\n    }\n  }\n}`,
  `    AsyncFunction("dismissIncomingCall") { (callId: String, promise: Promise) in\n      let callCenter = VeloraSystemCallCenter.shared\n      callCenter.runOnMain {\n        callCenter.endCall(callId: callId) { result in\n          promise.resolve(result)\n        }\n      }\n    }\n\n    Function("activateSimulatorAudioSession") { (callId: String) -> Bool in\n      let callCenter = VeloraSystemCallCenter.shared\n      return callCenter.runOnMain {\n        callCenter.activateSimulatorAudioSession(callId: callId)\n      }\n    }\n\n    Function("deactivateSimulatorAudioSession") { (callId: String) -> Bool in\n      let callCenter = VeloraSystemCallCenter.shared\n      return callCenter.runOnMain {\n        callCenter.deactivateSimulatorAudioSession(callId: callId)\n      }\n    }\n  }\n}`,
  'native module simulator methods',
)
swift = replaceRequired(
  swift,
  `  private func prepareWebRtcAudioSessionForCallKit(callId: String?, callUuid: UUID?) {`,
  `  func activateSimulatorAudioSession(callId: String) -> Bool {\n    #if targetEnvironment(simulator)\n      let audioSession = AVAudioSession.sharedInstance()\n      resetAudioConfigurationState()\n      speakerOverrideEnabled = false\n      do {\n        try audioSession.setCategory(\n          .playAndRecord,\n          mode: .voiceChat,\n          options: [.allowBluetoothHFP, .allowBluetoothA2DP]\n        )\n        try audioSession.setActive(true)\n        isNativeAudioSessionActivated = true\n        nativeAudioSessionActivatedAt = Date()\n        nativeAudioSessionDeactivatedAt = nil\n        nativeAudioSessionActivationSequence += 1\n        nativeAudioSessionCallUuid = uuidsByCallId[callId]\n        configureWebRtcAudioSession(audioSession)\n        logOperationalNotice(\n          layer: "simulator",\n          event: "simulator_audio_session_activated",\n          callId: callId,\n          success: isAudioSessionConfigured\n        )\n        return isAudioSessionConfigured\n      } catch {\n        audioSessionConfigurationErrorCode = "simulator_audio_session_activation_failed"\n        logOperationalNotice(\n          layer: "simulator",\n          event: "simulator_audio_session_activation_failed",\n          callId: callId,\n          success: false,\n          errorCode: audioSessionConfigurationErrorCode\n        )\n        return false\n      }\n    #else\n      return false\n    #endif\n  }\n\n  func deactivateSimulatorAudioSession(callId: String) -> Bool {\n    #if targetEnvironment(simulator)\n      let audioSession = AVAudioSession.sharedInstance()\n      let rtcAudioSession = RTCAudioSession.sharedInstance()\n      rtcAudioSession.isAudioEnabled = false\n      do {\n        try audioSession.setActive(false, options: .notifyOthersOnDeactivation)\n      } catch {\n        logOperationalNotice(\n          layer: "simulator",\n          event: "simulator_audio_session_deactivation_failed",\n          callId: callId,\n          success: false,\n          errorCode: "simulator_audio_session_deactivation_failed"\n        )\n        return false\n      }\n      isNativeAudioSessionActivated = false\n      nativeAudioSessionDeactivatedAt = Date()\n      nativeAudioSessionCallUuid = nil\n      resetAudioConfigurationState()\n      logOperationalNotice(\n        layer: "simulator",\n        event: "simulator_audio_session_deactivated",\n        callId: callId,\n        success: true\n      )\n      return true\n    #else\n      return false\n    #endif\n  }\n\n  private func prepareWebRtcAudioSessionForCallKit(callId: String?, callUuid: UUID?) {`,
  'simulator audio implementation',
)
fs.writeFileSync(swiftPath, swift)

// Regression contract.
const testPath = 'tests/video-call-1to1-contract.test.cjs'
let test = fs.readFileSync(testPath, 'utf8')
if (!test.includes("iOS Simulator uses in-app ringing and cannot terminate server calls through CallKit")) {
  test += `\n\ntest('iOS Simulator uses in-app ringing and cannot terminate server calls through CallKit', () => {\n  const systemCalls = fs.readFileSync('src/lib/systemCalls/veloraSystemCalls.ts', 'utf8')\n  const provider = fs.readFileSync('src/providers/CallProvider.tsx', 'utf8')\n  const callScreen = fs.readFileSync('app/call/[id].tsx', 'utf8')\n  const swift = fs.readFileSync('modules/velora-system-calls/ios/VeloraSystemCallsModule.swift', 'utf8')\n\n  assert.match(systemCalls, /Platform\\.OS === 'ios' && !Device\\.isDevice/)\n  assert.match(systemCalls, /if \\(isIosSimulator\\) return simulatorCallResult\\(payload\\.callId\\)/)\n  assert.match(systemCalls, /if \\(isIosSimulator \\|\\| !nativeModule\\?\\.addListener\\)/)\n  assert.match(provider, /veloraSystemCalls\\.isIosSimulator[\\s\\S]*router\\.push\\(`\\/call\\/\\$\\{payload\\.callId\\}`/)\n  assert.ok((provider.match(/activateSimulatorAudioSession\\(callId\\)/g) ?? []).length >= 2)\n  assert.match(callScreen, /phase === 'incoming_ringing'/)\n  assert.match(callScreen, /acceptIncomingCall\\('ui'\\)/)\n  assert.match(callScreen, /rejectIncomingCall\\(\\)/)\n  assert.match(swift, /#if targetEnvironment\\(simulator\\)[\\s\\S]*simulator_audio_session_activated/)\n  assert.match(swift, /deactivateSimulatorAudioSession/)\n})\n`
}
fs.writeFileSync(testPath, test)

console.log('Applied iOS Simulator call lifecycle isolation')
