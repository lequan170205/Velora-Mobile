const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const creatorHelpers = read('src/lib/reel-creator.ts')
const editorStage = read('src/components/reels/create/editor-stage.tsx')
const publishStage = read('src/components/reels/create/publish-stage.tsx')
const reelFeedItem = read('src/components/reels/ReelFeedItem.tsx')
const reelVideo = read('src/components/reels/ReelVideo.tsx')
const reelPlaybackCoordinator = read('src/lib/reelPlaybackCoordinator.ts')

test('creator classifies portrait, landscape and square sources without forcing 9:16 crop', () => {
  assert.match(creatorHelpers, /aspectRatio >= 1\.1/)
  assert.match(creatorHelpers, /return 'LANDSCAPE'/)
  assert.match(creatorHelpers, /aspectRatio <= 0\.9/)
  assert.match(creatorHelpers, /return 'PORTRAIT'/)
  assert.match(creatorHelpers, /return 'SQUARE'/)
  assert.match(
    creatorHelpers,
    /getCreatorVideoOrientation\(asset\) === 'PORTRAIT' \? 'cover' : 'contain'/,
  )
  assert.doesNotMatch(creatorHelpers, /framed to 9:16/)
})

test('editor and publish previews preserve the full non-portrait frame', () => {
  assert.match(editorStage, /getCreatorPreviewContentFit/)
  assert.match(editorStage, /contentFit=\{previewContentFit\}/)
  assert.match(publishStage, /getCreatorPreviewContentFit/)
  assert.match(publishStage, /contentFit=\{previewContentFit\}/)
})

test('shared reel video playback detects non-portrait posters and switches to contain', () => {
  assert.match(reelVideo, /ReactNativeImage\.getSize/)
  assert.match(reelVideo, /aspectRatio >= 0\.9 \? 'contain' : 'cover'/)
  assert.match(reelVideo, /useOrientationAwareContentFit/)
})

test('orientation detection is cached so returning to a reel does not restart at cover', () => {
  assert.match(reelVideo, /orientationContentFitCache/)
  assert.match(reelVideo, /getCachedOrientationContentFit/)
  assert.match(reelVideo, /cacheOrientationContentFit\(posterUri, nextContentFit\)/)
})

test('feed fit follows explicit edit framing before legacy poster detection', () => {
  assert.match(
    reelFeedItem,
    /reel\.edit\?\.framing === 'crop'[\s\S]*reel\.sourceOrientation === 'LANDSCAPE'[\s\S]*return 'contain'/,
  )
  assert.match(reelFeedItem, /reel\.playbackPresentation === 'FIT_WITH_LETTERBOX'/)
  assert.match(reelFeedItem, /reel\.playbackPresentation === 'PORTRAIT_COVER'/)
  assert.match(reelFeedItem, /reel\.edit\?\.framing !== 'fit'/)
  assert.doesNotMatch(
    reelFeedItem,
    /sourceLengthClass === 'LONG' \? 'contain' : 'cover'/,
  )
  assert.match(reelFeedItem, /contentFit=\{playbackContentFit\}/g)
  assert.match(
    reelFeedItem,
    /disableOrientationAwareContentFit=\{stablePlaybackContentFit !== null\}/,
  )
})

test('contained feed reels keep contain foreground and add a poster immersive background', () => {
  assert.match(reelFeedItem, /const isContainedPlayback = playbackContentFit === 'contain'/)
  assert.match(
    reelFeedItem,
    /const shouldRenderImmersiveBackground = isContainedPlayback && Boolean\(posterUri\)/,
  )
  assert.match(
    reelFeedItem,
    /contentFit="cover"\s+blurRadius=\{24\}\s+style=\{styles\.immersiveBackground\}/,
  )
  assert.match(reelFeedItem, /<View pointerEvents="none" style=\{styles\.immersiveBackgroundDim\}/)
  assert.match(reelFeedItem, /contentFit=\{playbackContentFit\}/)
  assert.match(
    reelFeedItem,
    /styles\.containedMediaFrame, \{ aspectRatio: containedMediaAspectRatio \}/,
  )
  assert.match(reelFeedItem, /style=\{styles\.mediaStage\}/)
  assert.doesNotMatch(reelFeedItem, /foregroundMediaStyle/)
})

test('playback coordinator plays desired reel upon registration and does not pause active reel', () => {
  assert.match(
    reelPlaybackCoordinator,
    /if\s*\(\s*this\.desiredReelId\s*===\s*reelId\s*\)\s*\{\s*player\.play\(\)/,
  )
  assert.doesNotMatch(
    reelPlaybackCoordinator,
    /if\s*\(\s*this\.desiredReelId\s*===\s*reelId\s*&&\s*this\.playingReelId\s*!==\s*reelId\s*\)/,
  )
})
