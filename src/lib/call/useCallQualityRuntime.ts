import { useCallback } from 'react'

import { useCallStore } from '../../stores/callStore'

import {
  AUDIO_BITRATE_RETRY_DELAY_MS,
  AUDIO_BITRATE_UPDATE_TIMEOUT_MS,
  AUDIO_FLOW_CONFIRMATION_DELAY_MS,
  AUDIO_QUALITY_DEGRADED_JITTER_MS,
  AUDIO_QUALITY_DEGRADED_PACKET_LOSS_RATE,
  AUDIO_QUALITY_DEGRADE_SAMPLE_COUNT,
  AUDIO_QUALITY_HEALTHY_JITTER_MS,
  AUDIO_QUALITY_HEALTHY_PACKET_LOSS_RATE,
  AUDIO_QUALITY_RECOVER_SAMPLE_COUNT,
  RTC_STATS_LOG_DELAY_MS,
} from './callConstants'
import { emitAndWaitForEvent, isCallWaitCancelledError } from './callSocket'
import {
  getRtcQualityCounters,
  normalizeRtcStatsEntries,
  pickRtcStat,
  summarizeRtcStatsReport,
} from './rtcStats'

import type { CallWaitRegistry } from './callSocket'
import type { CallTelemetrySession } from './callTelemetry'
import type { RtcQualityCounters, RtcQualityStreak } from './rtcStats'
import type { CallSocket, AudioBitrateProfile } from '../../types/call.types'
import type * as MediasoupTypes from 'mediasoup-client/types'

type MutableRef<T> = { current: T }

type CallQualityRuntimeOptions = {
  socketRef: MutableRef<CallSocket | null>
  recvTransportRef: MutableRef<MediasoupTypes.Transport<Record<string, unknown>> | null>
  connectedTransportIdsRef: MutableRef<Set<string>>
  waitRegistryRef: MutableRef<CallWaitRegistry>
  telemetrySessionRef: MutableRef<CallTelemetrySession | null>
  consumerMapRef: MutableRef<Map<string, MediasoupTypes.Consumer<Record<string, unknown>>>>
  rtcQualityCountersRef: MutableRef<RtcQualityCounters | null>
  rtcQualityStreakRef: MutableRef<RtcQualityStreak>
  incomingAudioBitrateProfileRef: MutableRef<AudioBitrateProfile>
  incomingAudioBitrateUpdateInFlightRef: MutableRef<boolean>
  incomingAudioBitrateRetryAfterMsRef: MutableRef<number>
  audioFlowingRef: MutableRef<boolean>
  audioFlowConfirmationTimeoutRef: MutableRef<ReturnType<typeof setTimeout> | null>
  activeCallIdRef: MutableRef<string | null>
  clearAudioFlowConfirmation: () => void
}

const debugCall = (...args: Parameters<typeof console.warn>) => {
  if (__DEV__) console.warn(...args)
}

