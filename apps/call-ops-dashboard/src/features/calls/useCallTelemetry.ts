import { useCallback, useEffect, useState } from 'react'

import {
  defaultCallTelemetryFilters,
  fetchCallSummary,
  fetchCallTimeline,
  fetchRecentCallLegs,
  type CallSummary,
  type CallTelemetryFilters,
  type CallTimelineEvent,
  type RecentCallLeg,
} from './api'

export function useCallTelemetry(enabled: boolean) {
  const [filters, setFilters] = useState<CallTelemetryFilters>(defaultCallTelemetryFilters)
  const [summary, setSummary] = useState<CallSummary | null>(null)
  const [recentCallLegs, setRecentCallLegs] = useState<RecentCallLeg[]>([])
  const [timeline, setTimeline] = useState<CallTimelineEvent[]>([])
  const [callId, setCallId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const loadOverview = useCallback(async () => {
    const [nextSummary, nextRecentCallLegs] = await Promise.all([
      fetchCallSummary(filters),
      fetchRecentCallLegs(filters),
    ])
    setSummary(nextSummary)
    setRecentCallLegs(nextRecentCallLegs)
  }, [filters])

  useEffect(() => {
    if (!enabled) return
    void loadOverview().catch((nextError: Error) => setError(nextError.message))
  }, [enabled, loadOverview])

  const updateFilter = <Key extends keyof CallTelemetryFilters>(
    key: Key,
    value: CallTelemetryFilters[Key],
  ) => {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  const applyFilters = () => {
    setError(null)
    void loadOverview().catch((nextError: Error) => setError(nextError.message))
  }

  const loadTimeline = async (nextCallId: string) => {
    if (!nextCallId.trim()) return
    setError(null)

    try {
      setTimeline(await fetchCallTimeline(nextCallId))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to load call telemetry')
    }
  }

  const inspectCall = (nextCallId: string) => {
    setCallId(nextCallId)
    void loadTimeline(nextCallId)
  }

  const reset = useCallback(() => {
    setSummary(null)
    setRecentCallLegs([])
    setTimeline([])
    setCallId('')
    setError(null)
  }, [])

  return {
    filters,
    updateFilter,
    summary,
    recentCallLegs,
    timeline,
    callId,
    setCallId,
    error,
    setError,
    applyFilters,
    loadTimeline,
    inspectCall,
    reset,
  }
}
