# Call runtime baseline and release gate

This document mirrors the backend release gate so the mobile candidate and
its compatible call-service candidate are measured against the same source
points. Missing physical-device measurements are recorded as missing rather
than inferred.

## Comparison points

| Item | Baseline before this fix | Candidate after this fix |
| --- | --- | --- |
| Backend | `87688b2942c3383cffcc5929907b1a2e90210c81` | `11bd4341b61e0412b12c83507374792c0d97c122` |
| Mobile | `0e7722076857e3e79625afc376dfd57b1a1b1207` | `f6b0b1fa2f6409cca4c821e69071ff6169ef574d` |
| Captured at | 2026-09-14, Asia/Ho_Chi_Minh | 2026-09-14, Asia/Ho_Chi_Minh |

The baseline runtime scenarios were **not captured** in this source audit. The
manual matrix has not been executed; an iOS simulator cannot prove
CallKit/PushKit behavior. The final source tips above are the merged release
candidates, not the earlier pre-merge test SHAs.

## Candidate build evidence

- The final merged iPhone 17 simulator candidate built, installed and launched
  successfully with `npx expo run:ios --device "iPhone 17" --no-bundler`.
- The final merged Debug `iphoneos` candidate built successfully with Xcode and
  was installed on the connected iPhone 12
  (`DA46320E-FC2F-5BF4-B97E-D2E485B6DDC3`). Launch was deferred because the
  device was locked; no call result is inferred from the install alone.
- These are compile/install checks only. No call, network-loss, camera-toggle
  or CallKit measurements are inferred from them; the physical matrix below
  remains pending.

## Backend deployment gate

- The compatible backend source candidate is
  `11bd4341b61e0412b12c83507374792c0d97c122`; Homelab CI run `34819110593`
  and CD run `34819572841` passed, including image build and promotion.
- `homelab-deploy` later advanced to the docs-only descendant
  `b5fa5821b67e1f5b7515a33a625b119427496d60`; the running call-service image
  remained pinned to the functional candidate above until the subsequent
  master promotion `3889f134f2a6838c513e09d489dcc25bf2f8b0e4`.
- The deployment receipt
  `20260914T075755Z-11bd4341b61e-success.json` reports a successful 72-second
  transition to the candidate. The subsequent docs-only receipt
  `20260914T082100Z-b5fa5821b67e-success.json` advanced `deployed-sha` without
  restarting call-service. The subsequent master promotion receipt
  `20260914T083222Z-3889f134f2a6-success.json` completed successfully; the
  running call-service image is now tagged
  `3889f134f2a6838c513e09d489dcc25bf2f8b0e4`, with 42 GB root-disk headroom.
- Public Socket.IO handshake is healthy (`HTTP 200`, `pingInterval=25000`,
  `pingTimeout=20000`). The call-service metrics endpoint exposes the new
  disconnect-reason and reconnect-duration series.

## Safe diagnostic contract

Call diagnostics use `socketGeneration`, setup generation, shortened call /
transport / producer IDs, shortened media command IDs, camera revision,
bounded retry attempt, stable `errorCode` and `recoveryReason`. They must not
log access tokens, real user identifiers, SDP/RTP parameters, native SDK error
messages or media content.

## Required matrix

| Scenario | Required evidence | Status |
| --- | --- | --- |
| iPhone ↔ simulator video call | build IDs, disconnects, ICE restarts, media rebuilds | not captured — manual physical-device matrix pending |
| 20 camera toggles | command/revision sequence and peer convergence | not captured |
| inactive → active | producer/consumer count and camera revision | not captured |
| 3–5 second network loss | no CoreAudio/media teardown during control-plane recovery | not captured |

Before release, rerun the full matrix on an iPhone and simulator: 30 toggles,
10 foreground/background transitions, lock/unlock, network loss at 3/10/>20
seconds, toggle during reconnect, end during recovery, voice regression and
CallKit accept/end on the physical iPhone. Record aggregate counters and only
the safe fields above.

## P0 closure plan

### Scope

P0 validates the existing 1:1 voice/video implementation. It does not add
group calls, redesign call state, add media infrastructure, or refactor the
mobile provider. Code changes are allowed only when a gate scenario exposes a
reproducible defect.

P0 is complete only when:

- the pinned mobile and backend revisions are recorded;
- required automated checks pass from a clean checkout;
- every required physical-device scenario passes;
- every call attempt has a telemetry timeline and terminal outcome;
- no call remains stuck in ringing, connecting, reconnecting, or native UI;
- no media resource, foreground service, or audio session remains active after
  the call ends;
- failures and environmental reruns are recorded rather than omitted.

Any functional failure blocks the gate. An environmental failure may be rerun
once after its cause is recorded. A code fix starts a new candidate revision
and reruns the failed scenario plus the smoke matrix.

### Required setup

- one physical iPhone and one physical Android phone;
- production-like call-service, monitoring-service, APNs/PushKit, FCM, Redis,
  RabbitMQ, and public mediasoup networking;
- Wi-Fi and cellular connectivity on both devices;
- one Bluetooth audio device;
- two test accounts that can call each other;
- synchronized device clocks.

Simulators may help diagnose a failure but do not satisfy the physical-device
gate.

Record these fields before testing:

| Field | Value |
| --- | --- |
| Mobile commit | |
| Backend commit/image | |
| iOS device / OS / app build | |
| Android device / OS / app build | |
| Environment | |
| Tester / captured at | |

### Phase 1: Automated preflight

Run from clean checkouts. Do not begin the device matrix while a required check
is red.

Mobile:

```sh
pnpm type-check
node --test tests/call-*.test.cjs tests/video-call-1to1-contract.test.cjs
pnpm test
pnpm lint
```

Backend:

```sh
pnpm exec jest --runInBand apps/call-service
pnpm exec jest --runInBand \
  apps/api-gateway/src/calls \
  apps/monitoring-service/src \
  apps/notification-service/src
pnpm build:call
pnpm build:monitoring
pnpm build:notification
pnpm build:gateway
```

Record the command, revision, result, duration, and failure link or log path.

### Phase 2: Physical-device smoke matrix

Run each row for both VOICE and VIDEO. Reverse caller/callee so both native
platforms exercise outgoing and incoming paths.

| Receiver state | iOS -> Android | Android -> iOS | Required result |
| --- | --- | --- | --- |
| Foreground | | | Ring, accept, bidirectional media, clean end |
| Background | | | Native incoming UI, accept, media, clean end |
| Process not running | | | Push cold start, native accept, media, clean end |

For every row, also verify reject and caller cancellation once. A result is
PASS only when both devices agree on the terminal state and no native call
surface remains.

### Phase 3: Lifecycle and recovery matrix

Run on physical devices using an active VIDEO call unless the row says
otherwise.

| Scenario | Repetitions | PASS condition |
| --- | ---: | --- |
| Camera off/on | 30 | Both peers converge; one video producer per user |
| Foreground/background | 10 | Audio survives; video resumes or is recreated once |
| Lock/unlock receiver | 5 | Call remains usable and native UI stays synchronized |
| Network loss | 3 s | Call recovers without media teardown |
| Network loss | 10 s | ICE/rejoin recovery succeeds before the deadline |
| Network loss | >20 s | Clean end; neither device keeps a ghost call |
| Camera toggle during reconnect | 3 | Latest camera intent wins after recovery |
| End during reconnect | 3 | Terminal state wins; no late media resurrection |
| App killed during active call | 2/platform | Peer gets a terminal outcome or bounded disconnect cleanup |
| Bluetooth connect/disconnect | 2 | Audio route changes without losing the call |
| VOICE <-> VIDEO | 5 cycles | Same call session; remote state converges each cycle |