export const useCallQualityRuntime = ({
  socketRef,
  recvTransportRef,
  connectedTransportIdsRef,
  waitRegistryRef,
  telemetrySessionRef,
  consumerMapRef,
  rtcQualityCountersRef,
  rtcQualityStreakRef,
  incomingAudioBitrateProfileRef,
  incomingAudioBitrateUpdateInFlightRef,
  incomingAudioBitrateRetryAfterMsRef,
  audioFlowingRef,
  audioFlowConfirmationTimeoutRef,
  activeCallIdRef,
  clearAudioFlowConfirmation,
}: CallQualityRuntimeOptions) => {
  const scheduleRtcStatsLog = useCallback(
    ({
      callId,
      label,
      mediaId,
      getStats,
    }: {
      callId: string
      label: string
      mediaId: string
      getStats: () => Promise<RTCStatsReport>
    }) => {
      if (!__DEV__) return

      setTimeout(() => {
        void (async () => {
          try {
            const stats = await getStats()
            console.warn(
              `[Call] ${label} stats`,
              JSON.stringify({
                callId,
                mediaId,
                at: new Date().toISOString(),
                timestampMs: Date.now(),
                summary: summarizeRtcStatsReport(stats),
              }),
            )
          } catch (error) {
            console.warn(
              `[Call] Failed to read ${label} stats`,
              JSON.stringify({
                callId,
                mediaId,
                error: error instanceof Error ? error.message : 'unknown_error',
              }),
            )
          }
        })()
      }, RTC_STATS_LOG_DELAY_MS)
    },
    [],
  )

  const requestIncomingAudioBitrateProfile = useCallback(
    async (profile: AudioBitrateProfile) => {
      const state = useCallStore.getState()
      const socket = socketRef.current
      const recvTransport = recvTransportRef.current

      if (
        state.phase !== 'active' ||
        !state.callId ||
        !socket?.connected ||
        !recvTransport ||
        !connectedTransportIdsRef.current.has(recvTransport.id) ||
        profile === incomingAudioBitrateProfileRef.current ||
        incomingAudioBitrateUpdateInFlightRef.current ||
        Date.now() < incomingAudioBitrateRetryAfterMsRef.current
      ) {
        return
      }

      incomingAudioBitrateUpdateInFlightRef.current = true
      const callId = state.callId
      const transportId = recvTransport.id

      try {
        await emitAndWaitForEvent(
          socket,
          'set_audio_bitrate',
          { callId, transportId, profile },
          {
            event: 'audio_bitrate_updated',
            timeoutMs: AUDIO_BITRATE_UPDATE_TIMEOUT_MS,
            registry: waitRegistryRef.current,
            filter: (payload) =>
              payload.callId === callId &&
              payload.transportId === transportId &&
              payload.profile === profile,
          },
        )

        if (
          activeCallIdRef.current !== callId ||
          recvTransportRef.current?.id !== transportId ||
          useCallStore.getState().phase !== 'active'
        ) {
          return
        }

        incomingAudioBitrateProfileRef.current = profile
        incomingAudioBitrateRetryAfterMsRef.current = 0
        telemetrySessionRef.current?.record(`incoming_audio_bitrate_${profile}`, {
          outcome: 'succeeded',
        })
      } catch (error) {
        if (isCallWaitCancelledError(error)) return
        incomingAudioBitrateRetryAfterMsRef.current = Date.now() + AUDIO_BITRATE_RETRY_DELAY_MS
        debugCall(
          '[Call] Failed to update incoming audio bitrate',
          JSON.stringify({
            callId,
            transportId,
            profile,
            error: error instanceof Error ? error.message : 'unknown_error',
          }),
        )
      } finally {
        incomingAudioBitrateUpdateInFlightRef.current = false
      }
    },
    [
      activeCallIdRef,
      connectedTransportIdsRef,
      incomingAudioBitrateProfileRef,
      incomingAudioBitrateRetryAfterMsRef,
      incomingAudioBitrateUpdateInFlightRef,
      recvTransportRef,
      socketRef,
      telemetrySessionRef,
      waitRegistryRef,
    ],
  )

  const adaptIncomingAudioBitrate = useCallback(
    ({ packetLossRate, jitterMs }: { packetLossRate: number | null; jitterMs: number | null }) => {
      const isDegraded =
        (packetLossRate !== null && packetLossRate >= AUDIO_QUALITY_DEGRADED_PACKET_LOSS_RATE) ||
        (jitterMs !== null && jitterMs >= AUDIO_QUALITY_DEGRADED_JITTER_MS)
      const isHealthy =
        packetLossRate !== null &&
        jitterMs !== null &&
        packetLossRate < AUDIO_QUALITY_HEALTHY_PACKET_LOSS_RATE &&
        jitterMs < AUDIO_QUALITY_HEALTHY_JITTER_MS
      const streak = rtcQualityStreakRef.current

      if (isDegraded) {
        streak.degraded += 1
        streak.healthy = 0
        if (streak.degraded >= AUDIO_QUALITY_DEGRADE_SAMPLE_COUNT) {
          streak.degraded = 0
          if (incomingAudioBitrateProfileRef.current === 'normal') {
            void requestIncomingAudioBitrateProfile('constrained')
          }
        }
        return
      }

      if (isHealthy) {
        streak.healthy += 1
        streak.degraded = 0
        if (streak.healthy >= AUDIO_QUALITY_RECOVER_SAMPLE_COUNT) {
          streak.healthy = 0
          if (incomingAudioBitrateProfileRef.current === 'constrained') {
            void requestIncomingAudioBitrateProfile('normal')
          }
        }
        return
      }

      streak.degraded = 0
      streak.healthy = 0
    },
    [incomingAudioBitrateProfileRef, requestIncomingAudioBitrateProfile, rtcQualityStreakRef],
  )

  const sampleRtcQuality = useCallback(async () => {
    const telemetry = telemetrySessionRef.current
    const consumer = [...consumerMapRef.current.values()].find(
      (candidate) => candidate.kind === 'audio',
    ) as MediasoupTypes.Consumer | undefined
    if (!telemetry || !consumer) return

    try {
      const report = await consumer.getStats()
      const entries = normalizeRtcStatsEntries(report)
      const inbound = pickRtcStat(entries, 'inbound-rtp')
      const remoteInbound = pickRtcStat(entries, 'remote-inbound-rtp')
      const candidatePair =
        entries.find(
          (entry) =>
            entry.type === 'candidate-pair' &&
            (entry.selected === true || entry.nominated === true || entry.state === 'succeeded'),
        ) ?? null
      const counters = getRtcQualityCounters(report)
      const previous = rtcQualityCountersRef.current
      rtcQualityCountersRef.current = counters
      const delta = (current: number | null, before: number | null) =>
        current === null || before === null ? null : Math.max(0, current - before)
      const lost = delta(counters.packetsLost, previous?.packetsLost ?? null)
      const received = delta(counters.packetsReceived, previous?.packetsReceived ?? null)
      const receivedBytes = delta(counters.bytesReceived, previous?.bytesReceived ?? null)
      const concealed = delta(counters.concealedSamples, previous?.concealedSamples ?? null)
      const samples = delta(counters.totalSamples, previous?.totalSamples ?? null)
      const jitterDelay = delta(counters.jitterBufferDelay, previous?.jitterBufferDelay ?? null)
      const jitterEmitted = delta(
        counters.jitterBufferEmittedCount,
        previous?.jitterBufferEmittedCount ?? null,
      )
      const numberValue = (value: unknown) =>
        typeof value === 'number' && Number.isFinite(value) ? value : null
      const jitter = numberValue(inbound?.jitter)
      const roundTripTime =
        numberValue(remoteInbound?.roundTripTime) ??
        numberValue(candidatePair?.currentRoundTripTime)
      const packetLossRate =
        lost === null || received === null || lost + received === 0
          ? null
          : lost / (lost + received)
      const jitterMs = jitter === null ? null : jitter * 1000

      if (telemetrySessionRef.current !== telemetry || !consumerMapRef.current.has(consumer.id)) {
        return
      }

      telemetry.record('audio_quality', {
        eventType: 'quality_sample',
        metrics: {
          packetLossRate,
          jitterMs,
          roundTripTimeMs: roundTripTime === null ? null : roundTripTime * 1000,
          concealmentRate:
            concealed === null || samples === null || concealed + samples === 0
              ? null
              : concealed / (concealed + samples),
          jitterBufferDelayMs:
            jitterDelay === null || jitterEmitted === null || jitterEmitted === 0
              ? null
              : (jitterDelay / jitterEmitted) * 1000,
          packetsReceivedDelta: received,
          bytesReceivedDelta: receivedBytes,
        },
      })

      adaptIncomingAudioBitrate({ packetLossRate, jitterMs })
      if (
        !audioFlowingRef.current &&
        ((received !== null && received > 0) || (receivedBytes !== null && receivedBytes > 0))
      ) {
        audioFlowingRef.current = true
        telemetry.record('audio_flowing', { outcome: 'succeeded' })
        telemetry.record('media_ready', { outcome: 'succeeded' })
      }
    } catch {
      // Stats are optional diagnostic data and must never affect call media.
    }
  }, [
    adaptIncomingAudioBitrate,
    audioFlowingRef,
    consumerMapRef,
    rtcQualityCountersRef,
    telemetrySessionRef,
  ])

  const confirmAudioFlow = useCallback(() => {
    void sampleRtcQuality()
    clearAudioFlowConfirmation()
    audioFlowConfirmationTimeoutRef.current = setTimeout(() => {
      audioFlowConfirmationTimeoutRef.current = null
      void sampleRtcQuality()
    }, AUDIO_FLOW_CONFIRMATION_DELAY_MS)
  }, [audioFlowConfirmationTimeoutRef, clearAudioFlowConfirmation, sampleRtcQuality])

  return { scheduleRtcStatsLog, sampleRtcQuality, confirmAudioFlow }
}
