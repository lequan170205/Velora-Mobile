const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('call socket contract supports audio/video, type switching and camera state', () => {
  const source = read('src/types/call.types.ts')
  assert.match(source, /kind: 'audio' \| 'video'/)
  assert.match(source, /set_call_type:/)
  assert.match(source, /call_type_changed:/)
  assert.match(source, /producer_closed:/)
  assert.match(source, /set_video_enabled:/)
  assert.match(source, /video_state_changed:/)
  assert.match(source, /paused\?: boolean/)
})

test('CallProvider starts video with preview and keeps same call session for type switching', () => {
  const source = read('src/providers/CallProvider.tsx')
  assert.match(source, /const startVideoCall =/)
  assert.match(source, /audio: false,[\s\S]*video: cameraConstraints/)
  assert.match(source, /set_call_type/)
  assert.match(source, /startCall\(input, 'VIDEO'\)/)
  assert.match(source, /startCall\(input, 'VOICE'\)/)
  assert.match(source, /localVideoTrack\.enabled = false/)
  assert.match(source, /cameraPausedByBackgroundRef/)
  assert.doesNotMatch(source, /reason: 'unsupported_video'/)
})

test('camera off/on is signaled without replacing the video producer', () => {
  const source = read('src/providers/CallProvider.tsx')
  assert.match(source, /const emitLocalVideoState = useCallback/)
  assert.match(source, /socket\.emit\('set_video_enabled'/)
  assert.match(source, /emitLocalVideoState\(false\)/)
  assert.match(source, /emitLocalVideoState\(true\)/)
  assert.match(source, /socket\.on\('video_state_changed', handleVideoStateChanged\)/)
  assert.match(source, /remoteVideoEnabledByProducerRef/)
  assert.match(source, /remoteVideoState: videoEnabled \? 'connected' : 'off'/)
})

test('native VIDEO answer survives background recovery without silently downgrading', () => {
  const source = read('src/providers/CallProvider.tsx')
  assert.doesNotMatch(
    source,
    /callState\.callType === 'VIDEO'[\s\S]{0,220}dismissIncomingCall\(action\.callId\)/,
  )
  assert.match(
    source,
    /const shouldDeferLocalVideo =[\s\S]*callType === 'VIDEO' && AppState\.currentState !== 'active'/,
  )
  assert.match(source, /cameraEnabled:[\s\S]*Boolean\(localVideoTrack\) \|\| shouldDeferLocalVideo/)
  assert.match(source, /activateLocalVideo\(\{ requestPermission: false \}\)/)
})

test('active call screen renders RTC video and both conversion directions', () => {
  const source = read('app/call/[id].tsx')
  assert.match(source, /RTCView/)
  assert.match(source, /switchCallType\('VIDEO'\)/)
  assert.match(source, /switchCallType\('VOICE'\)/)
  assert.match(source, /switchCamera/)
  assert.match(source, /toggleCamera/)
})

test('conversation video entry point remains direct-chat only', () => {
  const source = read('app/conversation/[id].tsx')
  assert.match(source, /const \{ startVideoCall, startVoiceCall \} = useCall\(\)/)
  assert.match(source, /const handleStartVideoCall =/)
  assert.match(source, /!currentConversation\?\.isGroup && otherUserId/)
  assert.match(source, /name="videocam"/)
})

test('native call surfaces preserve and validate VIDEO callType', () => {
  const wrapper = read('src/lib/systemCalls/veloraSystemCalls.ts')
  const android = read(
    'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraCallNotifications.kt',
  )
  const swift = read('modules/velora-system-calls/ios/VeloraSystemCallsModule.swift')
  const plugin = read('plugins/withVeloraSystemCalls.js')

  assert.match(wrapper, /callType: CallType/)
  assert.match(android, /Incoming video call/)
  assert.match(swift, /configuration\.supportsVideo = true/)
  assert.match(swift, /action\.isVideo = nonEmptyString\(payload\["callType"\]\) == "VIDEO"/)
  assert.match(swift, /callType != "VOICE" && callType != "VIDEO"/)
  assert.match(swift, /let supportedVideo = validateIncomingPayload/)
  assert.match(swift, /assert\(supportedVideo\.accepted\)/)
  assert.match(swift, /callUpdate\(displayName: "Velora call", isVideo: false\)/)
  assert.doesNotMatch(swift, /VoIP incoming call reporting only supports audio calls/)
  assert.match(plugin, /configuration\.supportsVideo = true/)
  assert.match(plugin, /action\.isVideo/)
  assert.match(plugin, /update\.hasVideo = isVideo/)
  assert.match(plugin, /native incoming VOICE\/VIDEO validation/)
})

test('native incoming VIDEO is accepted on both platforms', () => {
  const androidStore = read(
    'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraSystemCallStore.kt',
  )
  const swift = read('modules/velora-system-calls/ios/VeloraSystemCallsModule.swift')

  assert.doesNotMatch(androidStore, /payload\[\"callType\"\] == \"VIDEO\"/)
  assert.match(androidStore, /callType != null && callType !in setOf\(\"VOICE\", \"VIDEO\"\)/)
  assert.doesNotMatch(swift, /if payload\[\"callType\"\] as\? String == \"VIDEO\"/)
  assert.match(swift, /callType != \"VOICE\" && callType != \"VIDEO\"/)
})

test('VIDEO defaults to speaker without overriding external audio routes', () => {
  const source = read('src/providers/CallProvider.tsx')
  assert.match(source, /const shouldDefaultVideoToSpeaker =/)
  assert.match(source, /Bluetooth\|Headphones\|Headset\|AirPlay\|CarAudio\|USB\|LineOut\|Wired/)
  assert.match(source, /enableDefaultVideoSpeaker\(audioSessionConfiguration\)/)
  assert.match(source, /enableDefaultVideoSpeaker\(nativeAudioSessionState\)/)
})

test('background VIDEO camera deferral is applied exactly once', () => {
  const source = read('src/providers/CallProvider.tsx')
  const matches =
    source.match(
      /if \(shouldDeferLocalVideo\) \{\s*cameraPausedByBackgroundRef\.current = true\s*\}/g,
    ) ?? []
  assert.equal(matches.length, 1)
})

test('native call type follows active VOICE and VIDEO transitions', () => {
  const wrapper = read('src/lib/systemCalls/veloraSystemCalls.ts')
  const provider = read('src/providers/CallProvider.tsx')
  const androidModule = read(
    'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraSystemCallsModule.kt',
  )
  const androidStore = read(
    'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraSystemCallStore.kt',
  )
  const foreground = read(
    'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraCallForegroundService.kt',
  )
  const swift = read('modules/velora-system-calls/ios/VeloraSystemCallsModule.swift')

  assert.match(wrapper, /setCallType: \(callId: string, callType: CallType\) => boolean/)
  assert.match(provider, /veloraSystemCalls\.setCallType\(payload\.callId, payload\.callType\)/)
  assert.match(androidModule, /Function\(\"setCallType\"\)/)
  assert.match(androidStore, /val callType: String\?/)
  assert.match(foreground, /\"callType\" to currentCall/)
  assert.match(swift, /func setCallType\(callId: String, callType: String\) -> Bool/)
  assert.match(swift, /provider\.reportCall\([\s\S]*updated: callUpdate/)
})

test('video producer cleanup is not duplicated in CallProvider', () => {
  const source = read('src/providers/CallProvider.tsx')
  const marker = 'remoteVideoEnabledByProducerRef.current.delete(payload.producerId)'
  assert.equal(source.split(marker).length - 1, 1)
})

test('peer video upgrade never turns on the local camera automatically', () => {
  const source = read('src/providers/CallProvider.tsx')
  assert.doesNotMatch(
    source,
    /payload\.changedByUserId !== currentUserId[\s\S]{0,180}activateLocalVideo/,
  )
})

test('camera flip prefers constraints with a legacy WebRTC fallback', () => {
  const source = read('src/providers/CallProvider.tsx')
  assert.match(source, /track\.applyConstraints\(\{ facingMode: nextFacing \}\)/)
  assert.match(source, /track\._switchCamera\(\)/)
})

test('iOS Simulator uses in-app ringing and isolates CallKit lifecycle', () => {
  const systemCalls = fs.readFileSync('src/lib/systemCalls/veloraSystemCalls.ts', 'utf8')
  const provider = fs.readFileSync('src/providers/CallProvider.tsx', 'utf8')
  const callScreen = fs.readFileSync('app/call/[id].tsx', 'utf8')
  const swift = fs.readFileSync(
    'modules/velora-system-calls/ios/VeloraSystemCallsModule.swift',
    'utf8',
  )
  assert.ok(systemCalls.includes("Platform.OS === 'ios' && !Device.isDevice"))
  assert.ok(systemCalls.includes('if (isIosSimulator || !nativeModule?.addListener)'))
  assert.ok(provider.includes('router.push(`/call/${payload.callId}` as never)'))
  assert.ok(provider.includes('activateSimulatorAudioSession(callId)'))
  assert.ok(provider.includes('activateSimulatorAudioSession(joined.callId)'))
  assert.ok(callScreen.includes("phase === 'incoming_ringing'"))
  assert.ok(callScreen.includes("acceptIncomingCall('ui')"))
  assert.ok(callScreen.includes('rejectIncomingCall()'))
  assert.ok(swift.includes('#if targetEnvironment(simulator)'))
  assert.ok(swift.includes('simulator_audio_session_activated'))
  assert.ok(swift.includes('deactivateSimulatorAudioSession'))
})
