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
