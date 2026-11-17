const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const load = (file) => {
  const compiled = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled)(module, module.exports, () => {
    throw new Error('unexpected import')
  })
  return module.exports
}

const { canBoostReelSpeed, getReelTouchZone, REEL_SPEED_BOOST_RATE } = load(
  'src/lib/reelSpeedBoost.ts',
)

test('the boost plays at 2x', () => {
  assert.equal(REEL_SPEED_BOOST_RATE, 2)
})

test('a touch lands on the left side, the middle, or the right side of the reel', () => {
  const width = 400
  assert.equal(getReelTouchZone(0, width), 'left')
  assert.equal(getReelTouchZone(119, width), 'left')
  assert.equal(getReelTouchZone(120, width), 'middle')
  assert.equal(getReelTouchZone(200, width), 'middle')
  assert.equal(getReelTouchZone(280, width), 'middle')
  assert.equal(getReelTouchZone(281, width), 'right')
  assert.equal(getReelTouchZone(400, width), 'right')
})

test('an unknown position or width falls back to the middle, which only opens the options', () => {
  assert.equal(getReelTouchZone(Number.NaN, 400), 'middle')
  assert.equal(getReelTouchZone(10, 0), 'middle')
  assert.equal(getReelTouchZone(10, Number.NaN), 'middle')
})

test('holding a side only speeds up a playing reel that is slower than 2x', () => {
  assert.equal(canBoostReelSpeed(1, false), true)
  assert.equal(canBoostReelSpeed(0.5, false), true)
  assert.equal(canBoostReelSpeed(1.5, false), true)
  assert.equal(canBoostReelSpeed(2, false), false)
  assert.equal(canBoostReelSpeed(1, true), false)
})

test('one hold gesture opens the options from the middle and boosts from the sides', () => {
  const item = read('src/components/reels/ReelFeedItem.tsx')
  assert.match(item, /\.minDuration\(450\)/)
  assert.match(item, /scheduleOnRN\(handlePlaybackSurfaceHold, event\.x\)/)
  assert.match(item, /\.onFinalize\(\(\) => \{\s*scheduleOnRN\(handlePlaybackSurfaceRelease\)/)
  assert.match(
    item,
    /getReelTouchZone\(x, windowWidth\) === 'middle'\) \{\s*handleOpenPlaybackOptions\(\)/,
  )
  assert.match(item, /canBoostReelSpeed\(playbackSpeed, isPausedByUserRef\.current\)/)
})

test('the boost drives the player rate, ends on release and never outlives the reel', () => {
  const item = read('src/components/reels/ReelFeedItem.tsx')
  assert.match(
    item,
    /const effectivePlaybackRate = isSpeedBoosted \? REEL_SPEED_BOOST_RATE : playbackSpeed/,
  )
  assert.equal((item.match(/playbackRate=\{effectivePlaybackRate\}/g) ?? []).length, 3)
  assert.doesNotMatch(item, /playbackRate=\{playbackSpeed\}/)
  assert.match(
    item,
    /if \(!isActive \|\| clearDisplay \|\| isCommentsOpen\) \{\s*setIsSpeedBoosted\(false\)/,
  )
  assert.match(item, /Playing at \$\{REEL_SPEED_BOOST_RATE\}x speed/)
})
