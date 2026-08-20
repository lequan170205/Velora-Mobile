# Video Call CI Result

- Typecheck exit: 2
- Tests exit: 0
- Feature lint exit: 0

## Typecheck
```text

> tmp_expo@1.0.0 type-check /home/runner/work/Velora-Mobile/Velora-Mobile
> tsc --noEmit

app/call/[id].tsx(243,56): error TS2554: Expected 0 arguments, but got 1.
app/conversation/[id]/info.tsx(650,38): error TS2339: Property 'email' does not exist on type 'PublicFriendProfile'.
 ELIFECYCLE  Command failed with exit code 2.
```

## Tests
```text
  ...
# Subtest: latest older keeps cached history usable while offline
ok 23 - latest older keeps cached history usable while offline
  ---
  duration_ms: 123.945855
  ...
# Subtest: latest older does not fail the visible local page when its background remote backfill fails
ok 24 - latest older does not fail the visible local page when its background remote backfill fails
  ---
  duration_ms: 68.32287
  ...
# Subtest: latest: a transient fetchNextPage failure must allow retrying the same cursor
ok 25 - latest: a transient fetchNextPage failure must allow retrying the same cursor # TODO
  ---
  duration_ms: 0.297096
  ...
# Subtest: latest: a transient fetchNextPage failure allows retrying the same cursor
ok 26 - latest: a transient fetchNextPage failure allows retrying the same cursor
  ---
  duration_ms: 259.747747
  ...
# Subtest: latest pagination ignores a stale exhausted boundary while cached older history still exists
ok 27 - latest pagination ignores a stale exhausted boundary while cached older history still exists
  ---
  duration_ms: 218.623648
  ...
# Subtest: stale exhausted metadata cannot block remote older history when local cache is empty
ok 28 - stale exhausted metadata cannot block remote older history when local cache is empty
  ---
  duration_ms: 208.195498
  ...
# Subtest: unknown socket messages resolve canonical conversation metadata instead of fabricating membership
ok 29 - unknown socket messages resolve canonical conversation metadata instead of fabricating membership
  ---
  duration_ms: 1.986086
  ...
# Subtest: group lifecycle events persist, join, and revoke conversation state
ok 30 - group lifecycle events persist, join, and revoke conversation state
  ---
  duration_ms: 0.559993
  ...
# Subtest: local persistence deletes revoked history without treating a paginated list as a deletion snapshot
ok 31 - local persistence deletes revoked history without treating a paginated list as a deletion snapshot
  ---
  duration_ms: 0.256826
  ...
# Subtest: conversation scoped Zustand state is fully cleared on membership revocation
ok 32 - conversation scoped Zustand state is fully cleared on membership revocation
  ---
  duration_ms: 0.278268
  ...
# Subtest: mobile API and types expose the backend group contract without a schema migration
ok 33 - mobile API and types expose the backend group contract without a schema migration
  ---
  duration_ms: 0.241864
  ...
# Subtest: paginated conversation list is not treated as an authoritative deletion snapshot
ok 34 - paginated conversation list is not treated as an authoritative deletion snapshot
  ---
  duration_ms: 1.749881
  ...
# Subtest: socket reconnect rejoins locally stored conversations so missed revocations are reconciled by server auth
ok 35 - socket reconnect rejoins locally stored conversations so missed revocations are reconciled by server auth
  ---
  duration_ms: 0.248744
  ...
# Subtest: revocation tombstones are session-only and clear scoped optimistic state
ok 36 - revocation tombstones are session-only and clear scoped optimistic state
  ---
  duration_ms: 0.229014
  ...
# Subtest: active chat and group info blank and exit immediately after revocation
ok 37 - active chat and group info blank and exit immediately after revocation
  ---
  duration_ms: 0.269375
  ...
# Subtest: explicit leave clears local, query, and offline state even if socket removal event is missed
ok 38 - explicit leave clears local, query, and offline state even if socket removal event is missed
  ---
  duration_ms: 0.232219
  ...
# Subtest: message merges preserve structured group activity and AI citation metadata
ok 39 - message merges preserve structured group activity and AI citation metadata
  ---
  duration_ms: 0.21312
  ...
# Subtest: legacy group activity records keep their system kind even when the structured payload was lost
ok 40 - legacy group activity records keep their system kind even when the structured payload was lost
  ---
  duration_ms: 0.387853
  ...
# Subtest: group system rows stay centered even when an older local record lost activity payload
ok 41 - group system rows stay centered even when an older local record lost activity payload
  ---
  duration_ms: 0.250747
  ...
# Subtest: group photo picker is single-flight and launches the library without a permission round-trip
ok 42 - group photo picker is single-flight and launches the library without a permission round-trip
  ---
  duration_ms: 0.602045
  ...
# Subtest: Messages exposes a dedicated new-group route without changing friendship state
ok 43 - Messages exposes a dedicated new-group route without changing friendship state
  ---
  duration_ms: 1.493396
  ...
# Subtest: group header resolves real typers and opens group info while calls stay direct-only
ok 44 - group header resolves real typers and opens group info while calls stay direct-only
  ---
  duration_ms: 0.275714
  ...
# Subtest: group receipt avatars follow each participant newest activity or read frontier
ok 45 - group receipt avatars follow each participant newest activity or read frontier
  ---
  duration_ms: 0.434674
  ...
# Subtest: group info derives V2 permissions from projected roles and keeps owner-only controls separate
ok 46 - group info derives V2 permissions from projected roles and keeps owner-only controls separate
  ---
  duration_ms: 1.07068
  ...
# Subtest: group info keeps member rows compact and uses a real bottom sheet for management actions
ok 47 - group info keeps member rows compact and uses a real bottom sheet for management actions
  ---
  duration_ms: 0.335384
  ...
# Subtest: group member actions wait for sheet dismissal before presenting confirmation UI
ok 48 - group member actions wait for sheet dismissal before presenting confirmation UI
  ---
  duration_ms: 0.145628
  ...
# Subtest: group info presents add-member and leave actions as dedicated rows instead of toolbar clutter
ok 49 - group info presents add-member and leave actions as dedicated rows instead of toolbar clutter
  ---
  duration_ms: 0.188384
  ...
# Subtest: group member roster falls back to conversation participants when v2 projection is unavailable
ok 50 - group member roster falls back to conversation participants when v2 projection is unavailable
  ---
  duration_ms: 0.132009
  ...
# Subtest: group ownership transfer uses the dedicated owner endpoint
ok 51 - group ownership transfer uses the dedicated owner endpoint
  ---
  duration_ms: 0.250847
  ...
# Subtest: authenticated session hydration resumes push-token registration before exposing auth state
ok 52 - authenticated session hydration resumes push-token registration before exposing auth state
  ---
  duration_ms: 1.898885
  ...
# Subtest: FCM provider rotates a token rejected as terminal-invalid
ok 53 - FCM provider rotates a token rejected as terminal-invalid
  ---
  duration_ms: 1.771965
  ...
# Subtest: FCM provider reboots registration whenever an authenticated app returns active
ok 54 - FCM provider reboots registration whenever an authenticated app returns active
  ---
  duration_ms: 0.231999
  ...
# Subtest: creator classifies portrait, landscape and square sources without forcing 9:16 crop
ok 55 - creator classifies portrait, landscape and square sources without forcing 9:16 crop
  ---
  duration_ms: 1.759956
  ...
# Subtest: editor and publish previews preserve the full non-portrait frame
ok 56 - editor and publish previews preserve the full non-portrait frame
  ---
  duration_ms: 0.234323
  ...
# Subtest: shared reel video playback detects non-portrait posters and switches to contain
ok 57 - shared reel video playback detects non-portrait posters and switches to contain
  ---
  duration_ms: 0.221383
  ...
# Subtest: call socket contract supports audio/video, type switching and camera state
ok 58 - call socket contract supports audio/video, type switching and camera state
  ---
  duration_ms: 1.89559
  ...
# Subtest: CallProvider starts video with preview and keeps same call session for type switching
ok 59 - CallProvider starts video with preview and keeps same call session for type switching
  ---
  duration_ms: 1.160054
  ...
# Subtest: camera off/on is signaled without replacing the video producer
ok 60 - camera off/on is signaled without replacing the video producer
  ---
  duration_ms: 0.754985
  ...
# Subtest: native VIDEO answer survives background recovery without silently downgrading
ok 61 - native VIDEO answer survives background recovery without silently downgrading
  ---
  duration_ms: 1.175828
  ...
# Subtest: active call screen renders RTC video and both conversion directions
ok 62 - active call screen renders RTC video and both conversion directions
  ---
  duration_ms: 0.261073
  ...
# Subtest: conversation video entry point remains direct-chat only
ok 63 - conversation video entry point remains direct-chat only
  ---
  duration_ms: 0.49898
  ...
# Subtest: native call surfaces preserve and validate VIDEO callType
ok 64 - native call surfaces preserve and validate VIDEO callType
  ---
  duration_ms: 2.23466
  ...
# Subtest: native incoming VIDEO is accepted on both platforms
ok 65 - native incoming VIDEO is accepted on both platforms
  ---
  duration_ms: 0.561124
  ...
# Subtest: VIDEO defaults to speaker without overriding external audio routes
ok 66 - VIDEO defaults to speaker without overriding external audio routes
  ---
  duration_ms: 0.974856
  ...
# Subtest: background VIDEO camera deferral is applied exactly once
ok 67 - background VIDEO camera deferral is applied exactly once
  ---
  duration_ms: 1.065421
  ...
# Subtest: native call type follows active VOICE and VIDEO transitions
ok 68 - native call type follows active VOICE and VIDEO transitions
  ---
  duration_ms: 1.156119
  ...
# Subtest: video producer cleanup is not duplicated in CallProvider
ok 69 - video producer cleanup is not duplicated in CallProvider
  ---
  duration_ms: 0.511889
  ...
# Subtest: peer video upgrade never turns on the local camera automatically
ok 70 - peer video upgrade never turns on the local camera automatically
  ---
  duration_ms: 1.422539
  ...
# Subtest: camera flip prefers constraints with a legacy WebRTC fallback
ok 71 - camera flip prefers constraints with a legacy WebRTC fallback
  ---
  duration_ms: 0.593783
  ...
# Subtest: iOS Simulator uses in-app ringing and isolates CallKit lifecycle
ok 72 - iOS Simulator uses in-app ringing and isolates CallKit lifecycle
  ---
  duration_ms: 0.81854
  ...
1..72
# tests 72
# suites 0
# pass 69
# fail 0
# cancelled 0
# skipped 0
# todo 3
# duration_ms 1595.229778
```

