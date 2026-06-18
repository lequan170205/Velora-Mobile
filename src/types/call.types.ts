import type { Socket } from 'socket.io-client'

export type CallPhase =
  | 'idle'
  | 'outgoing_ringing'
  | 'incoming_ringing'
  | 'connecting'
  | 'reconnecting'
  | 'active'
  | 'ending'

export type CallDirection = 'outgoing' | 'incoming'
export type CallType = 'VOICE' | 'VIDEO'
export type RemoteAudioState = 'idle' | 'waiting' | 'connected'

export interface CallSessionPayload {
  callId: string
  conversationId: string
  initiatorId: string
  targetUserId: string
  callType: CallType
  status: 'initiated' | 'ringing' | 'active' | 'cancelled' | 'ended' | 'rejected'
  participantIds: string[]
  answeredAt?: string
  endedAt?: string
  createdAt: string
  updatedAt: string
}

export interface InitiateCallPayload {
  conversationId: string
  targetUserId: string
  callType: CallType
}

export interface JoinCallPayload {
  callId: string
}

export interface RejectCallPayload {
  callId: string
  reason?: string
}

export interface RejoinCallPayload {
  callId: string
}

export interface LeaveCallPayload {
  callId: string
  reason?: string
}

export interface CreateTransportPayload {
  callId: string
  direction: 'send' | 'recv'
}

export interface ConnectTransportPayload {
  callId: string
  transportId: string
  dtlsParameters: Record<string, unknown>
}

export interface ProducePayload {
  callId: string
  transportId: string
  kind: 'audio'
  rtpParameters: Record<string, unknown>
}

export interface ConsumePayload {
  callId: string
  transportId: string
  producerId: string
  rtpCapabilities: Record<string, unknown>
}

export interface ResumeConsumerPayload {
  callId: string
  consumerId: string
}

export interface IncomingCallPayload {
  callId: string
  conversationId: string
  initiatorId: string
  targetUserId: string
  callType: CallType
}

export interface CallJoinedPayload {
  callId: string
  role: 'host' | 'guest'
  session: CallSessionPayload
  rtpCapabilities: Record<string, unknown>
}

export interface CallRejoinedPayload {
  callId: string
  role: 'host' | 'guest'
  session: CallSessionPayload
  rtpCapabilities: Record<string, unknown>
}

export interface NewPeerPayload {
  callId: string
  userId: string
}

export interface TransportCreatedPayload {
  callId: string
  transportId: string
  direction: 'send' | 'recv'
  iceParameters: Record<string, unknown>
  iceCandidates: unknown[]
  dtlsParameters: Record<string, unknown>
}

export interface TransportConnectedPayload {
  callId: string
  transportId: string
}

export interface NewProducerPayload {
  callId: string
  userId: string
  producerId: string
  kind: 'audio' | 'video'
}

export interface ConsumerCreatedPayload {
  callId: string
  consumerId: string
  producerId: string
  kind: 'audio' | 'video'
  rtpParameters: Record<string, unknown>
}

export interface ConsumerResumedPayload {
  callId: string
  consumerId: string
}

export interface CallAnsweredPayload {
  callId: string
  userId: string
}

export interface CallRejectedPayload {
  callId: string
  userId: string
  reason: string
}

export interface PeerLeftPayload {
  callId: string
  userId: string
  reason: string
}

export interface PeerReconnectingPayload {
  callId: string
  userId: string
  reconnectDeadlineAt: string
}

export interface PeerReconnectedPayload {
  callId: string
  userId: string
}

export interface CallEndedPayload {
  callId: string
  reason: string
}

export interface SocketExceptionPayload {
  status: string
  message: string
}

export interface CallServerEvents {
  incoming_call: (payload: IncomingCallPayload) => void
  call_joined: (payload: CallJoinedPayload) => void
  call_rejoined: (payload: CallRejoinedPayload) => void
  new_peer: (payload: NewPeerPayload) => void
  transport_created: (payload: TransportCreatedPayload) => void
  transport_connected: (payload: TransportConnectedPayload) => void
  new_producer: (payload: NewProducerPayload) => void
  consumer_created: (payload: ConsumerCreatedPayload) => void
  consumer_resumed: (payload: ConsumerResumedPayload) => void
  call_answered: (payload: CallAnsweredPayload) => void
  call_rejected: (payload: CallRejectedPayload) => void
  peer_reconnecting: (payload: PeerReconnectingPayload) => void
  peer_reconnected: (payload: PeerReconnectedPayload) => void
  peer_left: (payload: PeerLeftPayload) => void
  call_ended: (payload: CallEndedPayload) => void
  exception: (payload: SocketExceptionPayload) => void
}

export interface CallClientEvents {
  initiate_call: (payload: InitiateCallPayload) => void
  join_call: (payload: JoinCallPayload) => void
  rejoin_call: (payload: RejoinCallPayload) => void
  answer_call: (payload: JoinCallPayload) => void
  reject_call: (payload: RejectCallPayload) => void
  leave_call: (payload: LeaveCallPayload) => void
  create_transport: (payload: CreateTransportPayload) => void
  connect_transport: (payload: ConnectTransportPayload) => void
  produce: (payload: ProducePayload) => void
  consume: (payload: ConsumePayload) => void
  resume_consumer: (payload: ResumeConsumerPayload) => void
}

export type CallSocket = Socket<CallServerEvents, CallClientEvents>

export interface CallUiState {
  phase: CallPhase
  direction: CallDirection | null
  callId: string | null
  conversationId: string | null
  peerUserId: string | null
  peerName: string | null
  peerAvatarUrl: string | null
  callType: CallType | null
  muted: boolean
  hasMicPermission: boolean | null
  error: string | null
  durationSec: number
  remoteAudioState: RemoteAudioState
  reconnectDeadlineMs: number | null
}

export interface StartVoiceCallInput {
  conversationId: string
  peerUserId: string
  peerName?: string
  peerAvatarUrl?: string
}

export interface UseCallValue {
  startVoiceCall: (input: StartVoiceCallInput) => Promise<void>
  acceptIncomingCall: () => Promise<void>
  rejectIncomingCall: () => Promise<void>
  endCall: (reason?: string) => Promise<void>
  toggleMute: () => void
  dismissCallError: () => void
}
