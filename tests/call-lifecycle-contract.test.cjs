const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const loadTypeScriptModule = (file) => {
  const source = fs.readFileSync(file, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: file,
  }).outputText
  const loadedModule = { exports: {} }
  const evaluate = new Function('require', 'module', 'exports', compiled)
  evaluate(require, loadedModule, loadedModule.exports)
  return loadedModule.exports
}

const lifecycle = loadTypeScriptModule(path.join(root, 'src/lib/call/callLifecycle.ts'))

test('call lifecycle only moves forward and terminal outcomes always win', () => {
  let state = 'ringing'
  for (const next of [
    'answer_requested',
    'server_accepting',
    'active',
    'audio_ready',
    'media_enhancing',
  ]) {
    state = lifecycle.reduceCallLifecycle(state, next)
  }
  assert.equal(state, 'media_enhancing')
  assert.equal(lifecycle.reduceCallLifecycle('audio_ready', 'server_accepting'), 'audio_ready')
  assert.equal(lifecycle.reduceCallLifecycle('server_accepting', 'cancelled'), 'cancelled')
  assert.equal(lifecycle.reduceCallLifecycle('cancelled', 'active'), 'cancelled')
  assert.equal(lifecycle.reduceCallLifecycle('answered_elsewhere', 'audio_ready'), 'answered_elsewhere')
})

