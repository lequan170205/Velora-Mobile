---
name: recommendation-client-contracts
description: Maintain Velora Mobile reel and user recommendation sessions, opaque pagination, attribution, source metadata, social proof, and cache invalidation contracts.
---

# Recommendation Client Contracts

Use this skill when changing recommended reels/users, candidate sources, recommendation pagination, recommendation caches, social proof, or recommendation analytics attribution.

## Recommended reels

- Treat backend `nextCursor` as opaque. Forward it unchanged; never parse or derive client semantics from it.
- First-page fetches start a fresh recommendation session. Continuation pages reuse the server-returned `feedSessionId` captured from the preceding recommendation response.
- Manual refresh and authenticated account changes reset the recommendation session and its exact React Query cache before refetching.
- If the first `excludeRecentlySeen=true` request falls back to `false`, capture the fallback response's own server session before pagination continues.
- Deduplication may remove duplicate reel IDs but must not renumber or recompute server recommendation ranks.
- Preserve server attribution fields such as recommendation ID, feed session, algorithm version, candidate source, rank, and generated time when emitting recommendation events.

## Recommended users

- Keep `/users/recommended` authoritative for recommendation rows.
- Graph recommendation rows may render mutual-friend proof from recommendation metadata; do not add ordinary friendship-status queries to each recommended row.
- Ordinary search rows keep their existing friendship-status behavior.
- Relationship mutations that change recommendation eligibility must remove or invalidate the recommended-user caches through the shared cache helpers.
- Keep recommendation failure UI distinct from a successful empty result.

## Verify changes

Run:

- `tests/reel-recommendations-v2-contract.test.cjs`
- `tests/friend-recommendations-v2-contract.test.cjs`

Relevant code includes `src/lib/recommendedReels.ts`, `src/hooks/useReels.ts`, `src/hooks/useRecommendedUsers.ts`, `src/lib/friendCache.ts`, recommendation types, and recommendation attribution helpers.
