const fs = require('node:fs')

const replaceRequired = (source, before, after, label) => {
  if (source.includes(after)) return source
  if (!source.includes(before)) throw new Error(`Finalizer anchor not found: ${label}`)
  return source.replace(before, after)
}

const androidStorePath =
  'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraSystemCallStore.kt'
let androidStore = fs.readFileSync(androidStorePath, 'utf8')
const blockedAndroidVideo = `    if (payload["type"] != "INCOMING_CALL" || payload["callType"] == "VIDEO") {\n      return false\n    }`
const acceptedAndroidVideo = `    if (payload["type"] != "INCOMING_CALL") {\n      return false\n    }\n\n    val callType = payload["callType"] as? String\n    if (callType != null && callType !in setOf("VOICE", "VIDEO")) {\n      return false\n    }`
if (!androidStore.includes(acceptedAndroidVideo)) {
  if (!androidStore.includes(blockedAndroidVideo)) {
    throw new Error('Finalizer anchor not found: Android incoming VOICE/VIDEO validation')
  }
  androidStore = androidStore.replace(blockedAndroidVideo, acceptedAndroidVideo)
}
fs.writeFileSync(androidStorePath, androidStore)

const providerPath = 'src/providers/CallProvider.tsx'
let provider = fs.readFileSync(providerPath, 'utf8')

const deferredVideoBlock = `      if (shouldDeferLocalVideo) {\n        cameraPausedByBackgroundRef.current = true\n      }\n`
while (provider.includes(`${deferredVideoBlock}\n${deferredVideoBlock}`)) {
  provider = provider.replace(`${deferredVideoBlock}\n${deferredVideoBlock}`, deferredVideoBlock)
}

if (!provider.includes('const shouldDefaultVideoToSpeaker =')) {
  provider = replaceRequired(
    provider,
    `const getRtcQualityCounters = (report: RTCStatsReport | unknown): RtcQualityCounters => {`,
    `const shouldDefaultVideoToSpeaker = (\n  configuration: AudioSessionConfiguration | undefined,\n) => {\n  const externalRoutePattern =\n    /Bluetooth|Headphones|Headset|AirPlay|CarAudio|USB|LineOut|Wired/i\n  return !(configuration?.outputRouteTypes ?? []).some((routeType) =>\n    externalRoutePattern.test(routeType),\n  )\n}\n\nconst getRtcQualityCounters = (report: RTCStatsReport | unknown): RtcQualityCounters => {`,
    'default video speaker helper',
  )
}

if (!provider.includes('const enableDefaultVideoSpeaker = useCallback')) {
  provider = replaceRequired(
    provider,
    `  const toggleSpeaker = useCallback(() => {`,
    `  const enableDefaultVideoSpeaker = useCallback(\n    (configuration?: AudioSessionConfiguration) => {\n      if (!shouldDefaultVideoToSpeaker(configuration)) return\n      if (veloraSystemCalls.setSpeakerEnabled(true)) {\n        useCallStore.getState().patch({ speakerEnabled: true })\n      }\n    },\n    [],\n  )\n\n  const toggleSpeaker = useCallback(() => {`,
    'default video speaker callback',
  )
}

provider = replaceRequired(
  provider,
  `        await postAnswerSetup(joined, { setupToken })\n        assertCallSetupCurrent(setupToken, callId)\n        if (!veloraSystemCalls.setCallActive(callId)) {`,
  `        await postAnswerSetup(joined, { setupToken })\n        assertCallSetupCurrent(setupToken, callId)\n        if (state.callType === 'VIDEO') {\n          enableDefaultVideoSpeaker(audioSessionConfiguration)\n        }\n        if (!veloraSystemCalls.setCallActive(callId)) {`,
  'incoming VIDEO default speaker',
)

