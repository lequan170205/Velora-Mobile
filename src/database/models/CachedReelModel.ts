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
  @text('created_at_remote') createdAtRemote!: string
  @field('cached_at') cachedAt!: number
  @field('last_accessed_at') lastAccessedAt!: number
}
