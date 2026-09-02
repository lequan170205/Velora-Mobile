const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('login remains visually fixed while preserving keyboard focus recovery', () => {
  const source = read('app/(auth)/login.tsx')

  assert.match(source, /useKeyboardState\(\(state\) => state\.isVisible\)/)
  assert.match(
    source,
    /const isKeyboardInteractionActive =[\s\S]*?isEmailFocused \|\| isPasswordFocused \|\| isKeyboardVisible/,
  )
  assert.match(
    source,
    /<ShortFormScreen[\s\S]*?scrollEnabled=\{isKeyboardInteractionActive\}[\s\S]*?mode="insets"/,
  )
  assert.match(source, /className="mt-3 h-11 flex-row items-center"/)
  assert.match(source, /accessibilityRole="alert"/)
  assert.match(source, /accessibilityLiveRegion="polite"/)
  assert.doesNotMatch(source, /error \? \([\s\S]{0,120}mt-4 rounded-\[16px\]/)
  assert.match(source, /<AuthBrandHeader \/>/)
  assert.match(source, /Continue with Google/)
  assert.match(source, /Don&apos;t have an account\?/)
})

test('short-form overflow recovery never adds bounce to fitting screens', () => {
  const source = read('src/components/base/ShortFormScreen.tsx')

  assert.match(source, /const shouldScroll = scrollEnabled \?\? contentOverflows/)
  assert.match(source, /bounces=\{false\}/)
  assert.match(source, /alwaysBounceVertical=\{false\}/)
  assert.match(source, /overScrollMode="never"/)
})
