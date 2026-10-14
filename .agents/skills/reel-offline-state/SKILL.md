---
name: reel-offline-state
description: Preserve Velora Mobile offline Reel feeds, validated HLS caching, owner/device local previews, auth-scoped retention, event queues, and retries.
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

## Playback source and owner lifecycle

- Public readiness still requires completed server media and validated HLS. Do not broaden global `isReelPlayable()` to pending Reels. Reject original MP4 or device-local URLs as remote HLS, including old cached feed/status responses.
- Local originals are a separate fallback bound to the canonical Reel, authenticated owner, uploading device and auth generation. Check the current Reel identity before using retained React state; a previous Reel/account record must not appear for one render while an async resolver catches up.
- Prefer validated remote HLS when ready/online, preserve the existing offline-HLS policy, and retain an authorized local candidate if remote playback fails. Try each source candidate at most once per playback identity; player errors must not mutate backend media failure state.
- Use `localReelPlayback.ts` for managed-file retention (currently 14 days), atomic staging and safe cleanup. Pin the actual local source used by the player, including error fallback. Neither a COMPLETED response nor remote first frame immediately deletes the local preview.
- Establish the owner boundary in AuthProvider before child passive source effects; logout/account changes revoke old-owner associations and fence in-flight callbacks. Retain startup/hourly expiry and owner/device/file-existence checks.
- Keep media/evidence/index statuses distinct in TanStack status polling. Completed media remains playable while indexing is pending/processing/failed; local availability does not falsely declare remote media ready.

## Verify changes

Inspect `src/lib/reelOfflineCache.ts`, `src/database/reels/`, `src/services/reelEventQueue.ts`, reel video cache helpers, and the reel feed hooks together when changing persistence boundaries.

For owner preview/HLS handoff, also inspect `src/lib/localReelPlayback.ts`, `src/lib/reelProcessing.ts`, `src/hooks/useOfflineReelVideoSource.ts`, `src/components/reels/ReelFeedItem.tsx` and `src/providers/AuthProvider.tsx`; run the publish-recovery and playback-prefetch contracts.

Run the reel recommendation/offline-related contract tests affected by the change, plus type-check/lint when TypeScript implementation changes are part of the task.
