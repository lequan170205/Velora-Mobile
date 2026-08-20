# Video Call CI Result

- Guarded patch failed before verification.

```text
Video-call provider patch applied successfully
Video-call native/contract patch applied successfully
Generated video-call integration hardened successfully
Normalized optional producer paused state for exactOptionalPropertyTypes
Finalized 1:1 video call native validation, speaker routing and provider cleanup
Moved default VIDEO speaker helper to stable top-level scope
/home/runner/work/Velora-Mobile/Velora-Mobile/scripts/finalize-native-call-type-sync.cjs:166
  tests += `\n\ntest('native call type follows active VOICE and VIDEO transitions', () => {\n  const wrapper = read('src/lib/systemCalls/veloraSystemCalls.ts')\n  const provider = read('src/providers/CallProvider.tsx')\n  const androidModule = read(\n    'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraSystemCallsModule.kt',\n  )\n  const androidStore = read(\n    'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraSystemCallStore.kt',\n  )\n  const foreground = read(\n    'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/VeloraCallForegroundService.kt',\n  )\n  const swift = read('modules/velora-system-calls/ios/VeloraSystemCallsModule.swift')\n\n  assert.match(wrapper, /setCallType: \\(callId: string, callType: CallType\\) => boolean/)\n  assert.match(provider, /veloraSystemCalls\\.setCallType\\(payload\\.callId, payload\\.callType\\)/)\n  assert.match(androidModule, /Function\\(\\"setCallType\\"\\)/)\n  assert.match(androidStore, /val callType: String\\?/)\n  assert.match(foreground, /\\"callType\\" to currentCall/)\n  assert.match(swift, /func setCallType\\(callId: String, callType: String\\) -> Bool/)\n  assert.match(swift, /provider\\.reportCall\\([\\s\\S]*updated: callUpdate/)\n})\n\ntest('video producer cleanup is not duplicated in CallProvider', () => {\n  const source = read('src/providers/CallProvider.tsx')\n  const marker = 'remoteVideoEnabledByProducerRef.current.delete(payload.producerId)'\n  const matches = source.match(new RegExp(marker.replace(/[.*+?^\\${}()|[\\]\\\\]/g, '\\\\$&'), 'g')) ?? []\n  assert.equal(matches.length, 1)\n})\n`
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            

SyntaxError: Unexpected token '}'
    at wrapSafe (node:internal/modules/cjs/loader:1464:18)
    at Module._compile (node:internal/modules/cjs/loader:1495:20)
    at Module._extensions..js (node:internal/modules/cjs/loader:1623:10)
    at Module.load (node:internal/modules/cjs/loader:1266:32)
    at Module._load (node:internal/modules/cjs/loader:1091:12)
    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:164:12)
    at node:internal/main/run_main_module:28:49

Node.js v20.20.2
```
