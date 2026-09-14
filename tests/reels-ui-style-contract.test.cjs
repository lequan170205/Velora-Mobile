const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const reelsViewer = read('src/components/reels/ReelsViewer.tsx')
const reelFeedItem = read('src/components/reels/ReelFeedItem.tsx')
const reelActionsMenu = read('src/components/reels/ReelActionsMenu.tsx')

test('reels viewer keeps immersive pager, refresh, offline, and recommendation boundaries', () => {
  assert.match(reelsViewer, /<PagerView/)
  assert.match(reelsViewer, /orientation="vertical"/)
  assert.match(reelsViewer, /scrollEnabled=\{!isTimelineInteracting\}/)
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
