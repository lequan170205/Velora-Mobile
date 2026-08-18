const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const chatScreenPath = path.resolve(__dirname, '../app/conversation/[id].tsx')
const readSource = () => fs.readFileSync(chatScreenPath, 'utf8')

const getBlock = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)

  const end = source.indexOf(endMarker, start)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)

  return source.slice(start, end)
}

test('newest-message bottom follow defers exactly one frame on Android and stays immediate on iOS', () => {
  const source = readSource()
  const helper = getBlock(
    source,
    'const scrollToBottomForNewestMessage = useCallback',
    'const handleComposerFocusChange',
  )

  assert.match(helper, /Platform\.OS === 'android'/)
  assert.match(helper, /requestAnimationFrame\(\(\) => \{\s*scrollToBottom\(\)\s*\}\)/)
  assert.match(helper, /return\s*\}\s*scrollToBottom\(\)/)
  assert.doesNotMatch(
    helper,
    /requestAnimationFrame\(\(\) => \{\s*requestAnimationFrame/,
  )
})

test('both optimistic outgoing and incoming newest-message paths use the platform-aware follow helper', () => {
  const source = readSource()
  const effect = getBlock(
    source,
    'if (newestMessageId && newestMessageId !== prevNewestMessageId.current)',
    'prevNewestMessageId.current = newestMessageId',
  )

  const calls = effect.match(/scrollToBottomForNewestMessage\(\)/g) ?? []
  assert.equal(calls.length, 2)
  assert.doesNotMatch(effect, /nextScrollMode === 'animated'\) \{\s*scrollToBottom\(\)/)
})
