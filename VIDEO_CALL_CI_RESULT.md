# Video Call CI Result

- Guarded patch failed before verification.

```text
Video-call provider patch applied successfully
Video-call native/contract patch applied successfully
Generated video-call integration hardened successfully
Normalized optional producer paused state for exactOptionalPropertyTypes
Finalized 1:1 video call native validation, speaker routing and provider cleanup
Moved default VIDEO speaker helper to stable top-level scope
Finalized native type sync, camera privacy, flip compatibility and provider cleanup
/home/runner/work/Velora-Mobile/Velora-Mobile/scripts/fix-ios-simulator-call-lifecycle.cjs:155
  test += `\n\ntest('iOS Simulator uses in-app ringing and cannot terminate server calls through CallKit', () => {\n  const systemCalls = fs.readFileSync('src/lib/systemCalls/veloraSystemCalls.ts', 'utf8')\n  const provider = fs.readFileSync('src/providers/CallProvider.tsx', 'utf8')\n  const callScreen = fs.readFileSync('app/call/[id].tsx', 'utf8')\n  const swift = fs.readFileSync('modules/velora-system-calls/ios/VeloraSystemCallsModule.swift', 'utf8')\n\n  assert.match(systemCalls, /Platform\\.OS === 'ios' && !Device\\.isDevice/)\n  assert.match(systemCalls, /if \\(isIosSimulator\\) return simulatorCallResult\\(payload\\.callId\\)/)\n  assert.match(systemCalls, /if \\(isIosSimulator \\|\\| !nativeModule\\?\\.addListener\\)/)\n  assert.match(provider, /veloraSystemCalls\\.isIosSimulator[\\s\\S]*router\\.push\\(`\\/call\\/\\$\\{payload\\.callId\\}`/)\n  assert.ok((provider.match(/activateSimulatorAudioSession\\(callId\\)/g) ?? []).length >= 2)\n  assert.match(callScreen, /phase === 'incoming_ringing'/)\n  assert.match(callScreen, /acceptIncomingCall\\('ui'\\)/)\n  assert.match(callScreen, /rejectIncomingCall\\(\\)/)\n  assert.match(swift, /#if targetEnvironment\\(simulator\\)[\\s\\S]*simulator_audio_session_activated/)\n  assert.match(swift, /deactivateSimulatorAudioSession/)\n})\n`
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       ^

SyntaxError: Invalid or unexpected token
    at wrapSafe (node:internal/modules/cjs/loader:1464:18)
    at Module._compile (node:internal/modules/cjs/loader:1495:20)
    at Module._extensions..js (node:internal/modules/cjs/loader:1623:10)
    at Module.load (node:internal/modules/cjs/loader:1266:32)
    at Module._load (node:internal/modules/cjs/loader:1091:12)
    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:164:12)
    at node:internal/main/run_main_module:28:49

Node.js v20.20.2
```
