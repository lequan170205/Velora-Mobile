import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

import { TABLES } from '../schema'

export class CachedReelFeedPageModel extends Model {
  static table = TABLES.cachedReelFeedPages

  @text('cache_key') cacheKey!: string
  @text('params_json') paramsJson!: string
  @text('cursor') cursor!: string | null
  @text('reel_ids_json') reelIdsJson!: string
  @text('recommendations_json') recommendationsJson!: string | null
  @text('next_cursor') nextCursor!: string | null
  @text('feed_session_id') feedSessionId!: string | null
  @text('algorithm_version') algorithmVersion!: string | null
  @text('generated_at') generatedAt!: string | null
  @field('cached_at') cachedAt!: number
  @field('last_accessed_at') lastAccessedAt!: number
}