### Phase 4: Telemetry and resource checks

For each attempt, capture the call ID and verify:

- `control_plane_active` and `media_ready` for successful calls;
- `remote_audio_ready` for both legs;
- bounded reconnect and ICE/media-rebuild events for recovery scenarios;
- one terminal outcome with the expected reason;
- no access token, full user identifier, SDP/RTP payload, or media content in
  diagnostics.

After each batch, verify call-service metrics and process resources return to
their idle range. Record at minimum:

- control-plane and media-ready success rates;
- p50/p95 time to control-plane active and first remote audio;
- failures grouped by stage/error code;
- reconnect count and maximum reconnect duration;
- packet loss, jitter, RTT, concealment rate, CPU, and RSS.

The first completed run establishes the numeric performance baseline. P0 has a
hard functional gate: every required scenario must finish inside the existing
client timeouts without a leak, crash, ghost call, or missing terminal state.
Numeric regression thresholds are set only after this baseline exists.

### Evidence record

Add one candidate result section to this document with:

1. the setup table;
2. automated command results;
3. every matrix row marked PASS, FAIL, or BLOCKED;
4. call IDs and links to sanitized telemetry;
5. defects discovered and their rerun results;
6. final `PASS` or `BLOCKED` decision.

Do not replace a failed row with a later pass. Keep both attempts in the
evidence record.

### Out of scope

- group-call behavior;
- TCP/TURN changes;
- mediasoup multi-instance scaling;
- simulcast/SVC;
- UI redesign;
- unrelated test failures, except that required preflight remains blocked until
  the owning change restores a green baseline.

## P0 agent execution protocol

This protocol is the normative control layer for the operator runbook below.
It is intentionally strict enough for a less-capable coding agent to coordinate
the gate without inventing steps or silently skipping failures. The runbook
contains the command and test details; this protocol controls order, state,
evidence, and stopping behavior.

### Execution contract

The agent MUST:

1. execute exactly one checkpoint at a time;
2. print the checkpoint result before starting the next checkpoint;
3. use only the status values `PASS`, `FAIL`, `BLOCKED`, and
   `WAITING_FOR_HUMAN`;
4. stop immediately on `FAIL` or `BLOCKED`;
5. preserve every failed attempt and its evidence;
6. treat missing, ambiguous, or contradictory evidence as `BLOCKED`;
7. ask a human to perform every physical-device action;
8. keep P0 validation-only.

The agent MUST NOT:

- edit application code, tests, configuration, or infrastructure;
- run `git stash`, `git commit`, `git push`, destructive Git commands, or
  commands that discard local changes;
- create a clean candidate from a dirty checkout by guessing which files to
  keep;
- retry a failed product test until it happens to pass;
- classify an unknown failure as environment-related without concrete
  evidence;
- mark a media/UI assertion PASS from logs alone;
- mark a backend assertion PASS from human observation alone;
- continue after the candidate SHA, artifact, environment, account, or device
  changes;
- expose access tokens, push credentials, phone numbers, or raw user data in
  the report.

Any required code fix ends the current run. The fix happens in a separate task
and produces a new candidate and a new run ID.

### Required human and agent capabilities

The agent owns shell commands, log capture, evidence indexing, telemetry/Redis
checks, result bookkeeping, and the final mechanical gate calculation.

The human operator owns:

- unlocking, rebooting, and operating the two physical devices;
- accepting, rejecting, cancelling, and ending calls;
- changing foreground/background, lock, network, permission, and Bluetooth
  state;
- confirming visible UI, audible speech, and remote video;
- supplying credentials and tokens through local environment variables;
- making the final release decision after reviewing the agent's calculation.

If either physical device or the required human operator is unavailable, return
`BLOCKED — HARDWARE` and stop before the physical matrix.

### Start prompt

Use this prompt when assigning the run to an agent:

```text
Execute the P0 1:1 release gate in docs/call-runtime-baseline.md.
Follow "P0 agent execution protocol" as the normative state machine and use
"P0 operator runbook" only for the referenced commands and case procedures.
Run exactly one checkpoint at a time. After each checkpoint, print the required
checkpoint response and stop if its status is FAIL, BLOCKED, or
WAITING_FOR_HUMAN. Never edit code or configuration. Never skip or silently
retry a failure. Missing evidence is BLOCKED. Do not start group-call work.
```

### Suggested agent configuration

Recommendation as of 2026-09-21:

| Use | Model | Reasoning effort | Why |
| --- | --- | --- | --- |
| Run the complete protocol's happy path | `gpt-5.6-terra` | `medium` | The deterministic checkpoints remove most open-ended reasoning |
| Coordinator when evidence is unusually complex | `gpt-5.6-sol` | `high` | Escalation without paying for it during ordinary execution |
| Diagnose a stopped/failed run in a separate task | `gpt-6-astra` | `xhigh` | More reasoning for cross-service failure correlation |

Use `gpt-5.6-terra` with `medium` effort for the happy path. Its job is to
execute the protocol, preserve evidence, and stop on ambiguity, not to invent a
diagnosis. Escalate only after the protocol stops. This recommendation follows
the current OpenAI model guidance to establish accuracy before optimizing cost:

- <https://developers.openai.com/api/docs/guides/model-selection>
- <https://developers.openai.com/api/docs/models/gpt-5.6-terra>
- <https://developers.openai.com/api/docs/models/gpt-5.6-sol>

The run is sequential and depends on human device actions, so a multi-agent or
maximum-effort mode is not required. Keeping one coordinator also avoids split
ownership of the ledger and call IDs.

### Input manifest

The gate owner must fill the source-preflight fields before `EP-01`. Runtime
fields are required only before `EP-06`. Store secrets only in the named local
environment variables, never in this manifest.

```yaml
# Required before EP-01.
run_id: call-p0-YYYYMMDD-HHMM
mobile_repo: /absolute/path/Velora-Mobile
backend_repo: /absolute/path/microservices-boilerplate
mobile_sha: FULL_40_CHARACTER_SHA
backend_sha: FULL_40_CHARACTER_SHA
evidence_dir: /absolute/private/path/call-p0-YYYYMMDD-HHMM
gate_owner: NAME

# Required before EP-06 only.
mobile_artifact: SIGNED_BUILD_ID_OR_PATH
backend_artifact: IMAGE_TAG_OR_DIGEST
environment: staging
api_base_url: https://example.invalid
call_ws_url: https://example.invalid
compose_project_dir: /absolute/path/microservices-boilerplate
admin_token_env: CALL_P0_ADMIN_TOKEN
account_a: REDACTED_ACCOUNT_LABEL
account_b: REDACTED_ACCOUNT_LABEL
ios_device: MODEL_AND_IOS_VERSION
android_device: MODEL_AND_ANDROID_VERSION
android_serial: ADB_SERIAL
ios_operator: NAME
android_operator: NAME
backend_observer: NAME
```

Input validation rules:

- before `EP-01`, source paths must be absolute, SHAs must be 40 hexadecimal
  characters, `run_id` and `evidence_dir` must be unique, and the gate owner
  must be named;
- before `EP-06`, `mobile_artifact` and `backend_artifact` must resolve to the
  recorded SHAs, both accounts must be non-production test accounts, every
  device/operator mapping must be known, and the token variable must exist
  locally without printing its value;
- a missing field required by the current checkpoint returns
  `BLOCKED — MISSING_INPUT`.

