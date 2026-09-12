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

test('native VIDEO answer defers camera capture without silently downgrading', () => {
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
    /cameraEnabled: false,[\s\S]*if \(shouldDeferLocalVideo\) \{[\s\S]*cameraPausedByBackgroundRef\.current = true/,
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

test('outgoing video call stays on the identity layout until the peer answers', () => {
  const source = read('app/call/[id].tsx')
  assert.match(source, /isVideo && phase !== 'outgoing_ringing' && !areAllVideoCamerasOff/)
  assert.match(source, /if \(shouldRenderVideoTiles\)/)
  assert.doesNotMatch(source, /if \(isVideo\)/)
})

test('joined video participants use a camera-state-independent adaptive grid', () => {
  const source = read('app/call/[id].tsx')
  assert.match(source, /function VideoParticipantGrid/)
  assert.match(source, /const tiles = Children\.toArray\(children\)/)
  assert.match(source, /tiles\.length === 2 && !isLandscape \? 1/)
  assert.match(source, /Math\.min\(2, tiles\.length\)/)
  assert.match(source, /<VideoParticipantGrid isLandscape=\{isLandscape\}>/)
  assert.match(source, /key="remote-participant"/)
  assert.match(source, /key="local-participant"/)
  assert.match(source, /hasRemoteVideo \? \(/)
  assert.match(source, /hasLocalVideo \? \(/)
})

test('two disabled cameras collapse to the identity layout with a reduced-motion crossfade', () => {
  const source = read('app/call/[id].tsx')
  assert.match(
    source,
    /const areAllVideoCamerasOff = isVideo && !cameraEnabled && remoteVideoState === 'off'/,
  )
  assert.match(source, /const CALL_LAYOUT_ENTERING = FadeIn\.duration\(220\)/)
  assert.match(source, /const CALL_LAYOUT_EXITING = FadeOut\.duration\(140\)/)
  assert.equal(source.split('.reduceMotion(ReduceMotion.System)').length - 1, 2)
  assert.match(source, /key="video-grid-layout"/)
  assert.match(source, /key="identity-layout"/)
})

test('video call controls remain reachable after both cameras collapse to the identity layout', () => {
  const source = read('app/call/[id].tsx')

  // A VIDEO call retains its More controls button even when the visual layout
  // switches away from tiles. Its sheet must therefore exist in both branches.
  assert.equal(source.split('{controlsSheet}').length - 1, 2)
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

test('Connecting exposes only the reliable End action', () => {
  const source = read('app/call/[id].tsx')
  const controls = source.slice(source.indexOf('const activeControls = ('), source.indexOf('const participantsSheet = ('))

  assert.match(source, /const controlsDisabled = phase !== 'active'/)
  assert.match(
    controls,
    /icon=\{muted \? 'mic-off' : 'mic'\}[\s\S]{0,260}disabled=\{controlsDisabled\}/,
  )
  assert.match(controls, /icon="call-end"[\s\S]{0,180}onPress=\{\(\) => void endCall\(\)\}/)
})

test('video tiles stay edge-to-edge without artificial top or bottom vignettes', () => {
  const source = read('app/call/[id].tsx')
  const videoLayout = source.slice(
    source.indexOf('if (shouldRenderVideoTiles)'),
    source.indexOf('key="identity-layout"'),
  )

  assert.doesNotMatch(videoLayout, /<LinearGradient/)
  assert.match(source, /backgroundColor: colors\.call\.topControl/)
  assert.match(source, /backgroundColor: colors\.call\.dock/)
})

test('conversation video entry point remains direct-chat only', () => {
  const screen = read('app/conversation/[id].tsx')
  const header = read('src/components/chat/conversation/ConversationHeader.tsx')
  assert.match(screen, /const \{ startVideoCall, startVoiceCall \} = useCall\(\)/)
  assert.match(screen, /const handleStartVideoCall =/)
  assert.match(
    screen,
    /callPhase === 'idle' && !currentConversation\?\.isGroup && Boolean\(otherUserId\)/,
  )
  assert.match(header, /showCallActions \? \(/)
  assert.match(header, /onPress=\{onStartVideoCall\}/)
  assert.match(header, /icon="videocam-outline"/)
})

test('conversation call actions provide immediate single-flight loading feedback', () => {
  const screen = read('app/conversation/[id].tsx')
  const header = read('src/components/chat/conversation/ConversationHeader.tsx')

  assert.match(screen, /const \[pendingCallType, setPendingCallType\] = useState/)
  assert.match(screen, /callStartInFlightRef\.current/)
  assert.match(screen, /startVoiceCall\(\{/)
  assert.match(screen, /startVideoCall\(\{/)
  assert.match(screen, /callActionsDisabled=\{callPhase !== 'idle' \|\| pendingCallType !== null\}/)
  assert.match(header, /<ActivityIndicator/)
  assert.match(header, /disabled=\{callActionsDisabled\}/)
  assert.match(header, /busy=\{pendingCallType === 'VIDEO'\}/)
  assert.match(header, /busy=\{pendingCallType === 'VOICE'\}/)
  assert.match(header, /Haptics\.selectionAsync\(\)/)
  assert.match(header, /withTiming\(0\.9/)
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
      /if \(shouldDeferLocalVideo\) \{[\s\S]*?cameraPausedByBackgroundRef\.current = true[\s\S]*?return/g,
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

test('minimized calls use native resume surfaces and a draggable global return control', () => {
  const layout = read('app/_layout.tsx')
  const screen = read('app/conversation/[id].tsx')
  const floatingCallButton = read('src/components/call/FloatingActiveCallButton.tsx')
  const callScreen = read('app/call/[id].tsx')
  const android = read(
    'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraCallNotifications.kt',
  )
  const provider = read('src/providers/CallProvider.tsx')

  assert.doesNotMatch(layout, /ActiveCallBanner|CALL_BANNER_|Return to .* call/)
  assert.match(layout, /<FloatingActiveCallButton \/>/)
  assert.match(floatingCallButton, /Gesture\.Pan\(\)/)
  assert.match(floatingCallButton, /\.minDistance\(8\)/)
  assert.match(floatingCallButton, /event\.translationX/)
  assert.match(floatingCallButton, /event\.translationY/)
  assert.match(floatingCallButton, /event\.velocityX \* 0\.12/)
  assert.match(floatingCallButton, /projectedX < \(minimumX \+ maximumX\) \/ 2/)
  assert.match(floatingCallButton, /insets\.left \+ EDGE_INSET/)
  assert.match(floatingCallButton, /width - insets\.right - EDGE_INSET - BUTTON_SIZE/)
  assert.match(floatingCallButton, /getDockedTabBarHeight\(insets\.bottom\)/)
  assert.match(floatingCallButton, /CONVERSATION_COMPOSER_CLEARANCE/)
  assert.match(floatingCallButton, /pathname\.startsWith\('\/conversation\/'\)/)
  assert.match(floatingCallButton, /useReanimatedKeyboardAnimation/)
  assert.match(floatingCallButton, /keyboardAwareY/)
  assert.match(floatingCallButton, /pathname\.startsWith\('\/call\/'\)/)
  assert.match(floatingCallButton, /className="h-12 w-12/)
  assert.match(floatingCallButton, /Haptics\.selectionAsync\(\)/)
  assert.match(floatingCallButton, /router\.push\(`\/call\/\$\{callId\}` as never\)/)
  assert.match(floatingCallButton, /backgroundColor: colors\.bubble\.outgoing/)
  assert.match(floatingCallButton, /ReduceMotion\.System/)
  assert.doesNotMatch(floatingCallButton, /useCallStore\(\)/)
  assert.match(screen, /callPhase === 'idle' && !currentConversation\?\.isGroup/)
  assert.match(callScreen, /veloraSystemCalls\.usesNativeCallUi \? \(/)
  assert.match(android, /setContentIntent\(returnToCallPendingIntent\(context, callId\)\)/)
  assert.match(android, /Uri\.parse\("antigravity:\/\/\/call\/\$callId"\)/)
  assert.match(provider, /isBusyPhase\(useCallStore\.getState\(\)\.phase\)/)
  assert.match(provider, /reason: 'busy'/)
})
