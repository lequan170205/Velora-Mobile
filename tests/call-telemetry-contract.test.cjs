const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')

const loadTypeScriptModule = (file, mocks) => {
  const source = fs.readFileSync(file, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: file,
  }).outputText
  const loadedModule = { exports: {} }
  const localRequire = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier]
    return require(specifier)
  }
  const evaluate = new Function('require', 'module', 'exports', compiled)
  evaluate(localRequire, loadedModule, loadedModule.exports)
  return loadedModule.exports
}

test('one telemetry persistence failure is quarantined and does not block later events', async () => {
  let insertAttempt = 0
  const persistedStages = []
  const telemetry = loadTypeScriptModule(path.join(root, 'src/lib/call/callTelemetry.ts'), {
    'expo-constants': { expoConfig: { version: 'test' } },
    'react-native': { Platform: { OS: 'ios', Version: 'test' } },
    '../../api/callTelemetry.api': { callTelemetryApi: { track: async () => undefined } },
    '../../database/calls/callTelemetryOutbox': {
      deleteCallTelemetryOutboxItems: async () => undefined,
      dropOldestCallTelemetryQualitySamples: async () => 0,
      getCallTelemetryOutboxCount: async () => 0,
      getCallTelemetryOutboxItems: async () => [],
      insertCallTelemetryOutboxItems: async (items) => {
        insertAttempt += 1
        if (insertAttempt === 1) throw new Error('database temporarily unavailable')
        persistedStages.push(JSON.parse(items[0].payloadJson).stage)
      },
      markCallTelemetryOutboxItemsAttempted: async () => undefined,
    },
    '../network': { getIsOnline: async () => false },
    '../uuid': { createUuid: () => '00000000-0000-4000-8000-000000000000' },
    './callLifecycle': {
      callLifecycleTelemetryStage: (state) => `lifecycle:${state}`,
      reduceCallLifecycle: (_current, next) => next,
    },
  })

  const session = new telemetry.CallTelemetrySession('incoming')
  session.record('first_write_fails')
  session.record('second_write_survives')

  await telemetry.flushCallTelemetry()

  assert.equal(insertAttempt, 2)
  assert.deepEqual(persistedStages, ['second_write_survives'])
})

test('one permanently rejected telemetry event does not block later events in the outbox', async () => {
  const events = [
    {
      id: 'bad-event',
      payloadJson: JSON.stringify({ stage: 'bad_token' }),
    },
    {
      id: 'good-event',
      payloadJson: JSON.stringify({ stage: 'control_plane_active' }),
    },
  ]
  const trackedBatches = []

  const telemetry = loadTypeScriptModule(path.join(root, 'src/lib/call/callTelemetry.ts'), {
    'expo-constants': { expoConfig: { version: 'test' } },
    'react-native': { Platform: { OS: 'ios', Version: 'test' } },
    '../../api/callTelemetry.api': {
      callTelemetryApi: {
        track: async (batch) => {
          trackedBatches.push(batch.map((event) => event.stage))
          if (batch.some((event) => event.stage === 'bad_token')) {
            const error = new Error('invalid telemetry token')
            error.response = { status: 400 }
            throw error
          }
        },
      },
    },
    '../../database/calls/callTelemetryOutbox': {
      deleteCallTelemetryOutboxItems: async (records) => {
        const ids = new Set(records.map((record) => record.id))
        for (let index = events.length - 1; index >= 0; index -= 1) {
          if (ids.has(events[index].id)) events.splice(index, 1)
        }
      },
      dropOldestCallTelemetryQualitySamples: async () => 0,
      getCallTelemetryOutboxCount: async () => events.length,
      getCallTelemetryOutboxItems: async () => [...events],
      insertCallTelemetryOutboxItems: async () => undefined,
      markCallTelemetryOutboxItemsAttempted: async () => {
        throw new Error('permanent failures must not be retried')
      },
    },
    '../network': { getIsOnline: async () => true },
    '../uuid': { createUuid: () => '00000000-0000-4000-8000-000000000000' },
    './callLifecycle': {
      callLifecycleTelemetryStage: (state) => `lifecycle:${state}`,
      reduceCallLifecycle: (_current, next) => next,
    },
  })

  assert.equal(await telemetry.flushCallTelemetry(), true)

  assert.deepEqual(trackedBatches, [
    ['bad_token', 'control_plane_active'],
    ['bad_token'],
    ['control_plane_active'],
  ])
  assert.deepEqual(events, [])
})

test('telemetry authorization stays in memory and never enters the local outbox', async () => {
  const events = []
  const persistedPayloads = []
  const trackedBatches = []
  const telemetry = loadTypeScriptModule(path.join(root, 'src/lib/call/callTelemetry.ts'), {
    'expo-constants': { expoConfig: { version: 'test' } },
    'react-native': { Platform: { OS: 'ios', Version: 'test' } },
    '../../api/callTelemetry.api': {
      callTelemetryApi: {
        track: async (batch) => trackedBatches.push(batch),
      },
    },
    '../../database/calls/callTelemetryOutbox': {
      deleteCallTelemetryOutboxItems: async (records) => {
        const ids = new Set(records.map((record) => record.id))
        for (let index = events.length - 1; index >= 0; index -= 1) {
          if (ids.has(events[index].id)) events.splice(index, 1)
        }
      },
      dropOldestCallTelemetryQualitySamples: async () => 0,
      getCallTelemetryOutboxCount: async () => events.length,
      getCallTelemetryOutboxItems: async () => [...events],
      insertCallTelemetryOutboxItems: async (items) => {
        for (const item of items) {
          persistedPayloads.push(JSON.parse(item.payloadJson))
          events.push({ id: item.eventId, payloadJson: item.payloadJson })
        }
      },
      markCallTelemetryOutboxItemsAttempted: async () => undefined,
    },
    '../network': { getIsOnline: async () => true },
    '../uuid': { createUuid: () => '00000000-0000-4000-8000-000000000000' },
    './callLifecycle': {
      callLifecycleTelemetryStage: (state) => `lifecycle:${state}`,
      reduceCallLifecycle: (_current, next) => next,
    },
  })

  const session = new telemetry.CallTelemetrySession('incoming')
  session.attachCall('sensitive-call-telemetry-token')
  session.record('server_accept_ack')
  await telemetry.flushCallTelemetry()

  assert.equal(events.length, 0)
  assert.equal(persistedPayloads[0].telemetryToken, undefined)
  assert.equal(trackedBatches.length, 1)
  assert.equal(trackedBatches[0][0].telemetryToken, 'sensitive-call-telemetry-token')
})