### Source-preflight mode

When physical runtime testing is intentionally deferred, run `EP-00` through
`EP-04` only. `EP-05` validates a deployed runtime and therefore requires the
runtime manifest even though it does not use a physical device. A run with all
five source checkpoints passing may report `SOURCE_PREFLIGHT_PASS`; it is not a
P0 release PASS and does not satisfy any environment, physical,
telemetry-per-call, or cleanup gate. Resume the same candidate at `EP-05` only
after the runtime manifest is complete.

### Evidence layout

Create this structure once after validating the manifest:

```text
<evidence_dir>/
  manifest.yaml
  ledger.tsv
  preflight/
  environment/
  devices/
  cases/<TEST_ID>/attempt-01/
  summary/
```

Each physical test attempt must contain, where applicable:

```text
human-observation.md
ios.log
android.log
backend.log
telemetry.json
redis-before.txt
redis-active.txt
redis-after.txt
metrics-before.txt
metrics-after.txt
```

Never overwrite an attempt. A permitted rerun uses `attempt-02`, then
`attempt-03`, and so on.

`ledger.tsv` has exactly these tab-separated columns:

```text
checkpoint_id	attempt	started_utc	finished_utc	status	call_id	evidence_path	failure_code	notes
```

Append one row after every checkpoint or test attempt. Never edit or delete a
previous row.

### Checkpoint response

After every checkpoint, the agent must print exactly this shape:

```text
CHECKPOINT: <EP-ID or TEST-ID>
STATUS: PASS | FAIL | BLOCKED | WAITING_FOR_HUMAN
OBSERVED: <one factual sentence>
EVIDENCE: <absolute evidence path or NONE>
FAILURE_CODE: <code or NONE>
NEXT: <next checkpoint ID or STOP>
HUMAN_ACTION: <one action or NONE>
```

Rules:

- `OBSERVED` must describe measured output, not intent;
- `EVIDENCE` must exist before `PASS` is printed;
- `FAILURE_CODE` is mandatory for `FAIL` or `BLOCKED`;
- `HUMAN_ACTION` must contain only one physical action at a time;
- `WAITING_FOR_HUMAN` means the agent does nothing until the operator replies.

### Failure codes

Use the first matching code. Do not invent a diagnosis when none is proven.

| Code | Meaning | Required result |
| --- | --- | --- |
| `MISSING_INPUT` | Manifest field, credential reference, or mapping is missing | BLOCKED |
| `DIRTY_CANDIDATE` | Either pinned checkout contains changes | BLOCKED |
| `REVISION_MISMATCH` | Source, build, or image does not match the manifest | BLOCKED |
| `PREFLIGHT_FAILURE` | A required automated command exits non-zero | FAIL |
| `SERVICE_UNHEALTHY` | Required endpoint or service is unavailable | BLOCKED |
| `HARDWARE` | Required device, cellular service, Bluetooth, or operator is unavailable | BLOCKED |
| `OBSERVATION_MISSING` | Human media/UI confirmation was not supplied | BLOCKED |
| `EVIDENCE_MISSING` | Required log, telemetry, Redis, or result file is absent | BLOCKED |
| `CALL_SETUP_FAILURE` | Ringing, accept, or media-ready deadline is missed | FAIL |
| `MEDIA_FAILURE` | Required audio/video behavior is incorrect | FAIL |
| `TERMINAL_FAILURE` | Call UI/state does not clear or resurrects | FAIL |
| `RECOVERY_FAILURE` | Required reconnect/lifecycle behavior is incorrect | FAIL |
| `TELEMETRY_FAILURE` | Required legs, stages, or identifiers are absent or inconsistent | FAIL |
| `CLEANUP_FAILURE` | Redis/runtime state remains after the cleanup deadline | FAIL |
| `UNCLASSIFIED` | Evidence proves a failure but not its owning layer | BLOCKED |

Ownership labels such as `MOBILE`, `BACKEND`, `INFRA`, or `ENVIRONMENT` may be
added to notes only after evidence supports them. They do not change the stop
rule.

### State machine

Run checkpoints in this exact order:

| ID | Action | PASS condition | On any other result |
| --- | --- | --- | --- |
| `EP-00` | Read this protocol and initialize an empty ledger | Protocol version and run ID recorded | Stop |
| `EP-01` | Validate source-preflight manifest fields | All source input rules pass | Stop |
| `EP-02` | Execute Step 0 and Step 1 | Scope frozen; both repositories clean and pinned | Stop |
| `EP-03` | Run each mobile command in Step 2.1 separately | All five commands exit 0 and logs exist | Stop |
| `EP-04` | Run each backend command in Step 2.2 separately | All seven commands exit 0 and logs exist | Stop |
| `EP-05` | Execute every check in Step 3 | Env, handshake, health, and metrics pass | Stop |
| `EP-06` | Validate runtime manifest and guide the human through Step 4 one action at a time | Both signed builds and devices are ready | Stop |
| `EP-07` | Start Step 5 capture and save baseline metrics | All capture streams and baseline files exist | Stop |
| `EP-08` | Execute `SMK-01` through `SMK-12` in order | Twelve latest attempts are PASS | Stop |
| `EP-09` | Execute `TERM-01` through `TERM-06` in order | Six latest attempts are PASS | Stop |
| `EP-10` | Execute `REC-01` through `REC-16` in order | Sixteen latest attempts are PASS | Stop |
| `EP-11` | Validate telemetry and cleanup coverage using Steps 10 and 11 | Every required call is covered and clean | Stop |
| `EP-12` | Generate the candidate result using Step 13 | Mechanical decision and evidence index complete | Stop |

The agent may load only the current checkpoint and its referenced runbook step.
It does not need to keep the entire document in working context.

### Automated-command rule

For `EP-03`, `EP-04`, and `EP-05`:

1. announce the exact command and destination log;
2. run only that command;
3. capture stdout, stderr, and exit code;
4. verify that the log exists and is non-empty;
5. append the command result to the ledger;
6. stop immediately if the exit code is non-zero;
7. otherwise advance to the next command in the same checkpoint.

Do not combine commands with `&&` because the ledger needs one result per
command. A command killed by timeout is `FAIL — PREFLIGHT_FAILURE` unless
Step 3 proves the environment itself unavailable.

### Physical-test handshake

For each `SMK`, `TERM`, or `REC` test, use this loop and no other flow:

1. Create `<evidence_dir>/cases/<TEST_ID>/attempt-NN/`.
2. Read only that test's row/procedure and the common procedure in Step 6.
3. Verify both devices show no active or stale call.
4. Capture Redis and process state into `redis-before.txt` and the relevant
   baseline files.
5. Start iOS, Android, and backend log capture.
6. Print `WAITING_FOR_HUMAN` with exactly one setup/action instruction.
7. After the human replies, repeat Step 6 until all physical actions for the
   case are complete.
8. Ask for the structured human observation below.
9. Stop capture, extract the call ID, and save all evidence.
10. Run Step 10 telemetry checks and Step 11 cleanup checks.
11. Apply the case PASS conditions without interpretation or forgiveness.
12. Append the attempt to the ledger and print the checkpoint response.
13. Continue only when the result is PASS.

The operator reply at Step 8 must use this form:

```text
HUMAN_OBSERVATION
test_id: <TEST-ID>
incoming_ui_seconds: <number or N/A>
media_ready_seconds: <number or N/A>
audio_a_to_b: PASS | FAIL | N/A
audio_b_to_a: PASS | FAIL | N/A
video_a_to_b: PASS | FAIL | N/A
video_b_to_a: PASS | FAIL | N/A
terminal_ui_cleared_seconds: <number or N/A>
unexpected_ui_or_error: NONE | <exact text>
requested_case_behavior: PASS | FAIL
notes: <short factual note>
```

