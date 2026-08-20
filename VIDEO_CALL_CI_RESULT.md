# Video Call CI Result

- Typecheck exit: 2
- Tests exit: 0
- Feature lint exit: 0
- Full repo lint exit: 1

## Typecheck
```text

> tmp_expo@1.0.0 type-check /home/runner/work/Velora-Mobile/Velora-Mobile
> tsc --noEmit

app/conversation/[id]/info.tsx(650,38): error TS2339: Property 'email' does not exist on type 'PublicFriendProfile'.
 ELIFECYCLE  Command failed with exit code 2.
```

## Tests
```text
  ...
# Subtest: paginated conversation list is not treated as an authoritative deletion snapshot
ok 34 - paginated conversation list is not treated as an authoritative deletion snapshot
  ---
  duration_ms: 1.708531
  ...
# Subtest: socket reconnect rejoins locally stored conversations so missed revocations are reconciled by server auth
ok 35 - socket reconnect rejoins locally stored conversations so missed revocations are reconciled by server auth
  ---
  duration_ms: 0.244338
  ...
# Subtest: revocation tombstones are session-only and clear scoped optimistic state
ok 36 - revocation tombstones are session-only and clear scoped optimistic state
  ---
  duration_ms: 0.22646
  ...
# Subtest: active chat and group info blank and exit immediately after revocation
ok 37 - active chat and group info blank and exit immediately after revocation
  ---
  duration_ms: 0.23307
  ...
# Subtest: explicit leave clears local, query, and offline state even if socket removal event is missed
ok 38 - explicit leave clears local, query, and offline state even if socket removal event is missed
  ---
  duration_ms: 0.213612
  ...
# Subtest: message merges preserve structured group activity and AI citation metadata
ok 39 - message merges preserve structured group activity and AI citation metadata
  ---
  duration_ms: 0.255915
  ...
# Subtest: legacy group activity records keep their system kind even when the structured payload was lost
ok 40 - legacy group activity records keep their system kind even when the structured payload was lost
  ---
  duration_ms: 0.360653
  ...
# Subtest: group system rows stay centered even when an older local record lost activity payload
ok 41 - group system rows stay centered even when an older local record lost activity payload
  ---
  duration_ms: 0.245289
  ...
# Subtest: group photo picker is single-flight and launches the library without a permission round-trip
ok 42 - group photo picker is single-flight and launches the library without a permission round-trip
  ---
  duration_ms: 0.621035
  ...
# Subtest: Messages exposes a dedicated new-group route without changing friendship state
ok 43 - Messages exposes a dedicated new-group route without changing friendship state
  ---
  duration_ms: 2.08003
  ...
# Subtest: group header resolves real typers and opens group info while calls stay direct-only
ok 44 - group header resolves real typers and opens group info while calls stay direct-only
  ---
  duration_ms: 0.341063
  ...
# Subtest: group receipt avatars follow each participant newest activity or read frontier
ok 45 - group receipt avatars follow each participant newest activity or read frontier
  ---
  duration_ms: 0.578701
  ...
# Subtest: group info derives V2 permissions from projected roles and keeps owner-only controls separate
ok 46 - group info derives V2 permissions from projected roles and keeps owner-only controls separate
  ---
  duration_ms: 1.261048
  ...
# Subtest: group info keeps member rows compact and uses a real bottom sheet for management actions
ok 47 - group info keeps member rows compact and uses a real bottom sheet for management actions
  ---
  duration_ms: 0.460042
  ...
# Subtest: group member actions wait for sheet dismissal before presenting confirmation UI
ok 48 - group member actions wait for sheet dismissal before presenting confirmation UI
  ---
  duration_ms: 0.216226
  ...
# Subtest: group info presents add-member and leave actions as dedicated rows instead of toolbar clutter
ok 49 - group info presents add-member and leave actions as dedicated rows instead of toolbar clutter
  ---
  duration_ms: 0.262855
  ...
# Subtest: group member roster falls back to conversation participants when v2 projection is unavailable
ok 50 - group member roster falls back to conversation participants when v2 projection is unavailable
  ---
  duration_ms: 0.270426
  ...
# Subtest: group ownership transfer uses the dedicated owner endpoint
ok 51 - group ownership transfer uses the dedicated owner endpoint
  ---
  duration_ms: 0.404308
  ...
# Subtest: authenticated session hydration resumes push-token registration before exposing auth state
ok 52 - authenticated session hydration resumes push-token registration before exposing auth state
  ---
  duration_ms: 1.375059
  ...
# Subtest: FCM provider rotates a token rejected as terminal-invalid
ok 53 - FCM provider rotates a token rejected as terminal-invalid
  ---
  duration_ms: 1.377593
  ...
# Subtest: FCM provider reboots registration whenever an authenticated app returns active
ok 54 - FCM provider reboots registration whenever an authenticated app returns active
  ---
  duration_ms: 0.209646
  ...
# Subtest: creator classifies portrait, landscape and square sources without forcing 9:16 crop
ok 55 - creator classifies portrait, landscape and square sources without forcing 9:16 crop
  ---
  duration_ms: 1.963264
  ...
# Subtest: editor and publish previews preserve the full non-portrait frame
ok 56 - editor and publish previews preserve the full non-portrait frame
  ---
  duration_ms: 0.286692
  ...
# Subtest: shared reel video playback detects non-portrait posters and switches to contain
ok 57 - shared reel video playback detects non-portrait posters and switches to contain
  ---
  duration_ms: 0.203096
  ...
# Subtest: call socket contract supports audio and video plus type switching
ok 58 - call socket contract supports audio and video plus type switching
  ---
  duration_ms: 2.235835
  ...
# Subtest: CallProvider starts video with preview and keeps same call session for type switching
ok 59 - CallProvider starts video with preview and keeps same call session for type switching
  ---
  duration_ms: 1.276181
  ...
# Subtest: native VIDEO answer survives background recovery without silently downgrading
ok 60 - native VIDEO answer survives background recovery without silently downgrading
  ---
  duration_ms: 1.421799
  ...
# Subtest: active call screen renders RTC video and both conversion directions
ok 61 - active call screen renders RTC video and both conversion directions
  ---
  duration_ms: 0.335645
  ...
# Subtest: conversation video entry point remains direct-chat only
ok 62 - conversation video entry point remains direct-chat only
  ---
  duration_ms: 0.782458
  ...
# Subtest: native call surfaces preserve callType
ok 63 - native call surfaces preserve callType
  ---
  duration_ms: 0.798211
  ...
1..63
# tests 63
# suites 0
# pass 60
# fail 0
# cancelled 0
# skipped 0
# todo 3
# duration_ms 1555.694224
```

