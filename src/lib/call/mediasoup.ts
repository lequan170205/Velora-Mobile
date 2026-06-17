import { Device } from 'mediasoup-client'
import { registerGlobals } from 'react-native-webrtc'

import type { TransportCreatedPayload } from '../../types/call.types'
import type * as MediasoupTypes from 'mediasoup-client/types'

let globalsRegistered = false

export const ensureMediasoupGlobalsRegistered = () => {
  if (globalsRegistered) {
    return
  }

  registerGlobals()
  globalsRegistered = true
}

export const createMediasoupDevice = () => {
  ensureMediasoupGlobalsRegistered()
  return new Device({ handlerName: 'ReactNative106' })
}

export const toRouterRtpCapabilities = (value: Record<string, unknown>) => {
  return value as unknown as MediasoupTypes.RtpCapabilities
}

export const toDtlsParameters = (value: Record<string, unknown>) => {
  return value as unknown as MediasoupTypes.DtlsParameters
}

export const toTransportOptions = (
  payload: TransportCreatedPayload,
): MediasoupTypes.TransportOptions<Record<string, unknown>> => {
  return {
    id: payload.transportId,
    iceParameters: payload.iceParameters as unknown as MediasoupTypes.IceParameters,
    iceCandidates: payload.iceCandidates as unknown as MediasoupTypes.IceCandidate[],
    dtlsParameters: payload.dtlsParameters as unknown as MediasoupTypes.DtlsParameters,
  }
}
