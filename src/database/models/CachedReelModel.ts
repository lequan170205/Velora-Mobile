import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

import { TABLES } from '../schema'

export class CachedReelModel extends Model {
  static table = TABLES.cachedReels

  @text('reel_id') reelId!: string
  @text('user_id') userId!: string
  @text('media_key') mediaKey!: string
  @text('title') title!: string | null
  @text('description') description!: string | null
  @text('tags_json') tagsJson!: string
  @text('status') status!: string
  @text('visibility') visibility!: string
  @field('view_count') viewCount!: number
  @text('thumbnail_key') thumbnailKey!: string | null
  @text('thumbnail_url') thumbnailUrl!: string | null
  @text('local_thumbnail_uri') localThumbnailUri!: string | null
  @text('stream_url') streamUrl!: string
  @text('author_json') authorJson!: string | null
  @text('recommendation_json') recommendationJson!: string | null
  @text('media_status') mediaStatus!: string | null
  @text('index_status') indexStatus!: string | null
  @text('media_stage') mediaStage!: string | null
  @field('media_progress') mediaProgress!: number | null
  @text('index_stage') indexStage!: string | null
  @field('index_progress') indexProgress!: number | null
  @field('source_duration_ms') sourceDurationMs!: number | null
  @text('source_orientation') sourceOrientation!: string | null
  @text('source_length_class') sourceLengthClass!: string | null
  @field('source_aspect_ratio') sourceAspectRatio!: number | null
  @field('source_effective_width') sourceEffectiveWidth!: number | null
  @field('source_effective_height') sourceEffectiveHeight!: number | null
  @text('hls_master_url') hlsMasterUrl!: string | null
  @text('caption_vtt_url') captionVttUrl!: string | null
  @text('created_at_remote') createdAtRemote!: string
  @field('cached_at') cachedAt!: number
  @field('last_accessed_at') lastAccessedAt!: number
}