## Feature lint
```text

/home/runner/work/Velora-Mobile/Velora-Mobile/app/call/[id].tsx
  113:6  warning  React Hook useMemo has a missing dependency: 'callType'. Either include it or remove the dependency array  react-hooks/exhaustive-deps

/home/runner/work/Velora-Mobile/Velora-Mobile/src/providers/CallProvider.tsx
   309:7   warning  'enableDefaultVideoSpeaker' is assigned a value but never used. Allowed unused vars must match /^_/u                                                                                                                                                                                       unused-imports/no-unused-vars
  2786:5   warning  React Hook useCallback has a missing dependency: 'router'. Either include it or remove the dependency array                                                                                                                                                                                react-hooks/exhaustive-deps
  3041:5   warning  React Hook useCallback has a missing dependency: 'enableDefaultVideoSpeaker'. Either include it or remove the dependency array                                                                                                                                                             react-hooks/exhaustive-deps
  3215:5   warning  React Hook useCallback has a missing dependency: 'enableDefaultVideoSpeaker'. Either include it or remove the dependency array                                                                                                                                                             react-hooks/exhaustive-deps
  3508:5   warning  React Hook useCallback has a missing dependency: 'enableDefaultVideoSpeaker'. Either include it or remove the dependency array                                                                                                                                                             react-hooks/exhaustive-deps
  3961:29  warning  The ref value 'callSocketPromisesRef.current' will likely have changed by the time this effect cleanup function runs. If this ref points to a node rendered by React, copy 'callSocketPromisesRef.current' to a variable inside the effect, and use that variable in the cleanup function  react-hooks/exhaustive-deps

/home/runner/work/Velora-Mobile/Velora-Mobile/tests/video-call-1to1-contract.test.cjs
  0:0  warning  File ignored because of a matching ignore pattern. Use "--no-ignore" to override

✖ 8 problems (0 errors, 8 warnings)

```
