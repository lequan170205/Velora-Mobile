export type ReelVisibility = 'public' | 'private'

export type AllowedVideoType = 'video/mp4' | 'video/webm' | 'video/quicktime'

export interface Reel {
  id: string
  userId: string
  mediaKey: string
  title: string
  description?: string
  tags: string[]
  status: string
  visibility: ReelVisibility
  viewCount: number
  thumbnailKey?: string
  thumbnailUrl?: string
  streamUrl: string
  createdAt: string
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

export interface CreateReelPayload {
  mediaKey: string
  title: string
  description: string
  tags: string[]
}

export interface ReelUploadUrlRequest {
  fileType: AllowedVideoType
}

export interface ReelUploadUrlResponse {
  uploadUrl: string
  key: string
  expiresIn: number
}
