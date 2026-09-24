const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const reelsViewer = read('src/components/reels/ReelsViewer.tsx')
const reelFeedItem = read('src/components/reels/ReelFeedItem.tsx')
const reelActionsMenu = read('src/components/reels/ReelActionsMenu.tsx')
const reelPlaybackOptionsSheet = read('src/components/reels/ReelPlaybackOptionsSheet.tsx')
const reelPlaybackPreferences = read('src/lib/reelPlaybackPreferences.ts')
const reelVideo = read('src/components/reels/ReelVideo.tsx')
const reelTypes = read('src/types/reel.types.ts')

test('reels viewer keeps immersive pager, refresh, offline, and recommendation boundaries', () => {
  assert.match(reelsViewer, /<PagerView/)
  assert.doesNotMatch(reelsViewer, /<FlashList/)
  assert.match(reelsViewer, /orientation="vertical"/)
  assert.match(reelsViewer, /offscreenPageLimit=\{2\}/)
  assert.match(reelsViewer, /scrollEnabled=\{!isTimelineInteracting && !disablePagerSwipe\}/)
  assert.match(reelsViewer, /Gesture\.Pan\(\)/)
  assert.match(reelsViewer, /scheduleOnRN\(handleRefresh\)/)
  assert.match(reelsViewer, /<ReelOfflineSkeleton/)
  assert.match(reelsViewer, /useRecommendedReelsFeed/)
  assert.match(reelsViewer, /refreshWithNewSession\(\)/)
})

test('reels viewer uses lightweight text feed tabs and an understated create action', () => {
  assert.match(reelsViewer, /flex-row items-center gap-7/)
  assert.match(reelsViewer, /h-11 min-w-\[62px\] items-center justify-center px-1/)
  assert.match(reelsViewer, /accessibilityRole="tab"/)
  assert.match(reelsViewer, /accessibilityState=\{\{ selected: isSelected \}\}/)
  assert.match(
    reelsViewer,
    /isSelected\s+\? 'font-bold text-white'\s+: 'font-semibold text-white\/85'/,
  )
  assert.match(reelsViewer, /textShadowColor: 'rgba\(0, 0, 0, 0\.82\)'/)
  assert.match(reelsViewer, /isSelected \? 'w-6 bg-brand' : 'w-0 bg-transparent'/)
  assert.match(reelsViewer, /accessibilityLabel="Create reel"/)
  assert.match(reelsViewer, /className="h-11 w-11 items-center justify-center"/)
  assert.match(reelsViewer, /<Ionicons name="add" size=\{28\} color="#FFFFFF"/)
  assert.doesNotMatch(
    reelsViewer,
    /accessibilityLabel="Create reel"[\s\S]{0,220}rounded-full border/,
  )
})

test('reel video viewport ends above the docked rail and feed tabs sit closer to the safe area', () => {
  assert.match(
    reelsViewer,
    /const videoViewportHeight = Math\.max\(0, viewportHeight - Math\.max\(0, bottomContentInset\)\)/,
  )
  assert.match(reelsViewer, /<View style=\{\{ height: videoViewportHeight \}\}>/)
  assert.match(reelsViewer, /height=\{videoViewportHeight\}/)
  assert.match(reelsViewer, /bottomContentInset=\{0\}/)
  assert.match(reelsViewer, /paddingTop: insets\.top,/)
})

test('reels viewer states follow the dark glass icon, heading, copy, and CTA hierarchy', () => {
  assert.match(reelsViewer, /ActivityIndicator color="#FF935B"/)
  assert.match(reelsViewer, /Loading reels/)
  assert.match(reelsViewer, /Feed unavailable/)
  assert.match(reelsViewer, /rounded-\[32px\] border border-white\/14 bg-black\/52/)
  assert.match(reelsViewer, /Try loading reels again/)
  assert.match(reelsViewer, /text-white\/70/)
})

