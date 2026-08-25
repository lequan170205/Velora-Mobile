export type RtcQualityCounters = {
  packetsLost: number | null
  packetsReceived: number | null
  bytesReceived: number | null
  concealedSamples: number | null
  totalSamples: number | null
  jitterBufferDelay: number | null
  jitterBufferEmittedCount: number | null
}

export type RtcQualityStreak = {
  degraded: number
  healthy: number
}

export const normalizeRtcStatsEntries = (report: RTCStatsReport | unknown) => {
  if (report instanceof Map) {
    return [...report.values()] as Record<string, unknown>[]
  }

  if (Array.isArray(report)) {
    return report as Record<string, unknown>[]
  }

  if (report && typeof report === 'object') {
    return Object.values(report as Record<string, unknown>).filter(
      (value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'),
    )
  }

  return []
}

export const pickRtcStat = (entries: Record<string, unknown>[], type: string, kind = 'audio') =>
  entries.find(
    (entry) =>
      entry.type === type &&
      (entry.kind === kind ||
        entry.mediaType === kind ||
        entry.id === kind ||
        typeof entry.id !== 'string'),
  ) ?? null

export const summarizeRtcStatsReport = (report: RTCStatsReport | unknown) => {
  const entries = normalizeRtcStatsEntries(report)
  const outboundRtp = pickRtcStat(entries, 'outbound-rtp')
  const inboundRtp = pickRtcStat(entries, 'inbound-rtp')
  const remoteInboundRtp = pickRtcStat(entries, 'remote-inbound-rtp')
  const track = pickRtcStat(entries, 'track')
  const mediaSource = pickRtcStat(entries, 'media-source')
  const candidatePair =
    entries.find(
      (entry) =>
        entry.type === 'candidate-pair' &&
        (entry.selected === true || entry.nominated === true || entry.state === 'succeeded'),
    ) ?? null

  return {
    entryCount: entries.length,
    outboundRtp: outboundRtp && {
      packetsSent: outboundRtp.packetsSent,
      bytesSent: outboundRtp.bytesSent,
      retransmittedPacketsSent: outboundRtp.retransmittedPacketsSent,
      retransmittedBytesSent: outboundRtp.retransmittedBytesSent,
      targetBitrate: outboundRtp.targetBitrate,
      totalPacketSendDelay: outboundRtp.totalPacketSendDelay,
    },
    inboundRtp: inboundRtp && {
      packetsReceived: inboundRtp.packetsReceived,
      bytesReceived: inboundRtp.bytesReceived,
      packetsLost: inboundRtp.packetsLost,
      jitter: inboundRtp.jitter,
      audioLevel: inboundRtp.audioLevel,
      totalAudioEnergy: inboundRtp.totalAudioEnergy,
      totalSamplesDuration: inboundRtp.totalSamplesDuration,
    },
    remoteInboundRtp: remoteInboundRtp && {
      packetsLost: remoteInboundRtp.packetsLost,
      roundTripTime: remoteInboundRtp.roundTripTime,
      jitter: remoteInboundRtp.jitter,
    },
    track: track && {
      audioLevel: track.audioLevel,
      totalAudioEnergy: track.totalAudioEnergy,
      totalSamplesDuration: track.totalSamplesDuration,
      jitterBufferDelay: track.jitterBufferDelay,
      jitterBufferEmittedCount: track.jitterBufferEmittedCount,
      concealedSamples: track.concealedSamples,
      silentConcealedSamples: track.silentConcealedSamples,
    },
    mediaSource: mediaSource && {
      audioLevel: mediaSource.audioLevel,
      totalAudioEnergy: mediaSource.totalAudioEnergy,
      totalSamplesDuration: mediaSource.totalSamplesDuration,
    },
    candidatePair: candidatePair && {
      state: candidatePair.state,
      nominated: candidatePair.nominated,
      selected: candidatePair.selected,
      bytesSent: candidatePair.bytesSent,
      bytesReceived: candidatePair.bytesReceived,
      currentRoundTripTime: candidatePair.currentRoundTripTime,
    },
  }
}

export const getRtcQualityCounters = (report: RTCStatsReport | unknown): RtcQualityCounters => {
  const entries = normalizeRtcStatsEntries(report)
  const inbound = pickRtcStat(entries, 'inbound-rtp')
  const track = pickRtcStat(entries, 'track')

  const asNumber = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : null

  return {
    packetsLost: asNumber(inbound?.packetsLost),
    packetsReceived: asNumber(inbound?.packetsReceived),
    bytesReceived: asNumber(inbound?.bytesReceived),
    concealedSamples: asNumber(track?.concealedSamples),
    totalSamples: asNumber(track?.totalSamplesReceived ?? track?.totalSamplesDuration),
    jitterBufferDelay: asNumber(track?.jitterBufferDelay),
    jitterBufferEmittedCount: asNumber(track?.jitterBufferEmittedCount),
  }
}
