---
name: auth-session-recovery
description: Preserve Velora Mobile authentication, refresh, logout, hydration, and auth-routing invariants when changing session lifecycle code.
---

# Auth Session Recovery

Use this skill for changes involving login/logout, `/auth/me`, `/auth/refresh`, auth hydration, session restoration, or auth redirects.

## Preserve these invariants

- Keep authentication cookie-based through `src/api/client.ts`; do not introduce a parallel token persistence path.
- Concurrent 401 responses must share one refresh request before retrying their original requests.
- Logout must wait for an already-running refresh and block new refresh attempts while logout is in progress.
- Never preflight logout with `/auth/me`; doing so can recreate an access session.
- Treat hydration as versioned work. `setUser`, `clearAuth`, and explicit fresh hydration must invalidate older in-flight hydration so stale responses cannot restore an old account or profile.
- Distinguish unauthorized hydration from network failure. Unauthorized state may clear auth; network failure must remain recoverable and must not force a false logged-out redirect.
- Resume push-token registration before publishing a successfully restored authenticated session.
- Redirect only after Expo Router has mounted enough navigation state to accept `router.replace`.

## Verify changes

Run the focused auth/session contracts first:

- `tests/auth-session-recovery-contract.test.cjs`
- `tests/logout-session-contract.test.cjs`
- `tests/push-token-auth-hydration-contract.test.cjs` when hydration ordering changes

Relevant implementation normally includes `src/api/client.ts`, `src/api/auth.api.ts`, `src/stores/authStore.ts`, and `src/providers/AuthProvider.tsx`.