provider = replaceRequired(
  provider,
  `        await postAnswerSetup(joined, { setupToken })\n        assertCallSetupCurrent(setupToken, joined.callId)\n        if (!veloraSystemCalls.setCallActive(joined.callId)) {`,
  `        await postAnswerSetup(joined, { setupToken })\n        assertCallSetupCurrent(setupToken, joined.callId)\n        if (callType === 'VIDEO') {\n          enableDefaultVideoSpeaker(audioSessionConfiguration)\n        }\n        if (!veloraSystemCalls.setCallActive(joined.callId)) {`,
  'outgoing VIDEO default speaker',
)

provider = replaceRequired(
  provider,
  `      if (nextCallType === 'VIDEO') {\n        await activateLocalVideo({ requestPermission: false })\n      } else {`,
  `      if (nextCallType === 'VIDEO') {\n        await activateLocalVideo({ requestPermission: false })\n        const nativeAudioSessionState = await veloraSystemCalls\n          .getNativeAudioSessionState()\n          .catch(() => undefined)\n        enableDefaultVideoSpeaker(nativeAudioSessionState)\n      } else {`,
  'VOICE to VIDEO default speaker',
)

provider = provider.replace(
  `      ensureCallSocketConnected,\n      postAnswerSetup,`,
  `      ensureCallSocketConnected,\n      enableDefaultVideoSpeaker,\n      postAnswerSetup,`,
)
provider = provider.replace(
  `      ensureSocketConnected,\n      postAnswerSetup,`,
  `      ensureSocketConnected,\n      enableDefaultVideoSpeaker,\n      postAnswerSetup,`,
)
provider = provider.replace(
  `      deactivateLocalVideo,\n      ensureCameraPermission,`,
  `      deactivateLocalVideo,\n      enableDefaultVideoSpeaker,\n      ensureCameraPermission,`,
)

fs.writeFileSync(providerPath, provider)

const testPath = 'tests/video-call-1to1-contract.test.cjs'
let tests = fs.readFileSync(testPath, 'utf8')
if (!tests.includes("test('native incoming VIDEO is accepted on both platforms'")) {
  tests += `\n\ntest('native incoming VIDEO is accepted on both platforms', () => {\n  const androidStore = read(\n    'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraSystemCallStore.kt',\n  )\n  const swift = read('modules/velora-system-calls/ios/VeloraSystemCallsModule.swift')\n\n  assert.doesNotMatch(androidStore, /payload\\[\\"callType\\"\\] == \\"VIDEO\\"/)\n  assert.match(androidStore, /callType != null && callType !in setOf\\(\\"VOICE\\", \\"VIDEO\\"\\)/)\n  assert.doesNotMatch(swift, /if payload\\[\\"callType\\"\\] as\\? String == \\"VIDEO\\"/)\n  assert.match(swift, /callType != \\"VOICE\\" && callType != \\"VIDEO\\"/)\n})\n\ntest('VIDEO defaults to speaker without overriding external audio routes', () => {\n  const source = read('src/providers/CallProvider.tsx')\n  assert.match(source, /const shouldDefaultVideoToSpeaker =/)\n  assert.match(source, /Bluetooth\\|Headphones\\|Headset\\|AirPlay\\|CarAudio\\|USB\\|LineOut\\|Wired/)\n  assert.match(source, /enableDefaultVideoSpeaker\\(audioSessionConfiguration\\)/)\n  assert.match(source, /enableDefaultVideoSpeaker\\(nativeAudioSessionState\\)/)\n})\n\ntest('background VIDEO camera deferral is applied exactly once', () => {\n  const source = read('src/providers/CallProvider.tsx')\n  const matches = source.match(\n    /if \\(shouldDeferLocalVideo\\) \\{\\s*cameraPausedByBackgroundRef\\.current = true\\s*\\}/g,\n  ) ?? []\n  assert.equal(matches.length, 1)\n})\n`
}
fs.writeFileSync(testPath, tests)

console.log('Finalized 1:1 video call native validation, speaker routing and provider cleanup')
