import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

import { TABLES } from '../schema'

export class ReelVideoCacheRecordModel extends Model {
  static table = TABLES.reelVideoCacheRecords

  @text('reel_id') reelId!: string
  @text('stream_url') streamUrl!: string
  @text('local_manifest_uri') localManifestUri!: string
  @text('local_thumbnail_uri') localThumbnailUri!: string | null
  @field('downloaded_at') downloadedAt!: number
  @field('last_accessed_at') lastAccessedAt!: number
  @field('segment_count') segmentCount!: number
  @field('size_bytes') sizeBytes!: number
}
