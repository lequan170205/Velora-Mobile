const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../src/lib/call/mediasoup.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const loadedModule = { exports: {} }
new Function('require', 'module', 'exports', compiled)(
  () => ({}),
  loadedModule,
  loadedModule.exports,
)
const { toTransportOptions } = loadedModule.exports
const payload = {
  callId: 'call-1',
  transportId: 'transport-1',
  iceParameters: { usernameFragment: 'sfu' },
  iceCandidates: [{ ip: '203.0.113.1', port: 40000 }],
  dtlsParameters: { role: 'auto', fingerprints: [] },
}

test('old backend payloads retain direct ICE without TURN', () => {
  const options = toTransportOptions(payload)
  assert.equal(options.iceTransportPolicy, 'all')
  assert.equal(Object.hasOwn(options, 'iceServers'), false)
  assert.deepEqual(options.iceCandidates, payload.iceCandidates)
})

for (const direction of ['send', 'recv']) {
  test(`${direction} transport receives provider TURN config and retains direct candidates`, () => {
    const iceServers = [
      {
        urls: ['turn:relay.example.com:80', 'turns:relay.example.com:443?transport=tcp'],
        username: 'test-user',
        credential: 'test-password',
      },
    ]
    const options = toTransportOptions({ ...payload, direction, iceServers })
    assert.deepEqual(options.iceServers, iceServers)
    assert.equal(options.iceTransportPolicy, 'all')
    assert.deepEqual(options.iceCandidates, payload.iceCandidates)
    assert.deepEqual(options.iceParameters, payload.iceParameters)
    assert.deepEqual(options.dtlsParameters, payload.dtlsParameters)
  })
}
