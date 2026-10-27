export const CALL_JOINED_TIMEOUT_MS = 10_000
export const GROUP_LIFECYCLE_VERSION = 3
// This is read once while the JS bundle initializes. Operators can bake
// EXPO_PUBLIC_CALL_ATOMIC_ACCEPT_ENABLED=false into a rollback build without
// putting a remote-config request on the cold incoming-call path.
export const ATOMIC_INCOMING_CALL_ACCEPT_ENABLED =
  process.env.EXPO_PUBLIC_CALL_ATOMIC_ACCEPT_ENABLED?.trim().toLowerCase() !== 'false'
// Keep the native answer watchdog bounded while still allowing one
// idempotent retry when the server committed but its first acknowledgement was
// lost on the wire.
export const INCOMING_ACCEPT_ACK_TIMEOUT_MS = 6_000
export const INCOMING_ACCEPT_MAX_ATTEMPTS = 2
export const INCOMING_ACCEPT_RETRY_DELAY_MS = 250
export const SOCKET_CONNECT_TIMEOUT_MS = 10_000
// Keep the control-plane grace longer than the backend's default reconnect
// window. A short Socket.IO interruption must not tear down CoreAudio or the
// existing mediasoup transports before the client has had a chance to rejoin.
// 30 s covers a ~12 s Wi-Fi drop: the phone needs a few more seconds to get
// a working network back, and one reconnect (token, TLS, auth) takes ~5 s.
// The server only notices a silent client after its ping timeout, so it still
// holds the seat for this long.
export const SOCKET_DISCONNECT_GRACE_MS = 30_000
// Pause between reconnect attempts inside that grace window.
export const SOCKET_RECONNECT_RETRY_MS = 1_000
export const IOS_AUDIO_SESSION_READY_TIMEOUT_MS = 15_000
export const IOS_AUDIO_SESSION_SNAPSHOT_POLL_MS = 250
export const TRANSPORT_CREATED_TIMEOUT_MS = 10_000
export const TRANSPORT_CONNECTED_TIMEOUT_MS = 10_000
export const CONSUMER_CREATED_TIMEOUT_MS = 10_000
export const CONSUMER_RESUMED_TIMEOUT_MS = 10_000
export const DEFAULT_CALL_NO_ANSWER_TIMEOUT_MS = 30_000
export const getOutgoingRingWaitTimeoutMs = (noAnswerTimeoutMs?: number) =>
  (noAnswerTimeoutMs && noAnswerTimeoutMs > 0
    ? noAnswerTimeoutMs
    : DEFAULT_CALL_NO_ANSWER_TIMEOUT_MS) + CALL_JOINED_TIMEOUT_MS
export const REMOTE_PRODUCER_TIMEOUT_MS = 30_000
export const REMOTE_AUDIO_WAIT_FALLBACK_MS = 10_000
export const RTC_STATS_LOG_DELAY_MS = 1_500
export const RTC_QUALITY_SAMPLE_INTERVAL_MS = 10_000
export const AUDIO_FLOW_CONFIRMATION_DELAY_MS = 1_000
export const PEER_LEFT_GRACE_MS = 750
export const MEDIA_TRANSPORT_DISCONNECT_GRACE_MS = 3_000
export const DEFAULT_RECONNECT_GRACE_MS = 15_000
export const AUDIO_BITRATE_UPDATE_TIMEOUT_MS = 5_000
export const VIDEO_STATE_UPDATED_TIMEOUT_MS = 5_000
// Camera state is a control-plane command. Keep retries short and bounded so
// a lost acknowledgement never triggers a media transport rebuild or an
// unbounded command storm.
export const VIDEO_STATE_MAX_ATTEMPTS = 3
export const VIDEO_STATE_RETRY_DELAY_MS = 250
export const VIDEO_STATE_RETRY_DELAY_MAX_MS = 2_000
// A remote consumer can be recreated while the peer is recovering, but only
// for a finite window. Terminal room/producer errors are filtered separately.
export const REMOTE_CONSUMER_MAX_RETRY_ATTEMPTS = 4
export const REMOTE_CONSUMER_RETRY_DELAY_MS = 250
export const REMOTE_CONSUMER_RETRY_DELAY_MAX_MS = 4_000
export const AUDIO_BITRATE_RETRY_DELAY_MS = 30_000
export const AUDIO_QUALITY_DEGRADED_PACKET_LOSS_RATE = 0.05
export const AUDIO_QUALITY_HEALTHY_PACKET_LOSS_RATE = 0.02
export const AUDIO_QUALITY_DEGRADED_JITTER_MS = 60
export const AUDIO_QUALITY_HEALTHY_JITTER_MS = 30
export const AUDIO_QUALITY_DEGRADE_SAMPLE_COUNT = 2
export const AUDIO_QUALITY_RECOVER_SAMPLE_COUNT = 3
export const VOICE_OPUS_CODEC_OPTIONS = {
  opusFec: true,
  opusDtx: true,
  opusNack: true,
  opusMaxAverageBitrate: 48_000,
}
export const CALL_SETUP_CANCELLED_ERROR = 'Call setup was cancelled'
export const RECONNECT_RECOVERY_TIMEOUT_MS = (() => {
  const configured = Number(process.env.EXPO_PUBLIC_CALL_RECONNECT_GRACE_MS)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_RECONNECT_GRACE_MS
})()
