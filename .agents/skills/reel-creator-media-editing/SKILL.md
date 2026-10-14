---
name: reel-creator-media-editing
description: Preserve Velora Mobile reel crop/trim, draft hydration, resumable publish intents, retained creator preview, thumbnails, and edit payloads.
---

# Reel Creator Media Editing

Use this skill for reel crop/trim editors, creator drafts, thumbnail selection, preview framing, orientation handling, or create/update edit payloads.

## Preserve these invariants

- Keep crop metadata normalized to source media rather than tied to one preview resolution.
- Sanitize hydrated edit state. Reject or clamp non-finite/out-of-range crop and trim values instead of trusting persisted drafts.
- Replacing the selected media asset resets edit state that belongs to the previous source.
- Canonical full-range trim is represented as no trim; do not publish redundant full-duration trim metadata.
- Trim handles cannot cross and must preserve the repository's minimum selectable duration.
- Crop and trim are composable. Editing one must not silently discard the committed state of the other.
- Thumbnail selection for a trimmed reel must stay inside the selected interval.
- Preserve the source frame for fit mode. Do not force landscape or square media into a 9:16 crop unless the user selected crop framing.
- Explicit edit framing takes precedence over legacy poster/orientation heuristics during playback.
- Keep gesture-heavy crop/trim interaction on shared values where the existing editor already does so; avoid moving frame-by-frame gesture state onto the JS render path.

## Durable publishing and creator preview

- Acquire the synchronous Publish lock before awaiting work. Generate one intent with `expo-crypto.randomUUID()` outside retries; the generic UUID helper has a fallback unsuitable for publish identity.
- Persist the immutable owner-scoped operation and completed steps through `reelPublishPersistence.ts`. Corrupt storage fails closed. Reuse saved presign/key/upload/create checkpoints across restart or response loss; explicitly send `purpose: reel`, and accept conditional PUT 412 as already uploaded.
- Associate retained media with the canonical `reelId` and navigate at the creation checkpoint before visibility/Series follow-ups. Their failures recover that Reel; failed attachment retains `createdSeriesId` rather than deleting/recreating a Series.
- A retired-source 410 persists `requiresCancellation` and suppresses auto-resume. Offer explicit discard/new intentional publish; never turn uncertainty into a new intent automatically.
- Stage local source/thumbnail copies atomically in managed storage before upload. Draft cleanup must not delete a canonical preview; cancellation discards only unbound prepared copies.
- Reuse ReelVideo, TrimmedReelVideo, crop preview and the playback coordinator. Local trim/crop must represent the requested output, and handoff seeks are output-relative: apply the trim source offset exactly once and preserve queued seeks during source replacement.
- Recheck current authenticated owner/generation before and after async publishing steps so an old account cannot install a canonical response or preview into the new account's caches.

## Verify changes

Run the focused media contracts:

- `tests/reel-crop-geometry.test.cjs`
- `tests/reel-trim-geometry.test.cjs`
- `tests/reel-crop-contract.test.cjs`
- `tests/reel-orientation-playback-contract.test.cjs`
- `tests/reel-publish-recovery-contract.test.cjs`
- `tests/reel-series-contract.test.cjs`

Relevant code is under `src/components/reels/create/`, `src/lib/reel-crop-geometry.ts`, `src/lib/reel-trim-geometry.ts`, `src/lib/reel-creator.ts`, and reel creator/types/API payload code.

Trace `src/hooks/useReelCreator.ts`, `src/hooks/useReels.ts`, `src/lib/reelPublishPersistence.ts`, `src/lib/reelPublishRecovery.ts` and `src/lib/localReelPlayback.ts` together for publish recovery changes; use `reel-offline-state` for source selection and retention.
