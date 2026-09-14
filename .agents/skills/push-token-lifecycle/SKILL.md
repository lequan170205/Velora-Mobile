---
name: push-token-lifecycle
description: Maintain Velora Mobile FCM and VoIP token registration, invalidation, logout cleanup, and account-scoped recovery behavior.
---

# Push Token Lifecycle

Use this skill when changing FCM registration, VoIP registration, invalid-token recovery, auth hydration integration, or logout token cleanup.

## Preserve these invariants

- Push-token work is account and lifecycle scoped. Do not let delayed registration, cleanup, or retry work mutate a newer account session.
- Block new registration before logout cleanup begins.
- Capture FCM and VoIP cleanup state before clearing local credentials. Persist enough lifecycle metadata to retry cleanup after a failed logout.
- A successful authenticated hydration resumes pending registration before auth is exposed as restored.
- Terminal-invalid provider tokens must rotate through the existing lifecycle flow rather than being retried indefinitely.
- Foreground recovery may restart registration for the current authenticated account; stale work from a previous account must not continue.
- Keep raw notification tokens out of logs. Use the existing masking helpers for diagnostics.
- Preserve compatibility with both FCM and APNs VoIP cleanup payloads when editing logout behavior.

## Verify changes

Use the focused contracts that match the change:

- `tests/push-token-auth-hydration-contract.test.cjs`
- `tests/push-token-invalidated-recovery-contract.test.cjs`
- `tests/logout-session-contract.test.cjs`

Relevant code is under `src/lib/notifications/`, `src/providers/PushTokenLifecycleProvider.tsx`, auth logout code, and the native system-call bridge for VoIP state.