test('reel feed item keeps playback and scrub contracts while making metadata readable', () => {
  assert.match(reelFeedItem, /Gesture\.Pan\(\)/)
  assert.match(reelFeedItem, /scheduleOnRN\(beginScrub/)
  assert.match(reelFeedItem, /scheduleOnRN\(updateScrub/)
  assert.match(reelFeedItem, /scheduleOnRN\(finishScrub/)
  assert.match(reelFeedItem, /<ReelShareSheet/)
  assert.match(reelFeedItem, /<DeleteReelModal/)
  assert.match(reelFeedItem, /flex-row items-start/)
  assert.match(reelFeedItem, /text-base2 font-medium leading-6 text-white/)
  assert.equal(
    (reelFeedItem.match(/numberOfLines=\{isCaptionExpanded \? undefined : 1\}/g) ?? []).length,
    2,
  )
  assert.match(
    reelFeedItem,
    /const canExpandMetadata = captionText\.length > 44 \|\| hashtagLine\.length > 40/,
  )
  assert.doesNotMatch(reelFeedItem, /\.slice\(0, 4\)/)
  assert.match(reelFeedItem, /Show more reel details/)
  assert.match(reelFeedItem, /isCaptionExpanded \? 'less' : '… more'/)
  assert.match(
    reelFeedItem,
    /const authorUsernameLine = authorHandle \? `@\$\{authorHandle\}` : authorNameLine/,
  )
  assert.match(reelFeedItem, /font-semibold text-md text-white/)
  assert.match(
    reelFeedItem,
    /h-\[42px\] w-\[42px\] items-center justify-center rounded-full bg-\[#2F6FED\]/,
  )
  assert.match(reelFeedItem, /text-\[#FFB18E\]/)
  assert.match(reelFeedItem, /accessibilityLabel="Share reel"/)
  assert.match(reelFeedItem, /accessibilityLabel="More reel actions"/)
  assert.match(reelFeedItem, /<Ionicons name="paper-plane-outline" size=\{24\} color="#FFFFFF"/)
  assert.match(reelFeedItem, /<Ionicons name="ellipsis-horizontal" size=\{25\} color="#FFFFFF"/)
  assert.doesNotMatch(
    reelFeedItem,
    /accessibilityLabel="Share reel"[\s\S]{0,220}rounded-full border/,
  )
  assert.doesNotMatch(
    reelFeedItem,
    /accessibilityLabel="More reel actions"[\s\S]{0,220}rounded-full border/,
  )
})

test('active reels fetch timed transcript detail and render synchronized captions', () => {
  assert.match(reelTypes, /export interface ReelTranscriptSegment/)
  assert.match(reelTypes, /transcriptSegments\?: ReelTranscriptSegment\[\]/)
  assert.match(reelFeedItem, /\(isActive && liveTranscriptionEnabled && !clearDisplay\)/)
  assert.match(reelFeedItem, /const TRANSCRIPT_WORDS_PER_CUE = 6/)
  assert.match(reelFeedItem, /const TRANSCRIPT_SILENCE_HIDE_SECONDS = 0\.18/)
  assert.match(reelFeedItem, /const TRANSCRIPT_PHRASE_GAP_SECONDS = 0\.35/)
  assert.match(reelFeedItem, /const getTimedTranscriptWords =/)
  assert.match(
    reelFeedItem,
    /words\[chunkEnd \+ 1\]\.start - words\[chunkEnd\]\.end <= TRANSCRIPT_PHRASE_GAP_SECONDS/,
  )
  assert.match(reelFeedItem, /position >= cueStartTime && position < cueHideTime/)
  assert.match(reelFeedItem, /self-start/)
  assert.match(reelFeedItem, /text-left/)
  assert.doesNotMatch(reelFeedItem, /styles\.transcriptOverlay[\s\S]{0,120}self-center/)
  assert.doesNotMatch(reelFeedItem, /styles\.transcriptOverlay[\s\S]{0,120}text-center/)
  assert.match(reelFeedItem, /getActiveTranscriptText\(\s*reelDetail\?\.transcriptSegments/)
  assert.match(reelFeedItem, /liveTranscriptionEnabled \? 0\.2 : 0\.5/)
  assert.match(reelFeedItem, /numberOfLines=\{1\}/)
  assert.match(reelFeedItem, /ellipsizeMode="tail"/)
  assert.doesNotMatch(reelFeedItem, /segment\.start - 0\.08/)
  assert.doesNotMatch(reelFeedItem, /segment\.end \+ 0\.12/)
  assert.match(
    reelFeedItem,
    /\{isActive && liveTranscriptionEnabled && activeTranscriptText && !clearDisplay \? \(/,
  )
  assert.match(reelFeedItem, /styles\.transcriptOverlay/)
  assert.match(reelFeedItem, /transcriptOverlayBottom/)
  assert.match(reelFeedItem, /\{activeTranscriptText\}/)
})

test('long press opens gorhom playback options without stealing the scrubber gesture', () => {
  assert.match(reelFeedItem, /Gesture\.LongPress\(\)/)
  assert.match(reelFeedItem, /\.minDuration\(450\)/)
  assert.match(reelFeedItem, /\.maxDistance\(28\)/)
  assert.match(reelFeedItem, /scheduleOnRN\(handleOpenPlaybackOptions\)/)
  assert.match(reelFeedItem, /playbackOptionsSheetRef\.current\?\.present\(\)/)
  assert.match(reelFeedItem, /\.activateAfterLongPress\(120\)/)
  assert.match(reelPlaybackOptionsSheet, /@gorhom\/bottom-sheet/)
  assert.match(reelPlaybackOptionsSheet, /<BottomSheetModal/)
  assert.match(reelPlaybackOptionsSheet, /enableDynamicSizing/)
  assert.match(reelPlaybackOptionsSheet, />Playback</)
  assert.match(reelPlaybackOptionsSheet, /accessibilityLabel="Live transcription"/)
  assert.match(reelPlaybackOptionsSheet, /accessibilityLabel="Clear display"/)
  assert.match(reelPlaybackOptionsSheet, /Playback speed/)
  assert.doesNotMatch(reelPlaybackOptionsSheet, /colors\.call\./)
  assert.match(reelPlaybackOptionsSheet, /bg-brand-soft/)
  assert.match(reelPlaybackOptionsSheet, /bg-brand'/)
})

test('playback long press keeps one stable surface across pause and tab focus changes', () => {
  assert.match(
    reelFeedItem,
    /\{playbackState\.isPlayable && !hasPlaybackError \? \(\s*<GestureDetector gesture=\{playbackSurfaceGesture\}>/,
  )
  assert.match(
    reelFeedItem,
    /\.enabled\(!clearDisplay && playbackState\.isPlayable && !hasPlaybackError\)/,
  )
  assert.match(reelFeedItem, /pointerEvents=\{isActive \? 'auto' : 'none'\}/)
  assert.doesNotMatch(reelFeedItem, /Gesture\.LongPress\(\)[\s\S]{0,180}\.enabled\(isActive/)
  assert.match(reelFeedItem, /Gesture\.Tap\(\)/)
  assert.match(reelFeedItem, /Gesture\.Exclusive\(playbackLongPressGesture, playbackTapGesture\)/)
  assert.match(reelFeedItem, /setIsPausedByUser\(!isPausedByUserRef\.current\)/)
  assert.match(reelFeedItem, /\{showPausedControls && !clearDisplay \? \(/)
  assert.doesNotMatch(reelFeedItem, /<Pressable/)
  assert.doesNotMatch(reelFeedItem, /didLongPressPlaybackSurfaceRef/)
  assert.doesNotMatch(reelFeedItem, /showPausedControls && clearDisplay \? \(/)
  assert.doesNotMatch(reelsViewer, /Gesture\.Pan\(\)[\s\S]{0,220}\.enabled\([\s\S]{0,160}isFocused/)
})

test('transcription uses a direct row action without a native switch animation', () => {
  assert.doesNotMatch(reelPlaybackOptionsSheet, /<Switch/)
  assert.doesNotMatch(reelPlaybackOptionsSheet, /setTimeout/)
  assert.match(
    reelPlaybackOptionsSheet,
    /accessibilityState=\{\{ selected: transcriptionEnabled \}\}/,
  )
  assert.match(
    reelPlaybackOptionsSheet,
    /onPress=\{\(\) => onTranscriptionChange\(!transcriptionEnabled\)\}/,
  )
  assert.match(reelPlaybackOptionsSheet, /Captions are on · tap to turn off/)
  assert.match(reelPlaybackOptionsSheet, /Captions are off · tap to turn on/)
  assert.match(reelsViewer, /liveTranscriptionEnabled=\{isActiveItem && liveTranscriptionEnabled\}/)
})

test('clear display hides reel chrome and the next video tap restores it without pausing', () => {
  assert.match(reelsViewer, /const \[clearDisplay, setClearDisplay\] = useState\(false\)/)
  assert.match(reelsViewer, /pointerEvents=\{clearDisplay \? 'none' : 'box-none'\}/)
  assert.match(reelsViewer, /opacity: clearDisplay \? 0 : 1/)
  assert.match(reelFeedItem, /\{!clearDisplay \? \(\s*<LinearGradient/)
  assert.match(reelFeedItem, /pointerEvents=\{clearDisplay \? 'none' : 'box-none'\}/)
  assert.match(reelFeedItem, /clearDisplay \? \{ opacity: 0 \} : undefined/)
  assert.match(reelFeedItem, /if \(clearDisplay\) \{\s*onRestoreDisplay\(\)\s*return/)
})

test('transcription and playback speed preferences persist and speed applies without replacing video source', () => {
  assert.match(reelPlaybackPreferences, /reel-live-transcription-enabled/)
  assert.match(reelPlaybackPreferences, /reel-playback-speed/)
  assert.match(reelPlaybackPreferences, /\[0\.5, 1, 1\.5, 2\] as const/)
  assert.match(reelFeedItem, /playbackRate=\{playbackSpeed\}/)
  assert.match(reelVideo, /videoPlayer\.playbackRate = playbackRate/)
  assert.match(reelVideo, /player\.playbackRate = playbackRate/)
  assert.match(reelVideo, /setRateAsync\(playbackRate, true\)/)
  assert.match(reelVideo, /rate=\{playbackRate\}/)
})

test('reel actions reuse the shared animated action sheet without changing edit/delete callbacks', () => {
  assert.match(
    reelActionsMenu,
    /import \{ AnimatedActionSheet \} from '\.\.\/common\/AnimatedActionSheet'/,
  )
  assert.match(reelActionsMenu, /<AnimatedActionSheet/)
  assert.match(reelActionsMenu, /onPress=\{\(\) => close\(onEdit\)\}/)
  assert.match(reelActionsMenu, /onPress=\{\(\) => close\(onDelete\)\}/)
  assert.doesNotMatch(reelActionsMenu, /<Modal/)
  assert.doesNotMatch(reelActionsMenu, /useSharedValue/)
})
