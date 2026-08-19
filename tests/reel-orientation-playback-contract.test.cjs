const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const creatorHelpers = read('src/lib/reel-creator.ts')
const editorStage = read('src/components/reels/create/editor-stage.tsx')
const publishStage = read('src/components/reels/create/publish-stage.tsx')
const reelVideo = read('src/components/reels/ReelVideo.tsx')

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