If a required field is missing, return
`BLOCKED — OBSERVATION_MISSING`; do not infer it.

### Universal physical-test assertions

Every successful connected call must satisfy all applicable assertions:

- incoming surface appears within 10 seconds;
- accepted media becomes usable within 15 seconds;
- both audio directions pass;
- both video directions pass for VIDEO;
- caller identity and call type are correct;
- one call ID is used from setup through terminal state;
- no duplicate native/in-app incoming surface appears;
- the row-specific behavior passes;
- both devices clear call surfaces within 5 seconds of terminal state;
- telemetry contains both legs and the required lifecycle stages;
- Redis runtime keys are gone after the terminal cleanup deadline.

`TERM` cases that never connect use their row-specific expected outcome instead
of media-ready assertions. `REC` cases also require every assertion written in
their Step 9 procedure.

One failed assertion makes the case FAIL. Do not average results or use a
majority rule.

### Retry protocol

A failed product assertion is never retried in the same run.

An environment-blocked attempt may be rerun only when all conditions hold:

1. evidence names the concrete external cause;
2. no source, artifact, image, account, or device changed;
3. the gate owner records the corrective action;
4. the original attempt remains in the ledger;
5. the rerun uses the next attempt directory.

If the same environment cause occurs twice, return `BLOCKED` and end the run.
After any code or configuration change, start a new run from `EP-00` with a new
run ID.

### Evidence-completion continuation

The default stop rule remains mandatory for a release decision. The gate owner
may explicitly authorize a **non-physical evidence-completion continuation**
after a preflight failure when the purpose is to collect the remaining command
results, not to clear the failure.

For such a continuation:

1. record the original failed checkpoint before any subsequent command;
2. record the gate owner's explicit authorization in the manifest and ledger;
3. run only remaining automated/source checks on the same pinned clean
   worktrees;
4. do not run physical runtime tests, deploy changes, edit code, retry the
   failed command, or mark any gate PASS;
5. label every later result `CONTINUATION_ONLY` in its ledger notes;
6. end with `BLOCKED` until a new candidate fixes the original failure and
   reruns from `EP-00`.

This exception improves diagnostic completeness only. It never changes the
mechanical release-gate calculation.

### Mechanical gate calculation

`EP-12` may output `PASS` only when the ledger proves all of these facts:

- `EP-00` through `EP-07` have PASS as their latest result;
- exactly 12 required `SMK` IDs have a latest PASS;
- exactly 6 required `TERM` IDs have a latest PASS;
- exactly 16 required `REC` IDs have a latest PASS;
- `EP-11` is PASS;
- no latest required result is FAIL, BLOCKED, WAITING, or missing;
- the evidence index contains no missing path;
- every rerun retains its earlier attempts;
- Step 13 exit criteria all pass.

That is 34 required physical cases. Any other state produces `BLOCKED`, listing
the exact missing or failed IDs. `PASS WITH KNOWN ISSUES` remains invalid.

### Final output

The agent returns only:

1. final decision: `PASS` or `BLOCKED`;
2. candidate mobile SHA/artifact and backend SHA/image;
3. counts for preflight, SMK, TERM, and REC;
4. failed or missing IDs;
5. absolute path to the evidence index and candidate report;
6. a list of defects without attempting fixes.

The human gate owner verifies the report and explicitly signs the release gate.

## P0 operator runbook

This section turns the closure plan into a test procedure. Follow it in order.
Do not skip a failed step and continue to a later phase.

### Current starting state

The latest source audit before this runbook recorded:

- mobile call-focused tests: 99 passed, 0 failed;
- backend call-service tests: 134 passed, 0 failed;
- full mobile suite: 274 passed, 3 unrelated chat optimistic-lifecycle tests
  failed;
- physical-device matrix: not executed;
- the current mobile checkout is dirty and must not be treated as a release
  candidate.

These are historical observations, not a PASS. Re-run every preflight command
against the candidate revisions.

### Operator roles and timebox

One person may fill every role, but write a name beside each role:

| Role | Responsibility | Name |
| --- | --- | --- |
| Gate owner | Freezes revisions and gives final PASS/BLOCKED decision | |
| iOS operator | Controls iPhone, CallKit, Console logs | |
| Android operator | Controls Android, notifications, `adb logcat` | |
| Backend observer | Captures telemetry, Redis state, metrics, service logs | |

Reserve one uninterrupted session:

1. 30-60 minutes for candidate freeze and preflight;
2. 30 minutes for installation and device preparation;
3. 90 minutes for the smoke and terminal-state matrices;
4. 90-120 minutes for lifecycle/recovery tests;
5. 30 minutes for evidence review and the gate decision.

Stop the session if a required service is degraded, either device cannot use
cellular data, or the candidate revision changes.

### Step 0: Freeze scope

Before running commands, confirm every item:

- [ ] This run validates 1:1 VOICE and VIDEO only.
- [ ] No group-call code will be written.
- [ ] No TCP/TURN, scaling, simulcast, or UI work will be mixed into the run.
- [ ] A reproducible product defect becomes a separate fix task.
- [ ] Raw logs stay local and are not committed.
- [ ] Test accounts contain no real-user data.

### Step 1: Freeze candidate revisions

Use clean checkouts or clean worktrees. In each repository, run:

```sh
git status --short
git branch --show-current
git rev-parse HEAD
git log -1 --format='%H %cI %s'
```

Expected result:

- `git status --short` prints nothing;
- the full SHA is the revision used to build the candidate;
- the backend image tag or digest resolves to the recorded backend SHA.

If either checkout is dirty, stop. Do not stash, commit generated files, or
guess which uncommitted changes belong in the candidate. Produce a clean
candidate first.

Create a private local evidence directory outside the repository. Use an
explicit path; do not commit it:

```sh
export CALL_EVIDENCE_DIR="/absolute/private/path/call-p0-YYYY-MM-DD"
mkdir -p "$CALL_EVIDENCE_DIR"
```

Record the two SHAs and artifact identifiers in the setup table before
continuing.

### Step 2: Run automated preflight

Run each command separately with shell pipeline failure propagation enabled.
Keep the complete output:

```sh
set -o pipefail
```

#### 2.1 Mobile preflight

From `Velora-Mobile`:

```sh
pnpm install --frozen-lockfile 2>&1 | tee "$CALL_EVIDENCE_DIR/mobile-install.log"
pnpm type-check 2>&1 | tee "$CALL_EVIDENCE_DIR/mobile-typecheck.log"
node --test tests/call-*.test.cjs tests/video-call-1to1-contract.test.cjs \
  2>&1 | tee "$CALL_EVIDENCE_DIR/mobile-call-tests.log"
pnpm test 2>&1 | tee "$CALL_EVIDENCE_DIR/mobile-all-tests.log"
pnpm lint 2>&1 | tee "$CALL_EVIDENCE_DIR/mobile-lint.log"
```

PASS conditions:

- every command exits `0`;
- no test is cancelled;
- TODO tests may remain TODO only if they were already TODO at the pinned SHA;
- no call test is skipped;
- the full suite is green. The known three chat failures still block P0 even
  though they are unrelated to calls.

#### 2.2 Backend preflight

From `microservices-boilerplate`:

