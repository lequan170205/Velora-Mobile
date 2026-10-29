const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

const read = (...parts) => readFileSync(join(__dirname, '..', ...parts), 'utf8')

test('the faded-out scroll-to-latest button does not take touches from the last messages', () => {
  const screen = read('app', 'conversation', '[id].tsx')
  assert.match(screen, /pointerEvents=\{isScrollButtonActive \? 'box-none' : 'none'\}/)
  assert.doesNotMatch(screen, /<Animated\.View\s+pointerEvents="box-none"\s+style=\{\[\s*scrollButtonStyle/)
})

test('the controller flips the active flag together with the animated visibility', () => {
  const controller = read('src', 'hooks', 'conversation', 'useConversationTimelineController.ts')
  assert.match(controller, /setIsScrollButtonActive\(shouldShowScrollButton\)/)
  assert.equal((controller.match(/setIsScrollButtonActive\(false\)/g) ?? []).length, 2)
  assert.match(controller, /^\s+isScrollButtonActive,$/m)
})
