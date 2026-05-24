import type {
  ActionConfig,
  AudienceOption,
  CaptureMode,
  DurationOption,
  UploadQualityOption,
} from '../types/reel-creator'

export const REEL_CREATOR_DRAFT_KEY = 'velora.reels.create-draft'
export const MAX_CAPTION_LENGTH = 2200
export const MIN_TRIM_GAP_RATIO = 0.08

export const railActions: ActionConfig[] = [
  { icon: 'music-note', label: 'Music' },
  { icon: 'speed', label: 'Speed' },
  { icon: 'timer', label: 'Timer' },
  { icon: 'auto-awesome', label: 'Effects' },
  { icon: 'face-retouching-natural', label: 'Beauty' },
  { icon: 'wallpaper', label: 'Green' },
]

export const editorTools: ActionConfig[] = [
  { icon: 'content-cut', label: 'Trim' },
  { icon: 'call-split', label: 'Split' },
  { icon: 'volume-up', label: 'Volume' },
  { icon: 'title', label: 'Text' },
  { icon: 'emoji-emotions', label: 'Stickers' },
  { icon: 'closed-caption', label: 'Captions' },
  { icon: 'tune', label: 'Filters' },
  { icon: 'graphic-eq', label: 'Audio sync' },
  { icon: 'slow-motion-video', label: 'Speed' },
]

export const durationOptions: DurationOption[] = [15, 30, 60, 90]
export const captureModes: CaptureMode[] = ['Video', 'Story', 'Live']
export const audienceOptions: AudienceOption[] = ['Public', 'Followers', 'Private']
export const uploadQualityOptions: UploadQualityOption[] = ['Auto', 'High', 'Ultra']

export const bannedHashtags = ['spam', 'followforfollow', 'engagementbait']

export const hashtagSuggestions = [
  'velora',
  'cityrun',
  'nightshift',
  'streetstyle',
  'weekendstory',
  'dailyvibes',
]

export const trendingHashtags = ['foryou', 'reels', 'trending', 'creatorlife', 'viralnow']
export const mentionSuggestions = ['velora', 'mila.studio', 'nova.team', 'pulse.media']

export const captionSuggestions = [
  'POV: the city slows down right when the beat drops',
  'Small moments, sharp cuts, one more reason to replay',
  'Built for late-night scrolls and early-morning saves',
]

export const ctaOptions = ['Learn more', 'Shop now', 'Book now', 'Send message']
