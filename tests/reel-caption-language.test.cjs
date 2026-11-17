const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')

function load(file, stubs = {}) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  const require_ = (name) => {
    if (name in stubs) return stubs[name]
    throw new Error(`unexpected import ${name}`)
  }
  new Function('module', 'exports', 'require', compiled)(module, module.exports, require_)
  return module.exports
}

const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const { getActiveSubtitleText, normalizeSubtitleCues } = load('src/lib/reelSubtitles.ts')
const { parseStoredCaptionLanguage, REEL_CAPTION_LANGUAGES, DEFAULT_REEL_CAPTION_LANGUAGE } = load(
  'src/lib/reelPlaybackPreferences.ts',
  { '@react-native-async-storage/async-storage': { default: {} } },
)

const cues = [
  { index: 0, start: 1, end: 3, text: 'Tôi là con gái của Định Bắc Vương.' },
  { index: 1, start: 3.1, end: 4, text: 'Chủ.' },
  { index: 2, start: 10, end: 12, text: 'Tạm biệt.' },
]

test('a caption line shows from its start until it ends, and not before', () => {
  assert.equal(getActiveSubtitleText(cues, 0.5), '')
  assert.equal(getActiveSubtitleText(cues, 1), cues[0].text)
  assert.equal(getActiveSubtitleText(cues, 2.9), cues[0].text)
})

test('a line lingers briefly after its end but never into the next line', () => {
  assert.equal(getActiveSubtitleText(cues, 3.05), cues[0].text)
  assert.equal(getActiveSubtitleText(cues, 3.1), cues[1].text)
  assert.equal(getActiveSubtitleText(cues, 4.2), cues[1].text)
  assert.equal(getActiveSubtitleText(cues, 4.3), '')
})

test('there is no caption in a long pause or after the last line', () => {
  assert.equal(getActiveSubtitleText(cues, 7), '')
  assert.equal(getActiveSubtitleText(cues, 12.1), cues[2].text)
  assert.equal(getActiveSubtitleText(cues, 13), '')
})

test('missing cues or an invalid position give no caption', () => {
  assert.equal(getActiveSubtitleText(undefined, 2), '')
  assert.equal(getActiveSubtitleText([], 2), '')
  assert.equal(getActiveSubtitleText(cues, Number.NaN), '')
})

test('server cues are cleaned and put in time order', () => {
  assert.deepEqual(
    normalizeSubtitleCues([
      { index: 1, start: 5, end: 6, text: '  b  ' },
      { index: 0, start: 1, end: 2, text: 'a' },
      { index: 2, start: 7, end: 8, text: '   ' },
      { index: 3, start: 'x', end: 8, text: 'bad' },
      null,
    ]),
    [
      { index: 0, start: 1, end: 2, text: 'a' },
      { index: 1, start: 5, end: 6, text: 'b' },
    ],
  )
  assert.deepEqual(normalizeSubtitleCues('nope'), [])
})

test('the saved caption language is one of the offered choices, defaulting to the spoken one', () => {
  assert.deepEqual([...REEL_CAPTION_LANGUAGES], ['original', 'vi', 'en'])
  assert.equal(DEFAULT_REEL_CAPTION_LANGUAGE, 'original')
  assert.equal(parseStoredCaptionLanguage('"vi"'), 'vi')
  assert.equal(parseStoredCaptionLanguage('"en"'), 'en')
  for (const bad of [null, '', '"fr"', 'vi', '42', '{']) {
    assert.equal(parseStoredCaptionLanguage(bad), 'original')
  }
})

test('the translated captions request is long enough for a first-time translation', () => {
  const api = read('src/api/reels.api.ts')
  assert.match(api, /\/content\/reels\/\$\{id\}\/subtitles/)
  assert.match(api, /params: \{ lang: language \}/)
  assert.match(api, /timeout: 120_000/)
})

test('translated captions are only requested while captions are visible', () => {
  const hook = read('src/hooks/useReelSubtitles.ts')
  assert.match(hook, /language !== 'original' && \(options\.enabled \?\? true\)/)
  const item = read('src/components/reels/ReelFeedItem.tsx')
  assert.match(
    item,
    /const captionsVisible = isActive && liveTranscriptionEnabled && !clearDisplay/,
  )
  assert.match(item, /useReelSubtitles\(reel\.id, captionLanguage, \{\s*enabled: captionsVisible/)
})

test('translated captions replace the spoken ones, and the spoken ones stay while loading or on failure', () => {
  const item = read('src/components/reels/ReelFeedItem.tsx')
  assert.match(item, /isTranslatedCaptions && translatedCaptions\.data/)
  assert.match(item, /: spokenTranscriptText/)
  assert.match(item, /Translating captions…/)
  assert.match(item, /Translation unavailable · showing original/)
})

test('the caption language is chosen in the playback sheet and reaches the feed item', () => {
  const sheet = read('src/components/reels/ReelPlaybackOptionsSheet.tsx')
  assert.match(sheet, /Caption language/)
  assert.match(sheet, /onCaptionLanguageChange\(option\.value\)/)
  const viewer = read('src/components/reels/ReelsViewer.tsx')
  assert.match(viewer, /captionLanguage=\{captionLanguage\}/)
  assert.match(viewer, /onCaptionLanguageChange=\{setCaptionLanguage\}/)
  const item = read('src/components/reels/ReelFeedItem.tsx')
  assert.match(item, /previous\.captionLanguage === next\.captionLanguage/)
  assert.match(item, /previous\.onCaptionLanguageChange === next\.onCaptionLanguageChange/)
})

test('translated captions are warmed for the active and next reel, next to the reel detail', () => {
  const hook = read('src/hooks/useReelSubtitles.ts')
  assert.match(hook, /export const prefetchReelSubtitles/)
  assert.match(hook, /language === 'original'/)
  assert.match(hook, /retry: false/)
  const viewer = read('src/components/reels/ReelsViewer.tsx')
  assert.match(
    viewer,
    /void prefetchReelSubtitles\(queryClient, viewerId, reel\.id, captionLanguage\)/,
  )
})

test('the sheet shows translation progress and offers a retry', () => {
  const sheet = read('src/components/reels/ReelPlaybackOptionsSheet.tsx')
  assert.match(sheet, /captionLanguageStatus === 'loading'/)
  assert.match(sheet, /accessibilityLabel="Retry translation"/)
  const item = read('src/components/reels/ReelFeedItem.tsx')
  assert.match(item, /onRetryCaptionLanguage=\{handleRetryTranslatedCaptions\}/)
})
