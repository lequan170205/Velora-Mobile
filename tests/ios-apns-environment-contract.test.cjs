const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

const swift = readFileSync(
  join(__dirname, '..', 'modules', 'velora-system-calls', 'ios', 'VeloraSystemCallsModule.swift'),
  'utf8',
)

test('a Release build reports the APNs environment of its signing profile, not production by default', () => {
  const current = swift.slice(swift.indexOf('private func currentApnsEnvironment()'))
  assert.match(
    current.slice(0, current.indexOf('private func currentAppState')),
    /provisionedEnvironment: embeddedProvisionApsEnvironment\(\)/,
  )
  assert.match(swift, /forResource: "embedded", withExtension: "mobileprovision"/)
  assert.match(swift, /entitlements\["aps-environment"\] as\? String/)
})

test('the environment rule keeps debug as development and falls back to production without a profile', () => {
  assert.match(swift, /if isDebugBuild \{\s*return "development"\s*\}/)
  assert.match(swift, /\["development", "production"\]\.contains\(provisionedEnvironment\)/)
  assert.match(swift, /apnsEnvironment\(isDebugBuild: false, provisionedEnvironment: "development"\) == "development"/)
  assert.match(swift, /apnsEnvironment\(isDebugBuild: false, provisionedEnvironment: nil\) == "production"/)
})