```sh
pnpm install --frozen-lockfile 2>&1 | tee "$CALL_EVIDENCE_DIR/backend-install.log"
# Test-only value matching the repository CI workflow; it is not a deployment secret.
RABBITMQ_URL=amqp://127.0.0.1:5672 pnpm exec jest --runInBand apps/call-service \
  2>&1 | tee "$CALL_EVIDENCE_DIR/backend-call-tests.log"
RABBITMQ_URL=amqp://127.0.0.1:5672 pnpm exec jest --runInBand \
  apps/api-gateway/src/calls \
  apps/monitoring-service/src \
  apps/notification-service/src \
  2>&1 | tee "$CALL_EVIDENCE_DIR/backend-call-boundary-tests.log"
pnpm build:call 2>&1 | tee "$CALL_EVIDENCE_DIR/backend-build-call.log"
pnpm build:monitoring 2>&1 | tee "$CALL_EVIDENCE_DIR/backend-build-monitoring.log"
pnpm build:notification 2>&1 | tee "$CALL_EVIDENCE_DIR/backend-build-notification.log"
pnpm build:gateway 2>&1 | tee "$CALL_EVIDENCE_DIR/backend-build-gateway.log"
```

PASS conditions:

- every command exits `0`;
- all call-service suites pass;
- API gateway, telemetry, APNs/FCM, retry, and notification-job tests pass;
- all four production builds complete.

If any preflight command fails, mark the gate `BLOCKED — PREFLIGHT`, attach its
log path, and stop before device testing.

### Step 3: Verify the deployed environment

The deployed environment must run the pinned backend candidate. Do not deploy
manually from this runbook; use the existing deployment process and record its
receipt or image digest.

#### 3.1 Verify mobile build configuration

The signed mobile artifacts must contain non-empty values for:

- `EXPO_PUBLIC_API_URL`;
- `EXPO_PUBLIC_CALL_WS_URL`.

For a local diagnostic build, verify the `.env` file without printing values:

```sh
awk -F= '
  $1 == "EXPO_PUBLIC_API_URL" || $1 == "EXPO_PUBLIC_CALL_WS_URL" {
    print $1 "=" (length($2) > 0 ? "set" : "MISSING")
  }
' .env
```

Expected result: both variables print `set`. A local debug build can diagnose a
failure but does not replace a correctly signed release candidate for APNs and
CallKit validation.

#### 3.2 Verify service topology and non-secret configuration

On the backend host:

```sh
docker compose ps
docker compose exec -T call-service node -e '
const names = [
  "REDIS_HOST",
  "REDIS_PORT",
  "RABBITMQ_URL",
  "MEDIASOUP_ANNOUNCED_IP",
  "MEDIASOUP_WEBRTC_SERVER_PORT",
  "MEDIASOUP_WORKERS",
  "CALL_SINGLE_INSTANCE_GUARD"
];
for (const name of names) {
  console.log(name + "=" + (process.env[name] ? "set" : "MISSING"));
}
'
```

Expected result:

- gateway, call-service, monitoring-service, notification-service, RabbitMQ,
  and their dependencies are running;
- all listed variables are `set`;
- call-service has one replica;
- `CALL_SINGLE_INSTANCE_GUARD` is enabled;
- the deployed UDP port matches the mediasoup configuration.

This command deliberately prints only `set`/`MISSING`; never paste secrets into
the evidence document.

#### 3.3 Verify health, metrics, and Socket.IO handshake

From a machine that can reach the environment, set only public base URLs:

```sh
export API_BASE_URL="https://api.example.test"
export CALL_WS_BASE_URL="https://call.example.test"
```

Check the public Socket.IO endpoint:

```sh
curl -fsS \
  "$CALL_WS_BASE_URL/call/socket.io/?EIO=4&transport=polling" \
  | tee "$CALL_EVIDENCE_DIR/socket-handshake.txt"
```

Expected result: HTTP success and an Engine.IO open packet containing the
configured `pingInterval` and `pingTimeout`.

Check internal services from their containers:

```sh
docker compose exec -T monitoring-service node -e \
  'fetch("http://127.0.0.1:3016/health").then(r => r.text()).then(console.log)'
docker compose exec -T call-service node -e \
  'fetch("http://127.0.0.1:3007/metrics").then(r => r.text()).then(console.log)'
docker compose exec -T notification-service node -e \
  'fetch("http://127.0.0.1:3015/metrics").then(r => r.text()).then(console.log)'
```

Expected result:

- monitoring health returns `{"status":"ok"}`;
- call and notification metrics return Prometheus text;
- no service restart loop appears in `docker compose ps`.

### Step 4: Prepare signed builds and physical devices

Use the exact signed artifacts produced from the pinned mobile SHA. Do not use
Expo Go.

#### 4.1 Install cleanly

1. Remove the previous Velora build from both devices.
2. Install the pinned iOS release candidate with Xcode Devices and Simulators,
   Apple Configurator, TestFlight, or the existing signed-delivery path.
3. Install the pinned Android APK/AAB delivery candidate. For an APK:

   ```sh
   adb devices -l
   adb install -r /absolute/path/to/velora-candidate.apk
   ```

4. Launch Velora once on each device.
5. Confirm the displayed app version/build matches the setup table.

#### 4.2 Configure devices

On both devices:

1. Disable Do Not Disturb/Focus.
2. Disable Low Power/Battery Saver.
3. Set media and ringtone volume to an audible level.
4. Grant notification, microphone, and camera permission.
5. Confirm date/time is automatic.
6. Confirm Wi-Fi and cellular data both work.

On Android additionally:

1. Allow notifications and full-screen incoming-call notifications.
2. Set Velora battery usage to `Unrestricted` for the test session.
3. Verify Google Play services is current.
4. Do not use Settings > Apps > Velora > Force stop during required cold-start
   tests.

On iOS additionally:

1. Confirm Velora appears under Settings > Notifications.
2. Confirm microphone and camera permissions are enabled.
3. Launch the app at least once after installation so APNs/PushKit tokens can
   register.
4. Do not swipe Velora away from the app switcher during required cold-start
   tests. A user force-quit suppresses remote notifications until relaunch.

#### 4.3 Prepare accounts

Use aliases rather than credentials in evidence:

| Alias | Device | Platform | Account ID suffix only |
| --- | --- | --- | --- |
| Account A | iPhone | iOS | |
| Account B | Android | Android | |

1. Sign in as Account A on iPhone.
2. Sign in as Account B on Android.
3. Open the same direct conversation on both devices.
4. Send one message each way to confirm auth, conversation membership, socket
   connectivity, and ordinary push delivery.
5. Leave each app open for at least 30 seconds so push-token registration can
   complete.

If either account cannot receive a normal background notification, mark
`BLOCKED — PUSH REGISTRATION` and do not start call testing.

### Step 5: Start evidence capture

#### 5.1 iOS native logs

1. Open macOS Console.
2. Select the physical iPhone under Devices.
3. Start streaming.
4. Filter for `VeloraSystemCalls` and the Velora process.
5. Save the log archive to `CALL_EVIDENCE_DIR` after the session.

Do not filter so narrowly that CallKit, PushKit, or process termination events
disappear.

#### 5.2 Android logs

Clear stale logs, then start capture in a dedicated terminal:

```sh
adb logcat -c
adb logcat -v threadtime 2>&1 | tee "$CALL_EVIDENCE_DIR/android-logcat.log"
```

Leave this running until all Android scenarios finish.

#### 5.3 Backend logs

On the backend host, start a dedicated capture:

