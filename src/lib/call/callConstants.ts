export const CALL_JOINED_TIMEOUT_MS = 10_000
export const SOCKET_CONNECT_TIMEOUT_MS = 10_000
export const SOCKET_DISCONNECT_GRACE_MS = 10_000
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
