import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

import { TABLES } from '../schema'

export class CachedReelFeedPageModel extends Model {
  static table = TABLES.cachedReelFeedPages

  @text('cache_key') cacheKey!: string
  @text('params_json') paramsJson!: string
  @text('cursor') cursor!: string | null
  @text('reel_ids_json') reelIdsJson!: string
  @text('next_cursor') nextCursor!: string | null
  @field('cached_at') cachedAt!: number
  @field('last_accessed_at') lastAccessedAt!: number
}