```sh
docker compose logs --since=1m -f \
  call-service notification-service monitoring-service api-gateway \
  2>&1 | tee "$CALL_EVIDENCE_DIR/backend-call-services.log"
```

Capture an idle metrics snapshot before the first call:

```sh
docker compose exec -T call-service node -e \
  'fetch("http://127.0.0.1:3007/metrics").then(r => r.text()).then(console.log)' \
  > "$CALL_EVIDENCE_DIR/call-metrics-before.txt"
docker stats --no-stream > "$CALL_EVIDENCE_DIR/docker-stats-before.txt"
```

### Step 6: Use the standard procedure for every call

Every test case below uses this procedure unless it explicitly overrides a
step.

#### Before placing the call

1. Verify neither device shows an active/minimized/native call.
2. Put each device in the required app and network state.
3. Confirm the direct conversation still loads.
4. Write the test ID and UTC start time in the result sheet.
5. Start a stopwatch.

#### Place and connect the call

1. On the caller, open the direct conversation.
2. Tap the required VOICE or VIDEO call action once.
3. Do not tap repeatedly while the loading indicator is visible.
4. Confirm the caller enters outgoing ringing.
5. Confirm the receiver gets exactly one incoming surface.
6. Record ring-display latency.
7. Accept using the surface required by the test: in-app UI or native system
   UI.
8. Record time from Accept to usable bidirectional audio.

Hard timing limits:

- incoming surface visible within 10 seconds of the caller action;
- usable bidirectional audio within 15 seconds of Accept;
- terminal UI clears on both devices within 5 seconds of End/Reject/Cancel.

Any existing client timeout, repeated incoming surface, or manual retry is a
FAIL even if the call later connects.

#### Verify media

For VOICE:

1. Account A says `alpha one two three`; Account B repeats it.
2. Account B says `bravo four five six`; Account A repeats it.
3. Toggle mute once on each device and verify only the local microphone mutes.
4. Toggle speaker/receiver once where the platform exposes it.

For VIDEO:

1. Perform the same audio check.
2. Verify local preview and the remote video tile on both devices.
3. Account A raises one finger; Account B confirms it.
4. Account B raises two fingers; Account A confirms it.
5. Flip camera once on the caller and verify the remote image continues.

Keep the call active for at least 30 seconds after media becomes usable so at
least one quality sample can be emitted.

#### End and inspect

1. End from the device specified by the test row.
2. Wait 10 seconds without reopening the call screen.
3. Confirm both devices return to a non-call screen.
4. Confirm no native call UI, ongoing-call notification, floating return
   button, foreground service, microphone indicator, or camera indicator
   remains.
5. Record UTC end time, visible result, and any error text.
6. Fetch telemetry using Step 10.
7. Check Redis cleanup using Step 11.
8. Mark PASS or FAIL immediately. Never leave the cell blank.

### Step 7: Run the physical-device smoke matrix

Use Wi-Fi on the caller and cellular data on the receiver. Because both devices
send media after Accept, this exercises cellular media in both directions.

For `Process not running` rows, reboot the receiver, unlock it once, wait for
network registration, and do not open Velora before placing the call. Reboot
again before the next process-not-running row. Do not substitute user
force-quit/Force stop.

| Test ID | Caller | Receiver state | Type | End from | Result |
| --- | --- | --- | --- | --- | --- |
| SMK-01 | iOS -> Android | Foreground | VOICE | Caller | |
| SMK-02 | iOS -> Android | Foreground | VIDEO | Receiver | |
| SMK-03 | iOS -> Android | Background 15 s | VOICE | Receiver | |
| SMK-04 | iOS -> Android | Background 15 s | VIDEO | Caller | |
| SMK-05 | iOS -> Android | Process not running | VOICE | Caller | |
| SMK-06 | iOS -> Android | Process not running | VIDEO | Receiver | |
| SMK-07 | Android -> iOS | Foreground | VOICE | Receiver | |
| SMK-08 | Android -> iOS | Foreground | VIDEO | Caller | |
| SMK-09 | Android -> iOS | Background 15 s | VOICE | Caller | |
| SMK-10 | Android -> iOS | Background 15 s | VIDEO | Receiver | |
| SMK-11 | Android -> iOS | Process not running | VOICE | Receiver | |
| SMK-12 | Android -> iOS | Process not running | VIDEO | Caller | |

Additional PASS conditions for background/process-not-running rows:

- iOS uses CallKit and Android uses the native incoming-call surface;
- accepting opens/resumes the correct call, not a stale call;
- caller identity and VOICE/VIDEO type are correct;
- the app does not display a second in-app incoming surface over the native
  one;
- cold-start authentication restoration completes without asking the user to
  sign in again.

### Step 8: Run terminal-state cases

Use the standard procedure until the action column, then perform that action.

| Test ID | Direction/type/state | Action | PASS condition | Result |
| --- | --- | --- | --- | --- |
| TERM-01 | iOS -> Android, VOICE, background | Receiver rejects from native UI | Caller shows rejected; both native surfaces clear | |
| TERM-02 | Android -> iOS, VIDEO, background | Receiver rejects from CallKit | Caller shows rejected; both native surfaces clear | |
| TERM-03 | iOS -> Android, VIDEO, background | Caller cancels before answer | Incoming Android surface clears within 5 s | |
| TERM-04 | Android -> iOS, VOICE, background | Caller cancels before answer | CallKit surface clears within 5 s | |
| TERM-05 | iOS -> Android, VOICE, background | Nobody answers for the configured ring timeout | Both sides resolve as no-answer; no ghost call | |
| TERM-06 | Android -> iOS, VIDEO, background | Nobody answers for the configured ring timeout | Both sides resolve as no-answer; no ghost call | |

After TERM-03 through TERM-06, open Velora on the receiver and confirm it does
not resurrect the terminal call from a delayed push or journal action.

### Step 9: Run lifecycle and recovery cases

Start with an active iOS -> Android VIDEO call unless a row specifies another
direction.

#### REC-01: Camera revision convergence

1. Toggle the iPhone camera off, wait for Android to show camera-off state.
2. Toggle it on, wait for remote video.
3. Repeat 30 off/on cycles, counting every cycle aloud or with a counter.
4. Never issue the next toggle before the peer reflects the previous state.
5. At cycles 10, 20, and 30, inspect the Redis producer count in Step 11.

PASS: no stale camera state, no duplicate tile, one audio and one video producer
per participant, and the call remains usable.

#### REC-02: Foreground/background

1. Keep the call active.
2. Send the iPhone to background for 5 seconds, then foreground it.
3. Wait for video convergence.
4. Repeat 10 times.
5. Repeat one cycle on Android.

PASS: audio remains usable; camera resumes or is recreated once; no second
producer or native call surface appears.

#### REC-03: Lock/unlock

1. Lock the receiver for 10 seconds.
2. Keep speaking from the caller.
3. Unlock and return to Velora.
4. Repeat 5 times.

PASS: native call state remains synchronized, audio is usable, and video
recovers without starting a new call.

#### REC-04: Three-second network loss

1. On the receiver, enable Airplane mode and start a timer.
2. At 3 seconds, disable Airplane mode.
3. Wait for cellular or Wi-Fi connectivity and the call to recover.

PASS: no terminal transition, no CoreAudio teardown, and bidirectional media
returns without user action.

#### REC-05: Ten-second network loss

Repeat REC-04 with a 10-second outage.

PASS: the reconnect UI appears, ICE/rejoin recovery finishes before the
deadline, and the same call ID remains active.

#### REC-06: Outage beyond recovery window

Repeat REC-04 with a 25-second outage.