test('native journal keeps action ordering, completion, expiry and watchdog guarantees', () => {
  const source = read('modules/velora-system-calls/ios/VeloraSystemCallsModule.swift')
  const androidStore = read(
    'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraSystemCallStore.kt',
  )
  const androidModule = read(
    'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraSystemCallsModule.kt',
  )

  assert.match(source, /completedActionsStorageKey/)
  assert.match(source, /journalExpiresAt/)
  assert.match(source, /recordCompletedPendingAction/)
  assert.match(source, /action: "resume"/)
  assert.match(source, /answerActionId/)
  assert.match(source, /isExplicitlyAnsweredElsewhere/)
  assert.match(source, /localWinningAnswerActionId != answerActionId/)
  assert.match(source, /reason: isExplicitlyAnsweredElsewhere \? "answered_elsewhere" : validation\.reason/)
  assert.match(source, /completePendingActions\(callId: callId, action: "resume", outcome: "active"\)/)
  assert.match(source, /pendingAnswerWatchdogTimeout/)
  assert.match(source, /schedulePendingAnswerWatchdog/)
  assert.match(source, /cancelPendingAnswerWatchdog/)
  assert.match(source, /return min\(callExpiration, fallbackExpiration\)/)
  assert.match(source, /validateCallStateUpdateLifecycleRevision/)
  assert.match(source, /shouldReplaceRemoteCallStateUpdate/)
  assert.match(source, /reason == "answered_elsewhere"/)
  assert.match(source, /call_state_update_confirmed_pending_answer/)
  assert.match(source, /callKitEndReasonForAnswerFailure/)
  assert.match(source, /case "answered_elsewhere":\s*return \.answeredElsewhere/)
  assert.match(source, /CallOperationTiming/)
  assert.match(source, /processMonotonicMilliseconds/)
  assert.match(source, /pendingActionJournalAllowedKeys/)
  assert.match(source, /sanitizedPendingActionRecord\(basePayload\)/)
  const sanitizedErrorMessage = source.match(
    /private func sanitizedErrorMessage\([\s\S]*?(?=\n  private func elapsedMilliseconds)/,
  )?.[0]
  assert.match(sanitizedErrorMessage ?? '', /return fallback/)
  assert.doesNotMatch(
    sanitizedErrorMessage ?? '',
    /localizedDescription/,
    'native diagnostic logs must not retain raw NSError descriptions',
  )
  assert.doesNotMatch(source, /var record = basePayload/)
  assert.doesNotMatch(source, /tokenPrefix/)
  assert.doesNotMatch(source, /safeTokenPrefix/)
  assert.doesNotMatch(source, /NSLog\("VeloraSystemCalls %@", "\\\(payload\)"\)/)
  assert.doesNotMatch(
    source,
    /NSLog\([^\n]*\\\(error\)/,
    'native diagnostic logs must not interpolate opaque SDK or OS errors',
  )
  assert.match(androidStore, /KEY_PENDING_ACTIONS/)
  assert.match(androidStore, /KEY_COMPLETED_ACTIONS/)
  assert.match(androidStore, /createdMonotonicMs/)
  assert.match(androidStore, /processLaunchId/)
  assert.match(androidStore, /PENDING_ACTION_JOURNAL_ALLOWED_FIELDS/)
  assert.match(androidStore, /sanitizePendingActionRecord\(payload\)/)
  assert.match(androidStore, /superseded_by_terminal/)
  assert.match(androidStore, /completePendingAnswer/)
  assert.match(androidStore, /completePendingResume/)
  assert.match(androidStore, /ACCEPTED_ANSWER_RECOVERY_TTL_MS/)
  assert.match(androidStore, /minOf\(it, fallbackExpirationMs\)/)
  assert.match(androidStore, /KEY_REMOTE_CALL_STATE_UPDATES/)
  assert.match(androidStore, /storeRemoteCallStateUpdate/)
  assert.match(androidStore, /parseLifecycleRevision/)
  assert.match(androidStore, /shouldReplaceRemoteCallStateUpdate/)
  assert.match(androidModule, /Function\("completePendingAnswer"\)/)
  const androidNotifications = read(
    'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraCallNotifications.kt',
  )
  assert.match(androidNotifications, /completePendingAnswer\(\s*context,\s*pendingAnswerActionId/)
  assert.match(androidNotifications, /cancelPendingAnswerWatchdog\(context, callId\)/)
  assert.match(androidNotifications, /if \(isExplicitlyAnsweredElsewhere\) "ended" else status/)
})

test('cold-start bridge stays UI-free and scopes prewarm work to the authenticated account', () => {
  const rootLayout = read('app/_layout.tsx')
  const bridge = read('src/providers/IncomingCallPrewarmBridge.tsx')
  const socket = read('src/lib/call/callSocket.ts')
  const provider = read('src/providers/CallProvider.tsx')
  const callScreen = read('app/call/[id].tsx')
  const mediaRuntime = read('src/lib/call/useCallMediaTransportRuntime.ts')

  const rootBootstrap = rootLayout.slice(rootLayout.indexOf('export default function RootLayout'))
  assert.match(rootBootstrap, /getPendingCallAction\(\)/)
  assert.doesNotMatch(
    rootBootstrap,
    /useFonts\(/,
    'the bootstrap component must not start font work before rendering the bridge',
  )
  assert.ok(
    rootLayout.indexOf('<IncomingCallPrewarmBridge') < rootLayout.indexOf('<RootAppShell'),
    'the UI-free cold-path bridge must render before the font/Reels app shell',
  )
  assert.ok(
    rootLayout.indexOf('<AuthProvider>') < rootLayout.indexOf('<CallProvider>'),
    'full CallProvider must wait for the authenticated tree',
  )
  assert.match(rootLayout, /hasPendingNativeCallIntent/)
  assert.match(bridge, /hydrateAuth\(\{ silent: true \}\)/)
  assert.match(bridge, /action\.action !== 'answer' && action\.action !== 'resume'/)
  assert.match(bridge, /action\.accountId && action\.accountId !== auth\.user\.id/)
  assert.match(bridge, /prewarmCallSocketCredentials\(auth\.user\.id\)/)
  assert.doesNotMatch(bridge, /createCallSocket|postAnswerSetup|<View/)
  assert.match(socket, /prewarmedSocketTokenGeneration/)
  assert.match(socket, /clearPrewarmedCallSocketCredentials/)
  assert.match(provider, /clearPrewarmedCallSocketCredentials\(previousUserId\)/)

  assert.match(provider, /terminalLifecycleStateFor/)
  assert.match(provider, /const resumeAcceptedCall = useCallback/)
  assert.match(provider, /telemetry\.record\('server_accept_ack'/)
  assert.match(provider, /telemetry\.record\('callkit_fulfilled'/)
  assert.match(provider, /recordCallScreenVisible/)
  assert.match(callScreen, /recordCallScreenVisible\(id\)/)
  assert.match(mediaRuntime, /telemetrySessionRef\.current\?\.record\('remote_audio_ready'/)
})

test('remote call-state updates reach the native reducers before React mounts', () => {
  const iosSubscriber = read('modules/velora-system-calls/ios/VeloraSystemCallsModule.swift')
  const androidManifest = read('android/app/src/main/AndroidManifest.xml')
  const androidReceiver = read(
    'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraFirebaseMessagingReceiver.kt',
  )
  const androidPlugin = read('plugins/withVeloraSystemCalls.js')
  const appConfig = read('app.json')

  assert.match(iosSubscriber, /didReceiveRemoteNotification/)
  assert.match(iosSubscriber, /handleRemoteNotification\(userInfo\)/)
  assert.match(appConfig, /"remote-notification"/)

  // Android's native broadcast receiver is deliberately used instead of a
  // FirebaseMessagingService, so state updates are handled before any JS
  // runtime or headless task starts.
  assert.match(androidManifest, /VeloraFirebaseMessagingReceiver/)
  assert.match(androidManifest, /com\.google\.android\.c2dm\.intent\.RECEIVE/)
  assert.match(androidReceiver, /"CALL_STATE_UPDATE"\s*->\s*VeloraCallNotifications\.handleCallStateUpdate/)
  assert.match(androidPlugin, /VeloraFirebaseMessagingReceiver/)
  assert.match(androidPlugin, /com\.google\.android\.c2dm\.intent\.RECEIVE/)
})
