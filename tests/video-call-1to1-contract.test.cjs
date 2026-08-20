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