PASS: the call reaches one clean terminal outcome; both devices clear call
surfaces; restoring the network does not resurrect it.

#### REC-07: Camera intent at disconnect boundary

1. Start with camera on.
2. Disable the receiver network.
3. Immediately try the camera control once.
4. If the UI has already entered reconnecting and disables the control, record
   that expected disabled state instead of bypassing it.
5. Restore network after 3 seconds.

PASS: the latest accepted camera intent wins after recovery. A disabled control
during reconnect is acceptable; a stale or opposite camera state is not.

#### REC-08 and REC-09: End during reconnect

1. Disable receiver network for 3 seconds.
2. While reconnecting, end from the still-connected caller for REC-08.
3. Repeat a new call and end from the reconnecting receiver for REC-09.
4. Restore network.

PASS: terminal state wins, no late producer appears, and neither call returns.

#### REC-10: Wi-Fi/cellular handover

1. Start with both devices on Wi-Fi.
2. Disable Wi-Fi on iPhone while leaving cellular enabled.
3. Wait for media recovery.
4. Re-enable Wi-Fi.
5. Repeat on Android.

PASS: the call remains the same session and bidirectional media recovers after
each handover.

#### REC-11 and REC-12: Process death during active call

1. Start an active VIDEO call.
2. Terminate the receiver process using the development/device tooling, not a
   user force-quit/Force stop action.
3. Observe the caller until the reconnect deadline expires.
4. Run once with iOS as receiver and once with Android as receiver.

PASS: the surviving peer gets bounded reconnect/terminal behavior and no
server-side call state remains after cleanup.

#### REC-13: Bluetooth route change

1. Start an active VOICE call on iPhone.
2. Connect the prepared Bluetooth audio device.
3. Confirm input/output moves to Bluetooth and speech works both ways.
4. Disconnect Bluetooth.
5. Confirm audio returns to receiver/speaker.
6. Repeat once on Android.

PASS: the call remains active and the telemetry audio route matches the visible
route transitions.

#### REC-14: VOICE/VIDEO switching

1. Start a VOICE call.
2. Switch to VIDEO and wait for both peers to converge.
3. Switch back to VOICE.
4. Repeat 5 cycles.

PASS: the call ID never changes, video resources close on VOICE, and the call
remains audible.

#### REC-15 and REC-16: Permission boundaries

Run these last because they change device settings.

1. Disable microphone permission on iOS and attempt VOICE.
2. Confirm a clear error and no ghost/native call remains.
3. Restore permission and confirm the next VOICE call succeeds.
4. Disable camera permission on Android and attempt VIDEO.
5. Confirm a clear error and no ghost/native call remains.
6. Restore permission and confirm the next VIDEO call succeeds.

PASS: denial fails closed, gives actionable feedback, and recovery works after
permission is restored.

### Step 10: Fetch call telemetry

The telemetry read endpoints require an ADMIN bearer token. Read it silently so
it does not enter shell history or the evidence document:

```sh
read -s ADMIN_BEARER_TOKEN
export ADMIN_BEARER_TOKEN
```

For each test, query a narrow UTC window around its recorded start/end:

```sh
export FROM_UTC="2026-09-21T01:00:00.000Z"
export TO_UTC="2026-09-21T01:15:00.000Z"

curl -fsS -G "$API_BASE_URL/calls/telemetry/calls" \
  -H "Authorization: Bearer $ADMIN_BEARER_TOKEN" \
  --data-urlencode "from=$FROM_UTC" \
  --data-urlencode "to=$TO_UTC" \
  > "$CALL_EVIDENCE_DIR/TEST-ID-recent.json"
```

Match the row by platform, direction, app version, and timestamp. Copy its
`callId` into a shell variable, then fetch the complete timeline:

```sh
export CALL_ID="00000000-0000-0000-0000-000000000000"

curl -fsS "$API_BASE_URL/calls/telemetry/calls/$CALL_ID" \
  -H "Authorization: Bearer $ADMIN_BEARER_TOKEN" \
  > "$CALL_EVIDENCE_DIR/TEST-ID-timeline.json"
```

For a successful call, verify both legs and confirm:

- `control_plane_active` succeeded;
- `media_ready` succeeded;
- `remote_audio_ready` succeeded;
- setup stages did not fail;
- reconnect tests contain the expected bounded reconnect/rejoin events;
- a terminal event exists with the expected reason;
- call ID, app version, platform, direction, and timestamps match the result
  row.

After all tests, fetch the aggregate summary for the whole session:

```sh
curl -fsS -G "$API_BASE_URL/calls/telemetry/summary" \
  -H "Authorization: Bearer $ADMIN_BEARER_TOKEN" \
  --data-urlencode "from=$FROM_UTC" \
  --data-urlencode "to=$TO_UTC" \
  > "$CALL_EVIDENCE_DIR/session-summary.json"
```

Use the code's existing quality flags when reviewing stable-network samples:

- packet loss rate at or above 5%;
- RTT at or above 400 ms;
- jitter at or above 50 ms;
- concealment rate at or above 3%.

These values trigger investigation. The first completed P0 run establishes the
aggregate regression baseline; do not invent a p95 target after seeing only one
call.

### Step 11: Verify Redis cleanup and process stability

Use the same Redis connection as call-service. Do not print its password. While
a call is active:

```sh
redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" \
  --pass "$REDIS_PASSWORD" --no-auth-warning \
  SCARD "call:$CALL_ID:producer-index"
redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" \
  --pass "$REDIS_PASSWORD" --no-auth-warning \
  SCARD "call:$CALL_ID:transport-index"
redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" \
  --pass "$REDIS_PASSWORD" --no-auth-warning \
  HLEN "call:$CALL_ID:participants"
```

Expected active-state counts:

| Call | Producers | Transports | Participants |
| --- | ---: | ---: | ---: |
| VOICE | 2 | 4 | 2 |
| VIDEO, both cameras on | 4 | 4 | 2 |

Within 10 seconds after a terminal outcome, run:

```sh
redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" \
  --pass "$REDIS_PASSWORD" --no-auth-warning \
  EXISTS \
  "call:$CALL_ID:room" \
  "call:$CALL_ID:participants" \
  "call:$CALL_ID:producer-index" \
  "call:$CALL_ID:transport-index"
```

Expected result: `0`. The call-session tombstone may remain intentionally; the
runtime room/participant/producer/transport state must not.

The current service does not expose an exact process-local consumer count. Do
not add a debug endpoint preemptively. Instead:

1. compare call-service RSS before and after the repeated-call batches;
2. verify RSS settles rather than increasing after every completed call;
3. verify Redis runtime state is removed;
4. open a focused instrumentation/defect task only if memory does not settle or
   media behavior suggests retained consumers.

Capture the final snapshots:

```sh
docker compose exec -T call-service node -e \
  'fetch("http://127.0.0.1:3007/metrics").then(r => r.text()).then(console.log)' \
  > "$CALL_EVIDENCE_DIR/call-metrics-after.txt"
docker stats --no-stream > "$CALL_EVIDENCE_DIR/docker-stats-after.txt"
```

### Step 12: Classify failures and rerun correctly

On the first failure:

1. stop the matrix;
2. mark the test FAIL, never blank;
3. record UTC time, test ID, call ID if available, device state, network state,
   visible symptom, and first relevant error code;
4. preserve iOS, Android, backend, telemetry, and Redis evidence;
5. classify it as `PRODUCT`, `BACKEND`, `MOBILE`, `INFRA`, or `ENVIRONMENT`;
6. do not patch code inside the evidence run.

