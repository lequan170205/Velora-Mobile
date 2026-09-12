const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('settings keeps local auth until remote logout succeeds', () => {
  const source = read('app/settings.tsx')

  assert.match(source, /let shouldClearAuth = false/)
  assert.match(source, /const logoutResult = await performLogoutPushTokenCleanup\(\)/)
  assert.match(source, /if \(!logoutResult\.ok\) \{\s*setFeedbackMessage\("Couldn't sign out\. Try again\."\)\s*return/)
  assert.match(source, /if \(action === 'sign-out' && shouldClearAuth\) \{\s*clearAuth\(\)/)
  assert.doesNotMatch(source, /if \(action === 'sign-out'\) \{\s*clearAuth\(\)/)
})

test('profile completion keeps local auth until remote logout succeeds', () => {
  const source = read('app/complete-profile.tsx')

  assert.match(source, /let shouldClearAuth = false/)
  assert.match(source, /const logoutResult = await performLogoutPushTokenCleanup\(\)/)
  assert.match(source, /if \(!logoutResult\.ok\) \{\s*setError\('Unable to sign out\. Check your connection and try again\.'\)\s*return/)
  assert.match(source, /if \(shouldClearAuth\) \{\s*clearAuth\(\)/)
})
