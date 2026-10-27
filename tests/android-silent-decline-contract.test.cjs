const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

test('Android hands the API address to the native call module at startup', () => {
  // The notification Decline button runs with no JS; native can only reach the
  // server if it already knows where the API is.
  const provider = read('src/providers/SystemCallProvider.tsx')
  assert.match(
    provider,
    /Platform\.OS !== 'android'[\s\S]*veloraSystemCalls\.setCallApiBaseUrl\(process\.env\.EXPO_PUBLIC_API_URL \|\| null\)/,
  )

  const wrapper = read('src/lib/systemCalls/veloraSystemCalls.ts')
  assert.match(wrapper, /setCallApiBaseUrl\?: \(url\?: string \| null\) => void/)
  assert.match(wrapper, /nativeModule\?\.setCallApiBaseUrl\?\.\(url \?\? null\)/)
})

test('both Android reject entry points use the shared silent-decline path', () => {
  const dir = 'modules/velora-system-calls/android/src/main/java/expo/modules/velorasystemcalls/'
  assert.match(read(`${dir}VeloraCallActionReceiver.kt`), /VeloraCallDecline\.handleReject\(/)
  assert.match(read(`${dir}VeloraIncomingCallActivity.kt`), /VeloraCallDecline\.handleReject\(/)
  // The decline token is a bearer credential: it must stay out of the journal.
  assert.doesNotMatch(read(`${dir}VeloraSystemCallStore.kt`), /"declineToken"/)
})