## Feature lint
```text

/home/runner/work/Velora-Mobile/Velora-Mobile/src/providers/CallProvider.tsx
  3846:29  warning  The ref value 'callSocketPromisesRef.current' will likely have changed by the time this effect cleanup function runs. If this ref points to a node rendered by React, copy 'callSocketPromisesRef.current' to a variable inside the effect, and use that variable in the cleanup function  react-hooks/exhaustive-deps

/home/runner/work/Velora-Mobile/Velora-Mobile/tests/video-call-1to1-contract.test.cjs
  0:0  warning  File ignored because of a matching ignore pattern. Use "--no-ignore" to override

✖ 2 problems (0 errors, 2 warnings)

```

## Full repo lint
```text

> tmp_expo@1.0.0 lint /home/runner/work/Velora-Mobile/Velora-Mobile
> eslint .


/home/runner/work/Velora-Mobile/Velora-Mobile/app/conversation/[id]/info.tsx
  637:31  error  Replace `·source={{·uri:·item.user.picture·}}·className="h-10·w-10·rounded-full"` with `⏎··························source={{·uri:·item.user.picture·}}⏎··························className="h-10·w-10·rounded-full"⏎·······················`  prettier/prettier
  813:33  error  Replace `⏎····················closeMemberActionsAndRun(selectedMember,·confirmTransferOwnership)⏎··················` with `·closeMemberActionsAndRun(selectedMember,·confirmTransferOwnership)`                                               prettier/prettier
  835:72  error  Replace `⏎····················Remove·from·group⏎··················` with `Remove·from·group`                                                                                                                                                  prettier/prettier

/home/runner/work/Velora-Mobile/Velora-Mobile/plugins/withPodfileCodeSign.js
  44:9  warning  Unexpected console statement  no-console

/home/runner/work/Velora-Mobile/Velora-Mobile/src/api/conversation.api.ts
   54:47  error  Replace `⏎··conversation:·Conversation,⏎` with `conversation:·Conversation`                                                                                                                                                  prettier/prettier
  244:20  error  Replace `'[ConversationApi]·Group·V2·member·projection·unavailable;·using·roster·fallback',·error` with `⏎········'[ConversationApi]·Group·V2·member·projection·unavailable;·using·roster·fallback',⏎········error,⏎······`  prettier/prettier

/home/runner/work/Velora-Mobile/Velora-Mobile/src/components/chat/MessageBubble.tsx
  21:31  error  Replace `·typeof·participant.email·===·'string'·&&` with `⏎······typeof·participant.email·===·'string'·&&⏎·····`  prettier/prettier
  30:16  error  Insert `⏎···`                                                                                                     prettier/prettier

/home/runner/work/Velora-Mobile/Velora-Mobile/src/hooks/useMessages.ts
  323:3  warning  'latestSyncRange' is defined but never used. Allowed unused args must match /^_/u  unused-imports/no-unused-vars

/home/runner/work/Velora-Mobile/Velora-Mobile/src/lib/messageIdentity.ts
  309:2  error  Insert `⏎`  prettier/prettier

/home/runner/work/Velora-Mobile/Velora-Mobile/src/providers/CallProvider.tsx
  3846:29  warning  The ref value 'callSocketPromisesRef.current' will likely have changed by the time this effect cleanup function runs. If this ref points to a node rendered by React, copy 'callSocketPromisesRef.current' to a variable inside the effect, and use that variable in the cleanup function  react-hooks/exhaustive-deps

✖ 11 problems (8 errors, 3 warnings)
  8 errors and 0 warnings potentially fixable with the `--fix` option.

 ELIFECYCLE  Command failed with exit code 1.
```
