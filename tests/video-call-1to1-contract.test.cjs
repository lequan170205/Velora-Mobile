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
  const localMedia = read('src/lib/call/useCallLocalMediaRuntime.ts')
  const mediaTransport = read('src/lib/call/useCallMediaTransportRuntime.ts')
  const provider = read('src/providers/CallProvider.tsx')
  assert.match(localMedia, /const emitLocalVideoState = useCallback/)
  assert.match(localMedia, /socket\.emit\('set_video_enabled'/)
  assert.match(localMedia, /emitLocalVideoState\(false\)/)
  assert.match(localMedia, /emitLocalVideoState\(true\)/)
  assert.match(provider, /socket\.on\('video_state_changed', handleVideoStateChanged\)/)
  assert.match(provider, /remoteVideoEnabledByProducerRef/)
  assert.match(provider, /if \(payload\.enabled\) videoConsumer\.resume\(\)/)
  assert.match(provider, /else videoConsumer\.pause\(\)/)
  assert.match(mediaTransport, /remoteVideoState: videoEnabled \? 'connected' : 'off'/)
})

test('native VIDEO answer survives background recovery without silently downgrading', () => {
  const source = read('src/providers/CallProvider.tsx')
  const mediaTransport = read('src/lib/call/useCallMediaTransportRuntime.ts')
  assert.doesNotMatch(
    source,
    /callState\.callType === 'VIDEO'[\s\S]{0,220}dismissIncomingCall\(action\.callId\)/,
  )
  assert.match(
    mediaTransport,
    /const shouldDeferLocalVideo =[\s\S]*callType === 'VIDEO' && AppState\.currentState !== 'active'/,
  )
  assert.match(
    mediaTransport,
    /cameraEnabled:[\s\S]*Boolean\(localVideoTrack\) \|\| shouldDeferLocalVideo/,
  )
  assert.match(source, /activateLocalVideo\(\{ requestPermission: false \}\)/)
})

test('active call screen renders RTC video and both conversion directions', () => {
  const source = read('app/call/[id].tsx')
  assert.match(source, /RTCView/)
  assert.match(source, /zOrder=\{0\}/)
  assert.doesNotMatch(source, /relative flex-1 overflow-hidden rounded-\[18px\]/)
  assert.match(source, /switchCallType\('VIDEO'\)/)
  assert.match(source, /switchCallType\('VOICE'\)/)
  assert.match(source, /switchCamera/)
  assert.match(source, /toggleCamera/)
})

test('video call chrome stays below the device status area', () => {
  const source = read('app/call/[id].tsx')
  assert.match(source, /const systemTopInset =/)
  assert.match(source, /const callTopInset = systemTopInset/)
  assert.match(source, /style=\{\{ paddingTop: callTopInset \}\}/)
  assert.match(source, /edges=\{\['right', 'bottom', 'left'\]\}/)
})

test('call feedback stays non-blocking and transient outcomes dismiss automatically', () => {
  const source = read('src/components/call/CallErrorModal.tsx')
  const policies = read('src/lib/call/callPolicies.ts')
  assert.match(policies, /if \(payload\.reason === 'cancelled'\) return null/)
  assert.doesNotMatch(source, /The caller canceled the call/)
  assert.match(source, /const TRANSIENT_OUTCOMES = new Set/)
  assert.match(source, /setTimeout\(onDismiss, 4000\)/)
  assert.match(source, /pointerEvents="box-none"/)
  assert.match(source, /accessibilityRole="alert"/)
  assert.match(source, /ReduceMotion\.System/)
  assert.doesNotMatch(source, /<Modal/)
  assert.doesNotMatch(source, /Call ended/)
  assert.doesNotMatch(source, />\s*OK\s*</)
})

test('tapping the call canvas toggles chrome without blocking its controls', () => {
  const source = read('app/call/[id].tsx')
  assert.match(source, /const \[chromeVisible, setChromeVisible\] = useState\(true\)/)
  assert.match(source, /const toggleCallChrome = useCallback/)
  assert.match(source, /onPress=\{toggleCallChrome\}/)
  assert.match(source, /pointerEvents=\{isSheetOpen \? 'none' : 'auto'\}/)
  assert.match(source, /pointerEvents=\{chromeVisible && !isSheetOpen \? 'auto' : 'none'\}/)
  assert.ok(source.split('pointerEvents="none"').length - 1 >= 3)
  assert.match(source, /reduceMotion: ReduceMotion\.System/)
})

test('participant control opens a tall in-call people bottom sheet', () => {
  const source = read('app/call/[id].tsx')
  assert.match(source, /const handleOpenParticipants = useCallback/)
  assert.match(source, /const participantsButton =/)
  assert.match(source, /participantsSheetRef\.current\?\.snapToIndex\(0\)/)
  assert.equal(source.split('onPress={handleOpenParticipants}').length - 1, 1)
  assert.ok(source.split('{participantsButton}').length - 1 >= 2)
  assert.ok(source.split('{participantsSheet}').length - 1 >= 2)
  assert.match(source, /<BottomSheet[\s\S]*index=\{-1\}/)
  assert.match(source, /containerStyle=\{\{ zIndex: 100 \}\}/)
  assert.match(source, /snapPoints=\{\['74%'\]\}/)
})

