---
name: reel-creator-media-editing
description: Preserve Velora Mobile reel crop, trim, orientation, draft hydration, preview, thumbnail, and publish-payload media-edit contracts.
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

## Verify changes

Run the focused media contracts:

- `tests/reel-crop-geometry.test.cjs`
- `tests/reel-trim-geometry.test.cjs`
- `tests/reel-crop-contract.test.cjs`
- `tests/reel-orientation-playback-contract.test.cjs`

Relevant code is under `src/components/reels/create/`, `src/lib/reel-crop-geometry.ts`, `src/lib/reel-trim-geometry.ts`, `src/lib/reel-creator.ts`, and reel creator/types/API payload code.
