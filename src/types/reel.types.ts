export type ReelVisibility = 'public' | 'private'

export type AllowedVideoType = 'video/mp4' | 'video/webm' | 'video/quicktime'
export type ReelProcessingState = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

export interface ReelAuthor {
  id: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  isVerified: boolean | null
}

export interface Reel {
  id: string
  userId: string
  mediaKey: string
  title?: string
  description?: string
  tags: string[]
  status: ReelProcessingState
  visibility: ReelVisibility
  viewCount: number
  thumbnailKey?: string
  thumbnailUrl?: string
  localThumbnailUri?: string
  processingStage?: string
  processingMessage?: string
  processingProgress?: number
  stage?: string
  message?: string
  progress?: number
  streamUrl: string
  createdAt: string
  author?: ReelAuthor | null
}

export interface ReelDetail extends Reel {
  description?: string
  transcript?: string
}

export interface ListReelsParams {
  userId?: string
  visibility?: ReelVisibility
  limit?: number
  cursor?: string
}

export interface ListReelsResponse {
  items: Reel[]
  nextCursor?: string | null
}

export type ReelContextSource = 'profile'

export interface ReelContextParams {
  source?: ReelContextSource
  before?: number
  after?: number
}

export interface ReelContextScope {
  userId: string
  visibility: ReelVisibility
}

export interface ReelContextResponse {
  source: ReelContextSource
  scope: ReelContextScope
  selectedId: string
  selectedIndex: number
  items: Reel[]
  previousCursor?: string | null
  nextCursor?: string | null
}

export interface CreateReelPayload {
  mediaKey: string
  title: string
  description: string
  tags: string[]
}

export interface UpdateReelPayload {
  title?: string
  description?: string
  tags?: string[]
  visibility?: ReelVisibility
}

export interface ShareReelPayload {
  conversationId: string
  sharedWithUserId?: string
}

export interface ReelShareMessagePayload {
  id: string
  conversationId: string
  senderId: string
  content: string
  type: string
  media?: unknown
  createdAt: string
  createdAtMs?: number
}

export interface ReelShareResponse {
  id: string
  reelId: string
  ownerId: string
  sharedByUserId: string
  sharedWithUserId?: string | null
  conversationId: string
  messageId?: string | null
  createdAt: string
  message?: ReelShareMessagePayload
}

export interface CreateReelShareLinkPayload {
  expiresInDays?: number
  reuseExisting?: boolean
}

export interface ReelShareLinkResponse {
  id: string
  reelId: string
  ownerId: string
  token: string
  createdBy: string
  publicUrl?: string
  expiresAt?: string | null
  revokedAt?: string | null
  clickCount: number
  createdAt: string
  updatedAt: string
}

export interface ReelUploadUrlRequest {
  fileType: AllowedVideoType
}

export interface ReelUploadUrlResponse {
  uploadUrl: string
  key: string
  expiresIn: number
}

export interface ReelProcessingStatusResponse {
  reelId: string
  status: ReelProcessingState
  stage?: string
  message?: string
  progress?: number
  mediaKey?: string
  thumbnailKey?: string
  thumbnailUrl?: string
  streamUrl?: string
}

export type ReelViewEventType =
  | 'IMPRESSION'
  | 'WATCH_START'
  | 'WATCH_PROGRESS'
  | 'WATCH_END'
  | 'SKIP'
  | 'COMPLETE'
  | 'REPLAY'
  | 'PAUSE'
  | 'RESUME'
  | 'MUTE'
  | 'UNMUTE'

export interface TrackReelEventPayload {
  reelId: string
  sessionId?: string
  eventType: ReelViewEventType
  watchMs?: number
  durationMs?: number
  percentageWatched?: number
  muted?: boolean
  completed?: boolean
  replayed?: boolean
  skipped?: boolean
}

export interface TrackReelEventsPayload {
  events: TrackReelEventPayload[]
}
