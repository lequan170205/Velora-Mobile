# Call runtime baseline and release gate

This document mirrors the backend release gate so the mobile candidate and
its compatible call-service candidate are measured against the same source
points. Missing physical-device measurements are recorded as missing rather
than inferred.

## Comparison points

| Item | Baseline before this fix | Candidate after this fix |
| --- | --- | --- |
| Backend | `87688b2942c3383cffcc5929907b1a2e90210c81` | `6b3353d064bb92322988dc8b0e02df000e7701fc` |
| Mobile | `0e7722076857e3e79625afc376dfd57b1a1b1207` | `07942a7436712241a6bf93a79f50d4d5c188f5f3` |
| Captured at | 2026-09-14, Asia/Ho_Chi_Minh | 2026-09-14, Asia/Ho_Chi_Minh |

The baseline runtime scenarios were **not captured** in this source audit. The
paired physical iPhone is now available, but the manual matrix has not been
executed; an iOS simulator cannot prove CallKit/PushKit behavior. Simulator
results therefore cannot close the physical-device gate.

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
