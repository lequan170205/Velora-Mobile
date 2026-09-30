const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'api', 'notification.api.ts'),
  'utf8',
)

test('FCM and VoIP registration explicitly declare group lifecycle v2', () => {
  const constants = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'lib', 'call', 'callConstants.ts'),
    'utf8',
  )
  assert.match(constants, /export const GROUP_LIFECYCLE_VERSION = 2/)
  assert.match(source, /import \{ GROUP_LIFECYCLE_VERSION \} from '\.\.\/lib\/call\/callConstants'/)

  const fcmRegistration = source.slice(
    source.indexOf('export async function registerPushToken'),
    source.indexOf('export async function registerVoipPushToken'),
  )
  const voipRegistration = source.slice(
    source.indexOf('export async function registerVoipPushToken'),
    source.indexOf('export async function deactivateVoipPushToken'),
  )

  assert.match(fcmRegistration, /groupLifecycleVersion: GROUP_LIFECYCLE_VERSION/)
  assert.match(voipRegistration, /groupLifecycleVersion: GROUP_LIFECYCLE_VERSION/)
})
