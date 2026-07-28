import type { RecommendationMetadata } from './recommendation.types'

export type ReelVisibility = 'public' | 'private'

export type AllowedVideoType = 'video/mp4' | 'video/webm' | 'video/quicktime'
export type ReelProcessingState = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
export type ReelMediaStatus = 'PENDING' | 'PROBING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
export type ReelIndexStatus =
  'NOT_REQUESTED' | 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'DEGRADED' | 'FAILED'
export type ReelSourceOrientation = 'PORTRAIT' | 'LANDSCAPE' | 'SQUARE'
export type ReelSourceLengthClass = 'SHORT' | 'LONG'

export interface ReelMediaState {
  mediaStatus: ReelMediaStatus
  mediaStage?: string
  mediaMessage?: string
  mediaProgress?: number
  mediaErrorCode?: string
  indexStatus: ReelIndexStatus
  indexStage?: string
  indexMessage?: string
  indexProgress?: number
  indexErrorCode?: string
  sourceDurationMs?: number
  sourceWidth?: number
  sourceHeight?: number
  sourceEffectiveWidth?: number
  sourceEffectiveHeight?: number
  sourceAspectRatio?: number
  sourceOrientation?: ReelSourceOrientation
  sourceLengthClass?: ReelSourceLengthClass
  sourceRotation?: number
  hlsMasterKey?: string
  hlsMasterUrl?: string
  captionVttKey?: string
  captionVttUrl?: string
  encodedVariants?: {
    name: string
    width: number
    height: number
    bitrateKbps?: number
  }[]
}

export interface ReelAuthor {
  id: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  isVerified: boolean | null
}

export interface Reel extends Partial<ReelMediaState> {
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
  offlineStreamUrl?: string
  offlineThumbnailUrl?: string
  processingStage?: string
  processingMessage?: string
  processingProgress?: number
  stage?: string
  message?: string
  progress?: number
  streamUrl: string
  createdAt: string
  author?: ReelAuthor | null
  recommendation?: RecommendationMetadata
}

export type ReelFeedListItem = Reel

export interface ReelDetail extends Reel {
  description?: string
  transcript?: string
}

export interface ListReelsParams {
  userId?: string
  visibility?: ReelVisibility
  limit?: number
  cursor?: string
  ranked?: boolean
}

export interface PaginatedReels<T> {
  items: T[]
  nextCursor?: string | null
  fromOfflineCache?: boolean
  cachedAt?: number
  feedSessionId?: string
  algorithmVersion?: string
  generatedAt?: string
}

export interface RecommendedReelsPage extends PaginatedReels<ReelFeedListItem> {
  nextCursor: string | null
  feedSessionId: string
  algorithmVersion: string
  generatedAt: string
}

export type ListReelsResponse = PaginatedReels<Reel>

export interface PaginatedFriendsReels {
  items: ReelFeedListItem[]
  nextCursor: string | null
}

export interface RecommendedReelsParams {
  limit?: number
  cursor?: string | null
  excludeRecentlySeen?: boolean
  feedSessionId?: string
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
  status?: ReelProcessingState
  stage?: string
  message?: string
  progress?: number
  mediaKey?: string
  thumbnailKey?: string
  thumbnailUrl?: string
  streamUrl?: string
  mediaStatus?: ReelMediaStatus
  mediaStage?: string
  mediaMessage?: string
  mediaProgress?: number
  mediaErrorCode?: string
  indexStatus?: ReelIndexStatus
  indexStage?: string
  indexMessage?: string
  indexProgress?: number
  indexErrorCode?: string
  sourceDurationMs?: number
  sourceWidth?: number
  sourceHeight?: number
  sourceEffectiveWidth?: number
  sourceEffectiveHeight?: number
  sourceAspectRatio?: number
  sourceOrientation?: ReelSourceOrientation
  sourceLengthClass?: ReelSourceLengthClass
  sourceRotation?: number
  hlsMasterKey?: string
  hlsMasterUrl?: string
  captionVttKey?: string
  captionVttUrl?: string
  encodedVariants?: ReelMediaState['encodedVariants']
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

export type ReelEventSource =
  'RECOMMENDED' | 'FRIENDS' | 'PUBLIC_FEED' | 'PROFILE' | 'SEARCH' | 'SHARED' | 'DIRECT' | 'UNKNOWN'

export interface ReelEventRecommendation {
  recommendationId: string
  feedSessionId: string
  algorithmVersion: string
  candidateSource: RecommendationMetadata['candidateSource']
  rank: number
  generatedAt: string
}

export interface TrackReelEventPayload {
  eventId: string
  reelId: string
  playbackSessionId: string
  sequence: number
  eventType: ReelViewEventType
  source: ReelEventSource
  occurredAt: string
  watchMs?: number
  durationMs?: number
  percentageWatched?: number
  muted?: boolean
  completed?: boolean
  replayed?: boolean
  skipped?: boolean
  recommendation?: ReelEventRecommendation
}

export interface TrackReelEventsPayload {
  events: TrackReelEventPayload[]
}

export interface TrackReelEventsResponse {
  success: true
  accepted: number
  duplicates: number
  rejected: number
  countedViews: number
  rejectedEventIds: string[]
}
