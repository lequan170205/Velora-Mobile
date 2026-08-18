# Chat Timeline Hardening

Scope: conversation/chat timeline only. This work intentionally does not touch friends, content, reels, auth, user, search, call, or notification behavior.

## Goal

Stabilize message pagination and viewport behavior without rewriting the chat architecture in one step. The required order is:

A. characterize the existing state machine;
B. lock critical behavior with regression contracts;
C. add diagnostics around fetch/scroll ownership;
D. fix isolated correctness bugs first;
E. harden pagination and viewport preservation incrementally.

## Phase A — Current state machine

### Latest timeline

The latest timeline is owned by `useMessages()` and rendered by `app/conversation/[id].tsx`.

Data path:

1. `useMessages(conversationId)` creates an infinite query.
2. A page request first asks WatermelonDB through `getLocalMessagesPage()`.
3. If local data exists, the page returns immediately.
4. When online and the request has a cursor, a remote sync is started in the background.
5. Remote results are persisted into WatermelonDB.
6. `refreshMessagesPageFromLocalStore()` can replace the corresponding React Query page.
7. ChatScreen flattens all pages, deduplicates, sorts canonical newest-first, merges optimistic messages, and passes the result to an inverted FlashList.
8. The visual top of the chat maps to the end of the newest-first array; `onEndReached` therefore means "load older".

Latest timeline fetch ownership is currently split across React Query, WatermelonDB, a background remote sync, and ChatScreen's `onEndReached` trigger.

### Anchor timeline

The anchor timeline is owned by `useAnchoredMessages()` and activated when a reply target is not already present in the latest timeline.

Data path:

1. ChatScreen resolves a reply target.
2. Local WatermelonDB is queried for a window around the target.
3. `timelineMode` switches from `latest` to `anchor`.
4. The anchor window is rendered and ChatScreen scrolls to the target.
5. Older expansion is driven by `loadAnchorOlder()`.
6. Newer expansion toward the latest edge is driven by `loadAnchorNewer()`.
7. Returning to the latest timeline clears the anchor state and schedules a bottom scroll.

Anchor fetch ownership is split across local cursor expansion, optional remote expansion, AbortControllers, per-cursor failure guards, and query-cache state flags.

### Scroll ownership

Scroll commands currently originate from several independent flows:

- initial/latest auto-scroll;
- own text send;
- own media batch send/confirmation;
- incoming message while near bottom;
- reply jump;
- anchor resolution;
- return from anchor to latest;
- explicit scroll-to-bottom button.

This means a correctness fix must not introduce a second competing scroll owner for the same transition.

## Timeline invariants

These invariants must remain true throughout the hardening work.

1. A persisted message must appear at most once in the rendered timeline.
2. Loading older messages must never skip a server message between two successfully loaded cursors.
3. A transient request failure must not permanently disable pagination for a still-valid cursor.
4. At most one authoritative older-page transaction may own a given cursor at a time.
5. A background remote backfill must not silently move the pagination frontier past messages that were not merged into the rendered/cache timeline.
6. Loading older messages must preserve the user's visible reading position.
7. New incoming messages must not force the user to the bottom while they are reading history.
8. Sending the user's own message may return to the latest timeline and scroll to bottom exactly once.
9. Reply jump must either resolve the requested persisted message or fail without leaving the timeline in a permanently blocked anchor state.
10. Returning from anchor to latest must leave no stale anchor fetch/scroll transaction able to mutate the latest viewport.
11. Local-first rendering is allowed, but local and remote work for one cursor must be treated as one logical pagination transaction.
12. Pagination guards must represent in-flight ownership or bounded retry/backoff, never a permanent failure latch.

## Confirmed risks before production changes

### R1 — Latest older-page cursor can become permanently blocked

`useMessages()` records a failed older cursor and returns early for the same cursor on subsequent `fetchNextPage()` calls. The guard is only reset when the cursor changes or connectivity transitions back online. A one-off timeout can therefore make "load older" appear dead until some unrelated state changes.

### R2 — Anchor older-page cursor can become permanently blocked

