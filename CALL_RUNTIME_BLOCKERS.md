# Call runtime P0 blocker register

Run: `call-p0-20260921T115757Z-source-preflight`

Status: `BLOCKED — source fixes verified; candidate repin and runtime checks pending`

Scope: source preflight and runtime discovery only. Physical-device execution is
deferred by the gate owner.

## Summary

| ID     | Status                           | Layer                | Blocks P0                       | Short description                                                                            |
| ------ | -------------------------------- | -------------------- | ------------------------------- | -------------------------------------------------------------------------------------------- |
| BLK-01 | Fixed; repin pending             | Mobile test contract | Until a new candidate is pinned | Chat optimistic-failure contract selected TypeScript declarations, not implementation blocks |
| BLK-02 | Fixed; repin pending             | Mobile lint          | Until a new candidate is pinned | Nine Prettier violations made `pnpm lint` fail                                               |
| BLK-03 | Resolved in runbook              | Backend test harness | No, once documented env is used | Call-service test command omitted the CI test-only RabbitMQ URL                              |
| BLK-04 | Deferred                         | Runtime environment  | Yes                             | Local Docker daemon is unavailable, so no service health/metrics checks can run              |
| BLK-05 | Deferred                         | Release manifest     | Yes                             | Deployed API/call URLs, artifact mapping, and credentials were not supplied                  |
| BLK-06 | Deferred by request              | Physical runtime     | Yes                             | 34 device scenarios remain intentionally unexecuted                                          |
| BLK-07 | Resolved during fix verification | Mobile test contract | No                              | Reaction-label production text and its contract briefly diverged during concurrent edits     |

## BLK-01 — brittle chat optimistic-failure contract selector

**Evidence**

- Full suite: [mobile-all-tests.log](/Users/leanhquan/GitHub/.p0-evidence/call-p0-20260921T115757Z-source-preflight/preflight/mobile-all-tests.log)
- Contract test: `tests/chat-optimistic-failure-lifecycle-contract.test.cjs`
- Implementation: `src/stores/chatStore.ts`

**Reproduce**

```sh
pnpm test
```

Original candidate result: 280 total; 274 pass; 3 fail; 3 TODO.

The failing assertions are:

1. `failed optimistic sends settle the ordering domain in the same store transition`;
2. `optimistic updates settle anchors so media failure cannot leave newer stale anchors`;
3. `optimistic removal settles anchors so cancellation cannot leave an orphan ordering domain`.

**Root cause**

`getBlock()` uses `source.indexOf(startMarker)`. Each marker first appears in
the `ChatState` interface near the top of `chatStore.ts`, so the extracted
substring is only a type declaration. The actual implementations later in the
file already contain `status: 'FAILED' as const`,
`settleTextOptimisticSortAnchors(nextMessages, currentAnchors)`, and
`buildNextOptimisticSortAnchors(...)`.

**Impact**

This is a false-negative contract test, but it still blocks P0 because the full
mobile suite must be green.

**Resolution**

`getBlock()` now searches for the store object's indented property markers,
which uniquely selects the implementation without changing production logic.
The focused contract passes 3/3 and the current working-tree full suite passes
277/277 runnable tests with 3 existing TODOs.

**Fix evidence**

- [focused contract](/Users/leanhquan/GitHub/.p0-evidence/call-p0-20260921T115757Z-source-preflight/preflight/fix-chat-optimistic-contract.log)
- [current working-tree full suite](/Users/leanhquan/GitHub/.p0-evidence/call-p0-20260921T115757Z-source-preflight/preflight/working-tree-full-tests-after-fix.log)

**Implemented fix boundary**

The selector now searches for the indented store property marker. Production
implementation was not moved or distorted to satisfy the text-slicing test.

**Verification after fix**

```sh
node --test tests/chat-optimistic-failure-lifecycle-contract.test.cjs
pnpm test
```

## BLK-02 — mobile lint / Prettier failures

**Evidence**

- [mobile-lint.log](/Users/leanhquan/GitHub/.p0-evidence/call-p0-20260921T115757Z-source-preflight/preflight/mobile-lint.log)

**Reproduce**

```sh
pnpm lint
```

**Observed**

Nine errors, all `prettier/prettier`:

| File                                       | Errors |
| ------------------------------------------ | -----: |
| `app/(auth)/register.tsx`                  |      2 |
| `app/(auth)/reset-password.tsx`            |      1 |
| `app/account.tsx`                          |      1 |
| `src/components/chat/MessageInput.tsx`     |      1 |
| `src/lib/optimisticSortAnchorLifecycle.ts` |      3 |
| `src/stores/chatStore.ts`                  |      1 |

**Impact**

P0 requires a green mobile lint command. This failure is unrelated to live-call
behavior but is a required release gate.

**Resolution**

The repository's existing Prettier configuration was applied only to the six
files reported by the original run. Full `pnpm lint` passes in the detached
validation worktree. On the current checkout, source lint also passes with zero
errors when generated `ios/Pods/**` is excluded; one pre-existing unused-value
warning remains and does not fail ESLint.

The unfiltered command in the current checkout still descends into dirty,
generated CocoaPods sources and fails while resolving their nested Expo lint
configuration. This is checkout contamination, not a remaining BLK-02 source
violation; the next candidate must be validated from a clean pinned worktree.

**Fix evidence**

