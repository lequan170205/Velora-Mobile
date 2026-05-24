import type { MaterialIcons } from '@expo/vector-icons'

import type { ReelVisibility } from './reel.types'
import type { ImagePickerAsset } from 'expo-image-picker'
import type React from 'react'

export type MaterialIconName = React.ComponentProps<typeof MaterialIcons>['name']

export type CreateStage = 'capture' | 'edit' | 'publish'
export type CaptureMode = 'Video' | 'Story' | 'Live'
export type DurationOption = 15 | 30 | 60 | 90
export type AudienceOption = 'Public' | 'Followers' | 'Private'
export type UploadQualityOption = 'Auto' | 'High' | 'Ultra'
export type TimelineHandle = 'start' | 'end'

export type StoredAsset = Pick<
  ImagePickerAsset,
  'uri' | 'fileName' | 'mimeType' | 'duration' | 'width' | 'height'
>

export type DraftState = {
  stage: CreateStage
  asset: StoredAsset | null
  title: string
  caption: string
  visibility: ReelVisibility
  durationOption: DurationOption
  savedAt: number
}

export type TimelineFrame = {
  uri: string
  timeMs: number
}

export type ActionConfig = {
  icon: MaterialIconName
  label: string
}

export type ImportState = {
  active: boolean
  label: string
  progress: number
}