`useAnchoredMessages()` stores failed cursor guard keys in a Set and skips subsequent remote expansion for that same anchor/cursor. This duplicates the same failure-latch pattern in a second pagination implementation.

### R3 — Anchor local-first path releases `isFetchingOlder` before remote backfill finishes

When local older messages exist, anchor state can set `isFetchingOlder` back to false while a remote request for the same cursor continues in the background. A second older-load can start and abort the previous request. If the local cache is not fully contiguous, the visible cursor can advance before the remote gap has been reconciled.

### R4 — Latest local-first page can be replaced after it is already rendered

A cursor page may render from WatermelonDB, then a background remote sync persists additional messages and `refreshMessagesPageFromLocalStore()` replaces that React Query page. The flattened/sorted FlashList data can therefore change above the user's current viewport after the older-load interaction appeared complete.

### R5 — Scroll ownership is distributed

ChatScreen uses refs for own-send scrolling, media batch scrolling, anchor target scrolling, return-to-latest scrolling, near-bottom tracking and reply-jump settlement. Any pagination refactor that also adds new scroll commands risks double-scroll or viewport jumps.

## Phase B — Regression scenarios

The branch must protect at least the following scenarios before invasive production changes:

1. Latest: three older pages load in sequence without duplicate identities.
2. Latest: an older request fails once and the same cursor can be retried.
3. Latest: local page renders, remote backfill arrives later, and no message in the remote range is skipped.
4. Latest: user is reading history and an incoming message does not move them to bottom.
5. Latest: own send scrolls to bottom once.
6. Anchor: reply jump resolves a message outside the latest pages.
7. Anchor: older expansion fails once and can retry the same cursor.
8. Anchor: rapid repeated older-load triggers cannot abort an authoritative backfill and advance beyond an unmerged gap.
9. Anchor: return-to-latest cancels/invalidates stale anchor work.
10. Dynamic-height content (text, reply, image/video, recommendation cards) does not change the logical visible anchor during prepend/backfill.

The first test file added in this branch is intentionally a source-level characterization contract because the repository currently has no React Native integration-test harness for ChatScreen/FlashList. It locks the high-risk topology before behavior is changed. Behavioral extraction should follow only for pure pagination/transaction helpers introduced by this branch.

## Phase C — Diagnostics contract

Diagnostics must be development-only and record one logical event per transition, with fields such as:

- conversationId;
- timelineMode;
- trigger (`edge`, `reply`, `return-latest`, `own-send`);
- cursor;
- source (`local`, `remote`);
- localCount / remoteCount;
- transactionId;
- fetchState;
- visible message identity when available;
- whether a scroll command was issued and by which owner.

Do not log message content.

## Phase D — Low-risk fixes first

The first production fixes should be limited to:

1. replace permanent failed-cursor latches with retryable/bounded state;
2. keep duplicate concurrent calls suppressed while a request is in flight;
3. preserve current FlashList orientation and scroll semantics;
4. do not change anchor/latest architecture yet.

## Phase E — Pagination and viewport hardening

After D is covered, make local+remote work for one cursor a single logical transaction. In particular:

- do not advance an authoritative pagination frontier past a remote gap;
- do not expose a completed older-load state while a required backfill for that cursor can still mutate the page frontier;
- merge by stable message identity before changing page/frontier metadata;
- keep viewport preservation owned by the list/data mutation, not by ad-hoc bottom-scroll commands;
- retain `inverted` until the current behavior is stable and regression-covered.

A migration to non-inverted FlashList / `onStartReached` is explicitly out of scope for this hardening branch unless the current architecture cannot be made correct without it.

## Exit criteria

This branch is ready to merge when:

- the failure latch in both latest and anchor pagination is gone;
- repeated older-load triggers are idempotent while a cursor transaction is in flight;
- a local-first load cannot advance beyond an unmerged remote gap;
- older pagination can retry after transient failure;
- no duplicate/skip regression is observed in message identity ordering;
- scroll-to-bottom ownership remains unchanged for own-send / return-to-latest;
- type-check, lint and repository tests pass;
- manual device verification covers slow network, rapid upward scrolling, reply jump, dynamic-height media and return-to-latest.
