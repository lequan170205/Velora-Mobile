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
/home/runner/work/Velora-Mobile/Velora-Mobile/scripts/fix-ios-simulator-call-lifecycle-v2.cjs:67
  throw new Error('Simulator audio activation was not added to both call setup paths')
  ^

Error: Simulator audio activation was not added to both call setup paths
    at Object.<anonymous> (/home/runner/work/Velora-Mobile/Velora-Mobile/scripts/fix-ios-simulator-call-lifecycle-v2.cjs:67:9)
    at Module._compile (node:internal/modules/cjs/loader:1521:14)
    at Module._extensions..js (node:internal/modules/cjs/loader:1623:10)
    at Module.load (node:internal/modules/cjs/loader:1266:32)
    at Module._load (node:internal/modules/cjs/loader:1091:12)
    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:164:12)
    at node:internal/main/run_main_module:28:49

Node.js v20.20.2
```
