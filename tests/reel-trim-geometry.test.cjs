const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')

const loadTypeScriptModule = (relativePath) => {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: relativePath,
  })
  const module = { exports: {} }
  const context = {
    Math,
    Number,
    Object,
    module,
    exports: module.exports,
  }

  vm.runInNewContext(outputText, context, { filename: relativePath })
  return module.exports
}

const geometry = loadTypeScriptModule('src/lib/reel-trim-geometry.ts')

const loadCreatorModule = () => {
  const source = fs.readFileSync(path.join(root, 'src/lib/reel-creator.ts'), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: 'src/lib/reel-creator.ts',
  })
  const module = { exports: {} }
  const context = {
    Math,
    Number,
    Object,
    module,
    exports: module.exports,
    require: (moduleName) => {
      if (moduleName === 'expo-video-thumbnails') {
        return {}
      }

      if (moduleName === './reels') {
        return { stripHashtagsFromCaption: (value) => value }
      }

      if (moduleName === './reel-trim-geometry') {
        return geometry
      }

      throw new Error(`Unexpected module: ${moduleName}`)
    },
  }

  vm.runInNewContext(outputText, context, { filename: 'src/lib/reel-creator.ts' })
  return module.exports
}

const creator = loadCreatorModule()

test('full source selections canonicalize to a null trim', () => {
  assert.equal(geometry.sanitizeTrim({ version: 1, startMs: 0, endMs: 10_000 }, 10_000), null)
  assert.equal(geometry.sanitizeTrim({ version: 1, startMs: 25, endMs: 10_025 }, 10_000), null)
})

test('valid trim ranges preserve millisecond boundaries and selected duration', () => {
  assert.equal(
    JSON.stringify(geometry.sanitizeTrim({ version: 1, startMs: 0, endMs: 10_000 }, 20_000)),
    JSON.stringify({ version: 1, startMs: 0, endMs: 10_000 }),
  )
  assert.equal(
    JSON.stringify(geometry.sanitizeTrim({ version: 1, startMs: 6_500, endMs: 24_000 }, 40_000)),
    JSON.stringify({ version: 1, startMs: 6_500, endMs: 24_000 }),
  )
  assert.equal(
    JSON.stringify(geometry.sanitizeTrim({ version: 1, startMs: 4_000, endMs: 5_000 }, 10_000)),
    JSON.stringify({ version: 1, startMs: 4_000, endMs: 5_000 }),
  )
  assert.equal(geometry.sanitizeTrim({ version: 1, startMs: 4_000, endMs: 4_999 }, 10_000), null)
  assert.equal(geometry.getTrimDurationMs({ version: 1, startMs: 6_500, endMs: 24_000 }), 17_500)
})

test('sanitization clamps the timeline and rejects non-finite values', () => {
  assert.equal(
    JSON.stringify(geometry.sanitizeTrim({ version: 1, startMs: -500, endMs: 3_000 }, 10_000)),
    JSON.stringify({ version: 1, startMs: 0, endMs: 3_000 }),
  )
  assert.equal(
    JSON.stringify(geometry.sanitizeTrim({ version: 1, startMs: 7_000, endMs: 20_000 }, 10_000)),
    JSON.stringify({ version: 1, startMs: 7_000, endMs: 10_000 }),
  )
  assert.equal(
    geometry.sanitizeTrim({ version: 1, startMs: Number.NaN, endMs: 5_000 }, 10_000),
    null,
  )
  assert.equal(
    geometry.sanitizeTrim({ version: 1, startMs: 0, endMs: Number.POSITIVE_INFINITY }, 10_000),
    null,
  )
})

test('handle clamping prevents crossing and preserves the one-second minimum', () => {
  assert.equal(
    JSON.stringify(geometry.clampTrimRange(9_500, 2_000, 10_000)),
    JSON.stringify({ startMs: 9_000, endMs: 10_000 }),
  )
  assert.equal(
    JSON.stringify(geometry.clampTrimRange(-1_000, 20_000, 10_000)),
    JSON.stringify({ startMs: 0, endMs: 10_000 }),
  )
  assert.equal(
    JSON.stringify(geometry.clampTrimRange(2_000, 2_500, 10_000)),
    JSON.stringify({ startMs: 2_000, endMs: 3_000 }),
  )
})

test('timeline coordinates round-trip to milliseconds at common widths', () => {
  for (const width of [1, 187, 320, 360]) {
    for (const timeMs of [0, 1_000, 6_500, 17_500, 40_000]) {
      const x = geometry.timeMsToTimelineX(timeMs, 40_000, width)
      const roundTripMs = geometry.timelineXToTimeMs(x, 40_000, width)
      assert.ok(Math.abs(roundTripMs - timeMs) <= 1)
    }
  }

  assert.equal(geometry.timelineXToTimeMs(-10, 40_000, 320), 0)
  assert.equal(geometry.timelineXToTimeMs(999, 40_000, 320), 40_000)
})

test('trim playback seeks back to the selected start only at the end boundary', () => {
  const trim = { version: 1, startMs: 6_000, endMs: 18_000 }

  assert.equal(geometry.getTrimPlaybackSeekTarget(trim, 17.95, 40), 6)
  assert.equal(geometry.getTrimPlaybackSeekTarget(trim, 17.5, 40), null)
  assert.equal(geometry.getTrimPlaybackSeekTarget(trim, 8, 10), null)
  assert.equal(geometry.getTrimPlaybackSeekTarget(null, 39.99, 40), null)
})

test('payloads preserve crop and trim combinations and omit canonical full-range trim', () => {
  const trim = { version: 1, startMs: 6_500, endMs: 24_000 }
  const crop = {
    version: 1,
    x: 0.2,
    y: 0,
    width: 0.316,
    height: 1,
    aspectRatio: '9:16',
  }

  assert.equal(
    JSON.stringify(creator.buildReelEditPayload({ framing: 'fit', crop: null, trim })),
    JSON.stringify({ framing: 'fit', trim }),
  )
  assert.equal(
    JSON.stringify(creator.buildReelEditPayload({ framing: 'crop', crop, trim })),
    JSON.stringify({ framing: 'crop', crop, trim }),
  )
  assert.equal(
    JSON.stringify(creator.buildReelEditPayload({ framing: 'fit', crop: null, trim: null })),
    JSON.stringify({ framing: 'fit' }),
  )
  assert.equal(creator.getClientObservedDurationMs(trim, 40_000), 17_500)
  assert.equal(creator.getClientObservedDurationMs(null, 40_000), 40_000)
  assert.equal(creator.getVideoDurationMs({ duration: 40_000 }, 17.5), 17_500)
  assert.equal(creator.getVideoDurationMs({ duration: 40_000 }, 0), 40_000)
})

test('trimmed thumbnail selection never returns a frame outside the selected interval', () => {
  const frames = [
    { uri: 'frame-0', timeMs: 0 },
    { uri: 'frame-6500', timeMs: 6_500 },
    { uri: 'frame-12000', timeMs: 12_000 },
    { uri: 'frame-24000', timeMs: 24_000 },
  ]

  assert.equal(
    JSON.stringify(creator.getTrimmedThumbnailFrame(frames, { startMs: 6_500, endMs: 24_000 })),
    JSON.stringify({ uri: 'frame-6500', timeMs: 6_500 }),
  )
  assert.equal(creator.getTrimmedThumbnailFrame(frames, { startMs: 1_000, endMs: 2_000 }), null)
})