- [clean-worktree full lint](/Users/leanhquan/GitHub/.p0-evidence/call-p0-20260921T115757Z-source-preflight/preflight/fix-mobile-lint.log)
- [current working-tree source lint](/Users/leanhquan/GitHub/.p0-evidence/call-p0-20260921T115757Z-source-preflight/preflight/working-tree-source-lint-after-fix-02.log)

**Implemented fix boundary**

Only the repository's established Prettier formatting was applied to the listed
files; no call refactor was combined with this blocker fix.

**Verification after fix**

```sh
pnpm lint
pnpm test
```

## BLK-03 — backend preflight command omitted test configuration

**Evidence**

- First attempt: [backend-call-tests.log](/Users/leanhquan/GitHub/.p0-evidence/call-p0-20260921T115757Z-source-preflight/preflight/backend-call-tests.log)
- Corrected attempt: [backend-call-tests-attempt-02.log](/Users/leanhquan/GitHub/.p0-evidence/call-p0-20260921T115757Z-source-preflight/preflight/backend-call-tests-attempt-02.log)
- CI source: `.github/workflows/deploy.yml` and `.github/workflows/video-call-ci.yml`

**Observed**

The bare command fails before e2e setup because `RABBITMQ_URL` is absent. The
CI test-only value `amqp://127.0.0.1:5672` yields 20 suites / 134 tests passing.

**Resolution recorded**

The P0 runbook now supplies that non-secret CI value for both backend test
commands. No application code change is required.

## BLK-04 — local runtime environment unavailable

**Evidence**

- `docker ps` and `docker compose ps` both failed because the Docker API socket
  at `/Users/leanhquan/.docker/run/docker.sock` is unavailable.

**Impact**

`EP-05` cannot inspect local call-service, monitoring-service, or
notification-service health/metrics. No container was started or changed.

**Unblock**

Start Docker Desktop/local daemon, or supply access to the intended deployed
environment and its runtime manifest. Then run `EP-05` before any device case.

## BLK-05 — runtime manifest is incomplete

**Observed**

The mobile source requires externally supplied `EXPO_PUBLIC_API_URL` and
`EXPO_PUBLIC_CALL_WS_URL`. The source-only candidate has no deployed endpoint,
backend image digest, admin token reference, test account mapping, or device
mapping.

**Impact**

No Socket.IO handshake, health/metrics, admin telemetry, or Redis validation can
be attributed to this candidate.

**Unblock**

Fill the runtime fields in the manifest described by
`docs/call-runtime-baseline.md` before resuming at `EP-05`.

## BLK-06 — physical runtime matrix deferred

No physical test was attempted. The 12 SMK, 6 TERM, and 16 REC cases remain
pending. This is an explicit scheduling deferral, not evidence of a product
pass or failure.

## BLK-07 — reaction fallback contract drift during fix verification

**Observed**

The current working tree contains reaction-sheet localization changes newer
than the pinned P0 candidate. During verification, production text and
`tests/chat-reaction-details-contract.test.cjs` briefly disagreed, causing one
full-suite failure.

**Resolution**

The final working-tree snapshot consistently uses `You` for the current actor
and `User` for the anonymous fallback in both production and the contract. The
focused reaction contract passes 6/6 and the final full suite passes.

## Original candidate non-physical checks

| Check                           | Result                                         |
| ------------------------------- | ---------------------------------------------- |
| Mobile frozen-lockfile install  | PASS                                           |
| Mobile type-check               | PASS                                           |
| Mobile call-focused tests       | PASS — 99/99                                   |
| Mobile full suite               | FAIL — 274/280 pass, 3 fail, 3 TODO            |
| Mobile lint                     | FAIL — 9 errors                                |
| Backend frozen-lockfile install | PASS                                           |
| Backend call-service regression | PASS — 134/134 after documented test env setup |
| Backend boundary regression     | PASS — 100/100                                 |
| Backend production builds       | PASS — call, monitoring, notification, gateway |

## Post-fix working-tree verification

These results verify the current uncommitted source state; they do not create a
new release candidate or change the original run's final decision.

| Check                                                  | Result                              | Evidence                                          |
| ------------------------------------------------------ | ----------------------------------- | ------------------------------------------------- |
| Optimistic-failure focused contract                    | PASS — 3/3                          | `preflight/fix-chat-optimistic-contract.log`      |
| Mobile type-check                                      | PASS                                | `preflight/final-working-tree-typecheck.log`      |
| Mobile call-focused tests                              | PASS — 99/99                        | `preflight/working-tree-call-tests-after-fix.log` |
| Mobile full suite                                      | PASS — 277 passed, 0 failed, 3 TODO | `preflight/final-working-tree-full-tests.log`     |
| Current source lint, excluding generated `ios/Pods/**` | PASS — 0 errors, 1 warning          | `preflight/final-working-tree-source-lint.log`    |
| Full `pnpm lint` on detached base plus BLK-01/02 fixes | PASS                                | `preflight/fix-mobile-lint.log`                   |

## Resume order

1. Review and commit the source fixes together with the intended concurrent
   mobile changes, then pin the new mobile SHA.
2. Start a new P0 source-preflight run at `EP-00` from a clean worktree.
3. Supply the runtime manifest and resolve BLK-04/BLK-05.
4. Run `EP-05`.
5. Run the physical matrix only when device testing is authorized.
