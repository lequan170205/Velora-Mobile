---
name: native-call-lifecycle
description: Maintain Velora Mobile one-to-one call lifecycle correctness across CallProvider, sockets, Mediasoup/WebRTC, native call surfaces, account changes, recovery, and telemetry.
---

# Native Call Lifecycle

Use this skill for `CallProvider`, call sockets, WebRTC/Mediasoup setup, incoming-call native actions, CallKit/Android call surfaces, call recovery, or call telemetry.

## Preserve these invariants

- Scope asynchronous setup by call ID, authenticated account, and setup generation. Delayed work from an ended call or previous account must fail closed.
- Lifecycle state only moves forward. Terminal outcomes win over delayed setup, reconnect, accept, or media callbacks.
- Keep teardown single-flight and preserve its cleanup ordering. Teardown must cancel pending event waits, native audio waits, timers, reconnect work, and incomplete media setup owned by that call.
- Incoming answer claims the server-side action before native audio/media setup. An uncertain accept acknowledgement must abort rather than leave a ghost call.
- Native actions are authenticated, journaled/deduplicated, and scoped to the account that received them. Account switching invalidates old credentials and in-flight call work.
- Make audio usable before progressive video enrichment after answer. Optional video failure must not destroy an otherwise valid audio call unless the contract marks that failure fatal.
- Reconnect should preserve unaffected media where possible; local transport recovery and peer recovery have different cleanup responsibilities.
- Camera/type changes publish only into their originating active call. A peer video upgrade must not turn on the local camera automatically.
- Keep native call type and native surface state synchronized with active VOICE/VIDEO transitions and terminal states.
- Telemetry failures must not block call lifecycle progress or later telemetry events.

## Verify changes

Run the focused call suites that match the edit:

- `tests/call-provider-characterization.test.cjs`
- `tests/call-lifecycle-contract.test.cjs`
- `tests/video-call-1to1-contract.test.cjs`
- `tests/call-telemetry-contract.test.cjs`

Trace affected behavior through `src/providers/CallProvider.tsx`, `src/lib/call/`, `src/lib/systemCalls/`, `src/stores/callStore.ts`, and `modules/velora-system-calls/`.
