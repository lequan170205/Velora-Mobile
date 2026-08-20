# Velora 1:1 Video Call Implementation Plan

## Scope
- Extend the existing 1:1 voice-call pipeline; do not add group calling.
- Reuse the existing Socket.IO + Mediasoup + native system-call lifecycle.
- Support starting VIDEO calls, local preview while ringing, camera on/off, camera switching, speaker/mute/end, reconnect/rejoin, killed/background incoming calls, and VOICE <-> VIDEO conversion in the same call.
- No silent fallback when camera permission is denied.
- Backgrounding an active video call pauses local camera video while audio remains active; foreground restores video when appropriate.

## Product decisions
1. Caller opens a local camera preview immediately after starting a video call. Media is not exposed to the peer until answer/media setup completes.
2. Background: pause camera, preserve audio call.
3. Camera permission denied: block video start/upgrade/answer and show an explicit error.
4. VOICE <-> VIDEO conversion is in scope.
5. Camera-off inside a VIDEO session does not automatically downgrade to VOICE. Downgrade is an explicit action.
6. Group calls remain server-rejected and hidden in mobile UI.

## Phase 0 - Contracts and invariants
- Keep the existing callId, room, transports, signaling namespace, auth, join/answer/rejoin lifecycle.
- Generalize client `produce.kind` to audio|video.
- Add `set_call_type` / `call_type_changed` signaling for active-call upgrade/downgrade.
- Reject video producers for VOICE sessions server-side.
- Ensure unanswered timeout applies to VOICE and VIDEO.

## Phase 1 - Backend lifecycle and media primitives
- Add media-engine primitive to close a producer without closing the room/transport.
- Add server-side call-type transition use case.
- VIDEO -> VOICE closes active video producers and keeps audio producers/transports alive.
- VOICE -> VIDEO updates the active session and notifies both peers.
- Keep direct-conversation validation as the hard group-call guard.

## Phase 2 - Notifications and native call metadata
- Make notification text type-aware: voice/video.
- Preserve callType in FCM/APNs payloads.
- iOS CallKit: supportsVideo=true, incoming `hasVideo`, outgoing `isVideo` based on call type.
- Android full-screen incoming/ongoing call surfaces use callType-aware labels.

## Phase 3 - Mobile media runtime
- Generalize CallProvider without creating a second provider.
- Add `startVideoCall` and shared internal start-call implementation.
- Add camera permission handling and ringing local preview.
- Produce audio and video on the existing send transport for VIDEO sessions.
- Consume remote audio and video on the existing recv transport.
- Track producer/consumer readiness by media kind to avoid audio/video races.
- Ensure audio quality/adaptive bitrate reads only audio consumers.

## Phase 4 - Active call UI and controls
- Preserve the existing voice-call UI.
- VIDEO mode: remote RTCView full-screen + local PiP preview.
- Controls: mute, camera toggle, camera flip, speaker, switch call type, end.
- Remote camera-off fallback: avatar/name with explicit camera-off state.
- Conversation header: separate voice and video call actions for direct chats only.

## Phase 5 - VOICE <-> VIDEO conversion
- VOICE -> VIDEO: require camera permission, acquire video track, request server transition, produce video, enable video UI.
- VIDEO -> VOICE: request server transition, close local video producer/track, remove remote video consumer when peer transition arrives, preserve audio and duration.
- Camera toggle remains independent of call-type conversion.

## Phase 6 - Lifecycle/recovery/background
- Rejoin restores active audio/video producers by kind.
- ICE restart remains preferred; media-runtime rebuild restores current call type.
- Peer reconnect handles audio/video independently.
- Background pauses local camera track while preserving audio; foreground restores camera only if session is VIDEO and camera was enabled before background.
- Native cold-start answer path accepts VIDEO and proceeds through the same auth/socket/state recovery flow.

## Phase 7 - Tests and regression hardening
Backend:
- VIDEO initiate/ring/answer/active.
- VIDEO no-answer timeout.
- VIDEO audio + video produce/consume/resume.
- VOICE video-producer rejection.
- VOICE -> VIDEO -> VOICE transition.
- VIDEO downgrade closes only video media.
- rejoin activeProducers includes expected kinds.
- group conversation call initiation remains rejected.

Mobile/native contracts:
- Voice behavior unchanged.
- Video start/accept/reject/end.
- camera permission denied.
- camera toggle and front/back switch.
- VOICE <-> VIDEO conversion.
- remote camera off.
- background/foreground camera pause/restore.
- socket reconnect, ICE restart, media rebuild, peer reconnect.
- iOS/Android incoming-call metadata is type-aware.

## Completion gate
- Typecheck/lint/tests pass in both repositories.
- Existing voice-call tests remain green.
- No group-call code path is introduced.
- Manual device matrix after implementation: iOS-iOS, Android-Android, iOS-Android, Android-iOS.
