# Call runtime baseline and release gate

This document mirrors the backend release gate so the mobile candidate and
its compatible call-service candidate are measured against the same source
points. Missing physical-device measurements are recorded as missing rather
than inferred.

## Comparison points

| Item | Baseline before this fix | Candidate after this fix |
| --- | --- | --- |
| Backend | `87688b2942c3383cffcc5929907b1a2e90210c81` | `3cb70df6e9bd3b20bb7ad4f74c3de8902086f012` |
| Mobile | `0e7722076857e3e79625afc376dfd57b1a1b1207` | `f6b0b1fa2f6409cca4c821e69071ff6169ef574d` |
| Captured at | 2026-09-14, Asia/Ho_Chi_Minh | 2026-09-14, Asia/Ho_Chi_Minh |

The baseline runtime scenarios were **not captured** in this source audit. The
paired physical iPhone was available earlier, but the manual matrix has not
been executed; an iOS simulator cannot prove CallKit/PushKit behavior. The
final source tips above are the merged release candidates, not the earlier
pre-merge test SHAs.

## Candidate build evidence

- The final merged iPhone 17 simulator candidate built, installed and launched
  successfully with `npx expo run:ios --device "iPhone 17" --no-bundler`.
- The final merged Debug `iphoneos` candidate built successfully with Xcode.
  A final reinstall was not completed because CoreDevice reported the paired
  iPhone as unavailable; the earlier pre-merge install is not counted as final
  evidence.
- These are compile/install checks only. No call, network-loss, camera-toggle
  or CallKit measurements are inferred from them; the physical matrix below
  remains pending.

## Backend deployment gate

- The compatible backend source candidate is
  `3cb70df6e9bd3b20bb7ad4f74c3de8902086f012`; its Homelab CI/CD validation and
  promotion completed successfully.
- The server has not restarted the call-service container because its disk
  guard reports 14–15 GB free and requires at least 20 GB. Runtime evidence
  must therefore wait until the container reports the candidate SHA.

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
