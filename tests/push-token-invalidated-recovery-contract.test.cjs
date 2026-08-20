const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const providerPath = path.join(__dirname, '..', 'src', 'providers', 'FcmDebugProvider.tsx')
const source = fs.readFileSync(providerPath, 'utf8')

test('FCM provider rotates a token rejected as terminal-invalid', () => {
  assert.match(source, /FCM_TOKEN_INVALIDATED/)
  assert.match(source, /await deleteCurrentFcmToken\(\)/)

  const deleteIndex = source.indexOf('await deleteCurrentFcmToken()')
  const replacementIndex = source.indexOf('const replacementTokenResult = await getFcmTokenForDebug()', deleteIndex)
  const reRegisterIndex = source.indexOf('return registerFcmToken(', replacementIndex)

  assert.notEqual(deleteIndex, -1)
  assert.notEqual(replacementIndex, -1)
  assert.notEqual(reRegisterIndex, -1)
  assert.ok(deleteIndex < replacementIndex)
  assert.ok(replacementIndex < reRegisterIndex)
})

test('FCM provider reboots registration whenever an authenticated app returns active', () => {
  assert.match(source, /AppState\.addEventListener\('change'/)
  assert.match(source, /nextState !== 'active'/)
  assert.match(source, /setRegistrationRetryVersion\(\(version\) => version \+ 1\)/)
})
