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

export type ReelContextSource = 'profile' | 'public'

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
