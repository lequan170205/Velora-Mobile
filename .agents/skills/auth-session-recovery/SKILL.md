---
name: auth-session-recovery
description: Preserve Velora Mobile authentication, refresh, logout, hydration, and auth-routing invariants when changing session lifecycle code.
---

# Auth Session Recovery

Use this skill for changes involving login/logout, `/auth/me`, `/auth/refresh`, auth hydration, session restoration, or auth redirects.

## Preserve these invariants

- Web authentication may remain cookie-based; Velora Mobile must use the backend mobile auth endpoints (`/auth/mobile/login`, `/auth/mobile/google/verify`, `/auth/mobile/refresh`, `/auth/mobile/logout`).
- Persist only the mobile refresh token in `expo-secure-store`. Keep the access token in memory only; never persist it in SecureStore, AsyncStorage, Zustand, or other client storage.
- Use device-bound SecureStore accessibility that remains available after first unlock because incoming-call cold-start recovery can hydrate auth while the device is locked.
- Centralize mobile Bearer injection in `src/api/client.ts` so authenticated requests use the in-memory access token without duplicating token handling across feature code.
- Concurrent 401 responses must share one refresh request before retrying their original requests.
- Refresh rotation must replace the stored refresh token before the refresh is considered successful.
- Logout must block new refresh attempts, wait for any already-running refresh, then revoke using the latest rotated refresh token before local credentials are cleared.
- Never preflight logout with `/auth/me`; doing so can recreate an access session.
- Treat hydration as versioned work. `setUser`, `clearAuth`, and explicit fresh hydration must invalidate older in-flight hydration so stale responses cannot restore an old account or profile.
- On cold start, restore the mobile session from the SecureStore refresh token before `/auth/me`. Invalid or unauthorized refresh may clear credentials; network failure must preserve the stored refresh token and remain recoverable.
- Resume push-token registration before publishing a successfully restored authenticated session.
- Keep socket/call authentication compatible with the centralized Bearer session; `/auth/socket-token` must not depend on mobile cookies.
- Redirect only after Expo Router has mounted enough navigation state to accept `router.replace`.

## Verify changes

Run the focused auth/session contracts first:

- `tests/auth-session-recovery-contract.test.cjs`
- `tests/logout-session-contract.test.cjs`
- `tests/push-token-auth-hydration-contract.test.cjs` when hydration ordering changes

Relevant implementation normally includes `src/api/client.ts`, `src/api/auth.api.ts`, `src/stores/authStore.ts`, and `src/providers/AuthProvider.tsx`.
