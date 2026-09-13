---
name: reel-offline-state
description: Preserve Velora Mobile offline reel feed metadata, cached playback state, recommendation metadata, user-scoped event queues, pruning, and retry behavior.
---

# Reel Offline State

Use this skill for reel feed persistence, offline reel/video caches, cache pruning, cached recommendation metadata, or reel engagement event queues.

## Preserve these invariants

- Build persisted feed-page keys from normalized feed params plus the opaque cursor so distinct feeds/pages cannot collide.
- Keep cached recommendation metadata associated with the cached recommendation page; offline reconstruction must not invent recommendation metadata for feeds that did not persist it.
- Prune stale or overflow feed pages without deleting reels still referenced by retained pages. Orphan reels may be removed only according to the existing age/access policy.
- Offline cache reads may return partial persisted data only when it can still form a valid page; stale pages should be discarded rather than silently treated as fresh.
- Reel event queues are scoped by authenticated user. Account changes must load a separate queue and must never submit another user's pending events.
- Keep the event queue bounded and prefer dropping lower-value progress events before critical completion/skip/watch-end events when trimming capacity.
- HTTP 401 blocks flushing while preserving queued events for auth recovery. Invalid client 4xx batches may be dropped; transient/network/server failures use bounded backoff and retain events.
- Preserve recommendation/session metadata such as `feedSessionId`, algorithm version, and generated time when it is present in a cached recommended feed page.

## Verify changes

Inspect `src/lib/reelOfflineCache.ts`, `src/database/reels/`, `src/services/reelEventQueue.ts`, reel video cache helpers, and the reel feed hooks together when changing persistence boundaries.

Run the reel recommendation/offline-related contract tests affected by the change, plus type-check/lint when TypeScript implementation changes are part of the task.
