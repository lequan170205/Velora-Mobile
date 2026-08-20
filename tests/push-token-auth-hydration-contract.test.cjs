const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const authStorePath = path.join(__dirname, '..', 'src', 'stores', 'authStore.ts')
const source = fs.readFileSync(authStorePath, 'utf8')

test('authenticated session hydration resumes push-token registration before exposing auth state', () => {
  assert.match(
    source,
    /import \{ resumePushTokenRegistration \} from '\.\.\/lib\/notifications\/pushTokenOperationState'/,
  )

  const meIndex = source.indexOf('const data = await authApi.me()')
  const resumeIndex = source.indexOf('await resumePushTokenRegistration()', meIndex)
  const authenticatedSetIndex = source.indexOf(
    'set({ user: data, isAuthenticated: true, isLoading: false, authHydrationError: null })',
    meIndex,
  )

  assert.notEqual(meIndex, -1)
  assert.notEqual(resumeIndex, -1)
  assert.notEqual(authenticatedSetIndex, -1)
  assert.ok(resumeIndex > meIndex)
  assert.ok(resumeIndex < authenticatedSetIndex)
})
