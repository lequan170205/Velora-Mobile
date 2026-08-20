# Video Call CI Result

- Guarded patch failed before verification.

```text
Video-call provider patch applied successfully
Video-call native/contract patch applied successfully
Generated video-call integration hardened successfully
Normalized optional producer paused state for exactOptionalPropertyTypes
/home/runner/work/Velora-Mobile/Velora-Mobile/scripts/finalize-video-call-1to1.cjs:5
  if (!source.includes(before)) throw new Error(`Finalizer anchor not found: ${label}`)
                                ^

Error: Finalizer anchor not found: Android incoming VOICE/VIDEO validation
    at replaceRequired (/home/runner/work/Velora-Mobile/Velora-Mobile/scripts/finalize-video-call-1to1.cjs:5:39)
    at Object.<anonymous> (/home/runner/work/Velora-Mobile/Velora-Mobile/scripts/finalize-video-call-1to1.cjs:12:16)
    at Module._compile (node:internal/modules/cjs/loader:1521:14)
    at Module._extensions..js (node:internal/modules/cjs/loader:1623:10)
    at Module.load (node:internal/modules/cjs/loader:1266:32)
    at Module._load (node:internal/modules/cjs/loader:1091:12)
    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:164:12)
    at node:internal/main/run_main_module:28:49

Node.js v20.20.2
```
