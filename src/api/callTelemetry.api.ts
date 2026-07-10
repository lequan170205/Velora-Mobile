import { apiClient } from './client'

import type { CallTelemetryEvent } from '../lib/call/callTelemetry'

export const callTelemetryApi = {
  track: async (events: CallTelemetryEvent[]) => {
    await apiClient.post('/calls/telemetry/events', { events }, { timeout: 5000 })
  },
}