Only an `ENVIRONMENT` failure may be rerun without a new candidate, and only
after recording its concrete cause. A product/code fix requires new pinned
revisions and these reruns:

1. all automated preflight checks;
2. the failed case;
3. SMK-01, SMK-02, SMK-07, and SMK-08;
4. any other case that shares the changed lifecycle path.

Keep failed and passing attempts. Never overwrite evidence from the original
failure.

### Step 13: Make the gate decision

Mark `PASS` only if:

- all automated preflight checks are green;
- SMK-01 through SMK-12 pass;
- TERM-01 through TERM-06 pass;
- REC-01 through REC-16 pass;
- every successful call has both telemetry legs and required stages;
- every terminal call clears native/mobile surfaces and Redis runtime state;
- no crash, timeout, ghost call, duplicate producer, or monotonic resource
  growth remains unexplained;
- the setup table, logs, timelines, aggregate summary, and defect list are
  complete.

Otherwise mark `BLOCKED` and name the exact failed test IDs. `PASS WITH KNOWN
ISSUES` is not a valid P0 outcome.

### Candidate result template

Copy this template below the runbook for each candidate:

```md
## Candidate result: YYYY-MM-DD

Final decision: PASS | BLOCKED

### Candidate

| Field | Value |
| --- | --- |
| Mobile SHA | |
| Mobile artifact/build | |
| Backend SHA/image digest | |
| Environment | |
| iPhone / iOS | |
| Android / OS | |
| Started UTC | |
| Finished UTC | |
| Operators | |

### Automated preflight

| Check | Result | Evidence |
| --- | --- | --- |
| Mobile install/typecheck/call tests/full tests/lint | | |
| Backend call/boundary tests | | |
| Backend builds | | |

### Physical tests

| Test ID | Attempt | Call ID | Result | Notes/evidence |
| --- | ---: | --- | --- | --- |
| SMK-01..12 | | | | |
| TERM-01..06 | | | | |
| REC-01..16 | | | | |

### Telemetry summary

| Metric | Value |
| --- | ---: |
| Attempts | |
| Control-plane success rate | |
| Media-ready success rate | |
| Control-plane p50/p95 ms | |
| First remote audio p50/p95 ms | |
| Bad quality sample rate | |
| Maximum reconnect duration | |

### Defects and reruns

| Defect | Classification | Original test | Fix revision | Reruns | Status |
| --- | --- | --- | --- | --- | --- |

### Decision rationale

State why every exit criterion is satisfied, or list the exact blockers.
```

## Candidate result: 2026-09-21 source-preflight

Final decision: `BLOCKED — PREFLIGHT_FAILURE`

This is a source-preflight attempt only. Physical runtime testing, signed-build
validation, deployed-environment checks, telemetry-per-call checks, and Redis
runtime checks were intentionally deferred and were not inferred.

See [the detailed blocker register](../CALL_RUNTIME_BLOCKERS.md) for root cause,
reproduction, evidence, ownership boundary, and verification criteria.

| Field | Value |
| --- | --- |
| Run ID | `call-p0-20260921T115757Z-source-preflight` |
| Mobile SHA | `34c1d819db3570d08fac5c22d74ba9f16c78085d` |
| Backend SHA | `8473c8c3e1c36773352c8f3f601b0c833816e1ad` |
| Evidence directory | `/Users/leanhquan/GitHub/.p0-evidence/call-p0-20260921T115757Z-source-preflight` |
| Physical runtime | Deferred by gate owner |

### Automated preflight

| Check | Result | Evidence |
| --- | --- | --- |
| Mobile frozen-lockfile install | PASS | `preflight/mobile-install.log` |
| Mobile type-check | PASS | `preflight/mobile-typecheck.log` |
| Mobile call-focused tests | PASS — 99 passed, 0 failed | `preflight/mobile-call-tests.log` |
| Mobile full suite | FAIL — 274 passed, 3 failed, 3 TODO | `preflight/mobile-all-tests.log` |
| Mobile lint | FAIL — 9 Prettier errors | `preflight/mobile-lint.log` |
| Backend frozen-lockfile install | PASS | `preflight/backend-install.log` |
| Backend call-service suite | PASS on permitted environment rerun — 134 passed | `preflight/backend-call-tests-attempt-02.log` |
| Backend call-boundary suite | PASS — 100 passed | `preflight/backend-call-boundary-tests.log` |
| Backend call/monitoring/notification/gateway builds | PASS | `preflight/backend-build-*.log` |
| Deployed-runtime environment checks | Deferred by gate owner | — |

The three blockers are all in
`tests/chat-optimistic-failure-lifecycle-contract.test.cjs`:

1. `failed optimistic sends settle the ordering domain in the same store transition`;
2. `optimistic updates settle anchors so media failure cannot leave newer stale anchors`;
3. `optimistic removal settles anchors so cancellation cannot leave an orphan ordering domain`.

Mobile lint has a separate blocker: 9 Prettier errors across
`app/(auth)/register.tsx`, `app/(auth)/reset-password.tsx`, `app/account.tsx`,
`src/components/chat/MessageInput.tsx`,
`src/lib/optimisticSortAnchorLifecycle.ts`, and `src/stores/chatStore.ts`.

No call-focused test failed. This gate remains blocked because P0 requires a
green full mobile suite and lint. The failures must be addressed in a separate
task and a new source-preflight run must start from `EP-00` on the new pinned
SHA. The permitted continuation collected remaining non-physical evidence only;
it did not clear either mobile failure or run deployed/physical runtime checks.

### Post-run blocker fix verification — 2026-09-21

BLK-01 and BLK-02 from the source-preflight attempt have been fixed in the
uncommitted mobile working tree. The original result above remains immutable:
this verification is not a new candidate because no replacement SHA has been
committed or pinned.

The BLK-01 fix changes only the contract-test selector so it targets the Zustand
store implementation instead of the earlier `ChatState` declarations. BLK-02
uses only the repository's existing Prettier configuration on the six files
reported by the original lint run.

Verification against the concurrently changing working tree also exposed a
newer, unrelated reaction-label contract drift. The final snapshot consistently
uses `You`/`User` in both production and its contract; the focused reaction
contract and full suite pass.

| Check | Result | Evidence |
| --- | --- | --- |
| Optimistic-failure focused contract | PASS — 3/3 | `preflight/fix-chat-optimistic-contract.log` |
| Mobile type-check | PASS | `preflight/final-working-tree-typecheck.log` |
| Mobile call-focused tests | PASS — 99/99 | `preflight/working-tree-call-tests-after-fix.log` |
| Mobile full suite | PASS — 277 passed, 0 failed, 3 TODO | `preflight/final-working-tree-full-tests.log` |
| Current source lint, excluding generated `ios/Pods/**` | PASS — 0 errors, 1 warning | `preflight/final-working-tree-source-lint.log` |
| Full `pnpm lint` on detached base plus BLK-01/02 fixes | PASS | `preflight/fix-mobile-lint.log` |

The main checkout's unfiltered `pnpm lint` is not valid release evidence while
hundreds of generated `ios/Pods/**` files are dirty: ESLint traverses a nested
Expo package there and cannot resolve that package's lint preset. A clean,
pinned worktree is therefore still mandatory for the next `EP-00` run.

P0 remains `BLOCKED` by candidate repinning and BLK-04/BLK-05. Physical runtime
testing remains deferred by request. Do not promote this working tree until a
new SHA repeats the protocol from `EP-00` and produces a separate evidence run.