test('AppPressable preserves inline styles through NativeWind interop', () => {
  const source = read('src/components/base/AppPressable.tsx')
  assert.match(source, /const composedStyle: StyleProp<ViewStyle> =/)
  assert.match(source, /style=\{composedStyle\}/)
  assert.doesNotMatch(source, /style=\{\(state\) =>/)
})

test('enabled call controls use the outgoing message bubble color', () => {
  const source = read('app/call/[id].tsx')
  assert.match(source, /selected\s*\? colors\.bubble\.outgoing/)
  assert.match(source, /selected=\{cameraEnabled\}/)
  assert.match(source, /selected=\{!muted\}/)
  assert.match(source, /selected=\{speakerEnabled\}/)
})

test('call screen gives both participant tiles dedicated readable overlays', () => {
  const source = read('app/call/[id].tsx')
  const firstGradientStart = source.indexOf('<LinearGradient')
  const firstGradientEnd = source.indexOf('/>', firstGradientStart)
  const secondGradientStart = source.indexOf('<LinearGradient', firstGradientEnd + 2)
  const secondGradientEnd = source.indexOf('/>', secondGradientStart)

  assert.notEqual(firstGradientStart, -1)
  assert.notEqual(firstGradientEnd, -1)
  assert.notEqual(secondGradientStart, -1)
  assert.notEqual(secondGradientEnd, -1)
  const firstGradientSource = source.slice(firstGradientStart, firstGradientEnd)
  assert.match(
    firstGradientSource,
    /colors=\{\['rgba\(8,10,15,0\.88\)', 'rgba\(8,10,15,0\.10\)', 'rgba\(8,10,15,0\)'\]\}/,
    'remote tile overlay must fade to transparent',
  )
  assert.match(
    source.slice(secondGradientStart, secondGradientEnd),
    /colors=\{\['rgba\(8,10,15,0\)', 'rgba\(8,10,15,0\.42\)', 'rgba\(8,10,15,0\.98\)'\]\}/,
    'local tile overlay must protect the bottom control dock',
  )
})

test('conversation video entry point remains direct-chat only', () => {
  const screen = read('app/conversation/[id].tsx')
  const header = read('src/components/chat/conversation/ConversationHeader.tsx')
  assert.match(screen, /const \{ startVideoCall, startVoiceCall \} = useCall\(\)/)
  assert.match(screen, /const handleStartVideoCall =/)
  assert.match(
    screen,
    /showCallActions=\{!currentConversation\?\.isGroup && Boolean\(otherUserId\)\}/,
  )
  assert.match(header, /showCallActions \? \(/)
  assert.match(header, /onPress=\{onStartVideoCall\}/)
  assert.match(header, /name="videocam"/)
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
  const policies = read('src/lib/call/callPolicies.ts')
  assert.match(policies, /const shouldDefaultVideoToSpeaker =/)
  assert.match(policies, /Bluetooth\|Headphones\|Headset\|AirPlay\|CarAudio\|USB\|LineOut\|Wired/)
  assert.match(source, /enableDefaultVideoSpeaker\(audioSessionConfiguration\)/)
  assert.match(source, /enableDefaultVideoSpeaker\(nativeAudioSessionState\)/)
})

test('background VIDEO camera deferral is applied exactly once', () => {
  const source = read('src/lib/call/useCallMediaTransportRuntime.ts')
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
  const source = read('src/lib/call/useCallLocalMediaRuntime.ts')
  assert.match(source, /track\.applyConstraints\(\{ facingMode: nextFacing \}\)/)
  assert.match(source, /track\._switchCamera\(\)/)
})

test('incoming calls stay on native call surfaces and isolate simulator audio lifecycle', () => {
  const systemCalls = fs.readFileSync('src/lib/systemCalls/veloraSystemCalls.ts', 'utf8')
  const provider = fs.readFileSync('src/providers/CallProvider.tsx', 'utf8')
  const callScreen = fs.readFileSync('app/call/[id].tsx', 'utf8')
  const swift = fs.readFileSync(
    'modules/velora-system-calls/ios/VeloraSystemCallsModule.swift',
    'utf8',
  )
  const incomingHandler = provider.slice(
    provider.indexOf('const handleIncomingCall ='),
    provider.indexOf('const prepareIncomingCallFromState ='),
  )
  assert.ok(systemCalls.includes("Platform.OS === 'ios' && !Device.isDevice"))
  assert.ok(systemCalls.includes('if (isIosSimulator || !nativeModule?.addListener)'))
  assert.ok(incomingHandler.includes('void veloraSystemCalls.presentIncomingCall(nativePayload)'))
  assert.doesNotMatch(incomingHandler, /router\.(push|replace)/)
  assert.doesNotMatch(callScreen, /incoming_ringing|acceptIncomingCall|rejectIncomingCall/)
  assert.ok(provider.includes('activateSimulatorAudioSession(callId)'))
  assert.ok(provider.includes('activateSimulatorAudioSession(joined.callId)'))
  assert.ok(swift.includes('#if targetEnvironment(simulator)'))
  assert.ok(swift.includes('simulator_audio_session_activated'))
  assert.ok(swift.includes('deactivateSimulatorAudioSession'))
})
