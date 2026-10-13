const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const loadTypingPresence = () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'lib', 'typingPresence.ts'),
    'utf8',
  )
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loadedModule = { exports: {} }
  new Function('module', 'exports', compiled)(loadedModule, loadedModule.exports)
  return loadedModule.exports
}

const setup = (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const presence = loadTypingPresence()
  const events = []
  const emitter = presence.createTypingEmitter({
    emitStart: () => events.push('start'),
    emitStop: () => events.push('stop'),
  })
  return { emitter, events, presence }
}

test('the sender emits typing_start once per heartbeat instead of per keystroke', (t) => {
  const { emitter, events, presence } = setup(t)

  emitter.onInput('h')
  for (let index = 0; index < 10; index += 1) {
    t.mock.timers.tick(200)
    emitter.onInput('hello'.slice(0, (index % 5) + 1))
  }
  assert.deepEqual(events, ['start'], 'ten keystrokes within a heartbeat emit one start')

  t.mock.timers.tick(presence.TYPING_HEARTBEAT_MS - 2000)
  emitter.onInput('hello there')
  assert.deepEqual(events, ['start', 'start'], 'continued typing refreshes after a heartbeat')
})

test('the sender stops after idling, on an empty composer and on send', (t) => {
  const { emitter, events, presence } = setup(t)

  emitter.onInput('hi')
  t.mock.timers.tick(presence.TYPING_IDLE_STOP_MS)
  assert.deepEqual(events, ['start', 'stop'])

  emitter.onInput('again')
  assert.deepEqual(events, ['start', 'stop', 'start'], 'typing after a stop starts again at once')

  emitter.onInput('   ')
  assert.deepEqual(events, ['start', 'stop', 'start', 'stop'])
  t.mock.timers.tick(presence.TYPING_IDLE_STOP_MS)
  assert.equal(events.length, 4, 'the empty-composer stop cancels the idle timer')

  emitter.onInput('send me')
  emitter.stop()
  t.mock.timers.tick(presence.TYPING_IDLE_STOP_MS)
  assert.deepEqual(events.slice(4), ['start', 'stop'], 'send stops once and clears the idle timer')
})

test('dispose forgets typing state without emitting', (t) => {
  const { emitter, events, presence } = setup(t)

  emitter.onInput('hi')
  emitter.dispose()
  t.mock.timers.tick(presence.TYPING_IDLE_STOP_MS)
  assert.deepEqual(events, ['start'])

  emitter.onInput('hi')
  assert.deepEqual(events, ['start', 'start'], 'the next input starts a fresh session')
})

test('receivers expire an indicator whose typing_stop never arrives', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { createTypingExpiry, TYPING_INDICATOR_TTL_MS, TYPING_HEARTBEAT_MS } = loadTypingPresence()
  const expired = []
  const expiry = createTypingExpiry((conversationId, userId) =>
    expired.push(`${conversationId}/${userId}`),
  )

  assert.ok(
    TYPING_INDICATOR_TTL_MS > TYPING_HEARTBEAT_MS,
    'a live heartbeat always refreshes in time',
  )

  expiry.refresh('c1', 'alice')
  t.mock.timers.tick(TYPING_HEARTBEAT_MS)
  expiry.refresh('c1', 'alice')
  t.mock.timers.tick(TYPING_INDICATOR_TTL_MS - 1)
  assert.deepEqual(expired, [], 'refreshed by the heartbeat')
  t.mock.timers.tick(1)
  assert.deepEqual(expired, ['c1/alice'])

  expiry.refresh('c1', 'bob')
  expiry.cancel('c1', 'bob')
  expiry.refresh('c2', 'carol')
  expiry.refresh('c3', 'dave')
  expiry.cancelConversation('c2')
  t.mock.timers.tick(TYPING_INDICATOR_TTL_MS)
  assert.deepEqual(expired, ['c1/alice', 'c3/dave'], 'cancelled entries never expire')
})
