const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const reelsHook = read('src/hooks/useReels.ts')
const reelsViewer = read('src/components/reels/ReelsViewer.tsx')
const reelTypes = read('src/types/reel.types.ts')

test('reel detail prefetch shares the query key and options with useReelDetail', () => {
  assert.match(
    reelsHook,
    /const getReelDetailQueryOptions = \(viewerId: string, id: string \| undefined\)/,
  )
  assert.match(
    reelsHook,
    /export const prefetchReelDetail = \(queryClient: QueryClient, viewerId: string, id: string\)/,
  )
  assert.match(reelsHook, /queryClient\.prefetchQuery\(getReelDetailQueryOptions\(viewerId, id\)\)/)
  assert.match(
    reelsHook,
    /\.\.\.getReelDetailQueryOptions\(viewerId, id\),\s*enabled: Boolean\(id\)/,
  )
})

test('the viewer warms detail for the active and next reel only while live captions are on', () => {
  const effectStart = reelsViewer.indexOf('prefetchReelDetail(queryClient, viewerId, reel.id)')
  assert.ok(effectStart > 0, 'ReelsViewer must call prefetchReelDetail')
  const effect = reelsViewer.slice(Math.max(0, effectStart - 700), effectStart + 500)

  assert.match(effect, /!liveTranscriptionEnabled \|\| !isFocused \|\| !isOnline/)
  assert.match(effect, /reels\[activeIndex\], reels\[activeIndex \+ 1\]/)
  assert.match(effect, /startsWith\(CHAT_SHARED_REEL_FALLBACK_ID_PREFIX\)/)
  assert.match(effect, /InteractionManager\.runAfterInteractions/)
})

test('list reels treat the transcript as optional because list responses omit it', () => {
  assert.match(reelTypes, /transcriptSegments\?: ReelTranscriptSegment\[\]/)
})
