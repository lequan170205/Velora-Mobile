const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
let trimGeometry

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
    require: (moduleName) => {
      if (moduleName === './reel-trim-geometry') {
        return trimGeometry
      }

      throw new Error(`Unexpected module: ${moduleName}`)
    },
  }

  vm.runInNewContext(outputText, context, { filename: relativePath })
  return module.exports
}

trimGeometry = loadTypeScriptModule('src/lib/reel-trim-geometry.ts')
const geometry = loadTypeScriptModule('src/lib/reel-crop-geometry.ts')

const assertClose = (actual, expected, epsilon = 0.000001) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not close to ${expected}`)
}

const assertCropBounds = (crop) => {
  assert.equal(crop.version, 1)
  assert.equal(crop.aspectRatio, '9:16')
  assert.ok(crop.x >= 0 && crop.y >= 0)
  assert.ok(crop.width > 0 && crop.height > 0)
  assert.ok(crop.width <= 1 && crop.height <= 1)
  assert.ok(crop.x + crop.width <= 1.000001)
  assert.ok(crop.y + crop.height <= 1.000001)
}

test('default crop keeps exact 9:16 portrait sources effectively full-frame', () => {
  for (const [width, height] of [
    [1080, 1920],
    [2160, 3840],
  ]) {
    const crop = geometry.getDefaultCropRect(width, height)
    assert.equal(
      JSON.stringify(crop),
      JSON.stringify({
        version: 1,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        aspectRatio: '9:16',
      }),
    )
    assertClose(geometry.getCoverScale(width, height, 360, 640), 360 / width)
  }
})

test('square and landscape defaults are centered and leave subject movement available', () => {
  const square = geometry.getDefaultCropRect(1080, 1080)
  assertClose(square.x, 0.21875)
  assertClose(square.y, 0)
  assertClose(square.width, 0.5625)
  assertClose(square.height, 1)
  assertCropBounds(square)

  for (const [width, height] of [
    [1920, 1080],
    [3840, 2160],
  ]) {
    const landscape = geometry.getDefaultCropRect(width, height)
    assertClose(landscape.x, 0.341796875)
    assertClose(landscape.y, 0)
    assertClose(landscape.width, 0.31640625)
    assertClose(landscape.height, 1)
    assertCropBounds(landscape)
  }
})

test('crop transform and normalized rect round-trip across source resolutions', () => {
  for (const [sourceWidth, sourceHeight] of [
    [1080, 1920],
    [2160, 3840],
    [1080, 1080],
    [1920, 1080],
    [3840, 2160],
  ]) {
    const viewport = {
      sourceWidth,
      sourceHeight,
      viewportWidth: 360,
      viewportHeight: 640,
    }
    const defaultCrop = geometry.getDefaultCropRect(sourceWidth, sourceHeight)
    const defaultTransform = geometry.getCropTransformFromRect(defaultCrop, viewport)
    const defaultRoundTrip = geometry.getCropRectFromTransform(defaultTransform, viewport)

    assertClose(defaultRoundTrip.x, defaultCrop.x)
    assertClose(defaultRoundTrip.y, defaultCrop.y)
    assertClose(defaultRoundTrip.width, defaultCrop.width)
    assertClose(defaultRoundTrip.height, defaultCrop.height)
    assert.equal(defaultTransform.scale, 1)

    const maxPan = geometry.clampCropTranslation(9999, -9999, 2.25, viewport)
    const transformedCrop = geometry.getCropRectFromTransform({ scale: 2.25, ...maxPan }, viewport)
    assertCropBounds(transformedCrop)
    const transformedRoundTrip = geometry.getCropRectFromTransform(
      geometry.getCropTransformFromRect(transformedCrop, viewport),
      viewport,
    )
    assertClose(transformedRoundTrip.x, transformedCrop.x)
    assertClose(transformedRoundTrip.y, transformedCrop.y)
    assertClose(transformedRoundTrip.width, transformedCrop.width)
    assertClose(transformedRoundTrip.height, transformedCrop.height)
  }
})

test('translation clamps both landscape edges and max zoom stays within four times cover', () => {
  const viewport = {
    sourceWidth: 1920,
    sourceHeight: 1080,
    viewportWidth: 360,
    viewportHeight: 640,
  }
  const clamped = geometry.clampCropTranslation(-10000, 10000, 4, viewport)
  const coverScale = geometry.getCoverScale(1920, 1080, 360, 640)
  const expectedMaxX = (1920 * coverScale * 4 - 360) / 2
  const expectedMaxY = (1080 * coverScale * 4 - 640) / 2

  assertClose(clamped.translateX, -expectedMaxX)
  assertClose(clamped.translateY, expectedMaxY)

  const crop = geometry.getCropRectFromTransform({ scale: 4, ...clamped }, viewport)
  assertCropBounds(crop)
  assert.ok(crop.width >= 0.079)
})

test('draft edit state hydration fails closed and fit clears stale crop metadata', () => {
  assert.equal(
    JSON.stringify(geometry.sanitizeReelEditState(undefined, 1080, 1920)),
    JSON.stringify({
      framing: 'fit',
      crop: null,
      trim: null,
    }),
  )
  assert.equal(
    JSON.stringify(
      geometry.sanitizeReelEditState(
        {
          framing: 'crop',
          crop: { version: 1, x: -1, y: 0, width: 1, height: 1, aspectRatio: '9:16' },
        },
        1080,
        1920,
      ),
    ),
    JSON.stringify({ framing: 'fit', crop: null, trim: null }),
  )

  const crop = geometry.getDefaultCropRect(1920, 1080)
  const hydrated = geometry.sanitizeReelEditState({ framing: 'crop', crop }, 1920, 1080)
  assert.equal(hydrated.framing, 'crop')
  assert.equal(JSON.stringify(hydrated.crop), JSON.stringify(crop))
  assert.equal(hydrated.trim, null)
  assert.equal(
    JSON.stringify(geometry.sanitizeReelEditState({ framing: 'fit', crop }, 1920, 1080)),
    JSON.stringify({
      framing: 'fit',
      crop: null,
      trim: null,
    }),
  )

  const trim = { version: 1, startMs: 6_500, endMs: 24_000 }
  const cropAndTrim = geometry.sanitizeReelEditState(
    { framing: 'crop', crop, trim },
    1920,
    1080,
    40_000,
  )
  assert.equal(JSON.stringify(cropAndTrim.trim), JSON.stringify(trim))
  assert.equal(cropAndTrim.framing, 'crop')
})
