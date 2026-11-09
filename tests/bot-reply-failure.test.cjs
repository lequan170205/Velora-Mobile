const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')

function loadPolicies() {
  const source = fs.readFileSync(
    path.join(root, 'src/lib/conversation/botReplyFailurePolicies.ts'),
    'utf8',
  )
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  new Function('module', 'exports', compiled)(module, module.exports)
  return module.exports
}

const { describeBotReplyFailure, normalizeBotReplyFailurePayload } = loadPolicies()

const payload = (error, overrides = {}) => ({
  conversationId: 'conversation-1',
  userMessageId: 'message-1',
  clientMessageId: 'client-1',
  error,
  ...overrides,
})

test('a rate-limited payload keeps the code and a whole-second wait', () => {
  assert.deepEqual(
    normalizeBotReplyFailurePayload(
      payload({ code: 'RATE_LIMITED', message: 'slow down', retryAfterSeconds: 11.2 }),
    ),
    {
      conversationId: 'conversation-1',
      code: 'RATE_LIMITED',
      serverMessage: 'slow down',
      retryAfterSeconds: 12,
    },
  )
})

test('retryAfterSeconds is clamped and ignored when it is not a finite number', () => {
  const wait = (value) =>
    normalizeBotReplyFailurePayload(payload({ code: 'RATE_LIMITED', retryAfterSeconds: value }))
      .retryAfterSeconds
  assert.equal(wait(0), 1)
  assert.equal(wait(-30), 1)
  assert.equal(wait(999999), 3600)
  assert.equal(wait('12'), undefined)
  assert.equal(wait(Number.NaN), undefined)
  assert.equal(wait(Infinity), undefined)
})

test('an unrecognised code is treated as UNKNOWN and an oversized server message is cut', () => {
  const failure = normalizeBotReplyFailurePayload(
    payload({ code: 'SOMETHING_NEW', message: 'x'.repeat(500) }),
  )
  assert.equal(failure.code, 'UNKNOWN')
  assert.equal(failure.serverMessage.length, 200)
})

test('malformed payloads are ignored instead of throwing', () => {
  for (const bad of [
    null,
    undefined,
    'text',
    42,
    {},
    { conversationId: 'c' },
    { conversationId: '  ', error: { code: 'UNKNOWN' } },
    { conversationId: 'c', error: 'nope' },
  ]) {
    assert.equal(normalizeBotReplyFailurePayload(bad), null)
  }
})

test('rate-limited wording reflects the wait, with singular and minutes handled', () => {
  const text = (retryAfterSeconds) =>
    describeBotReplyFailure({
      conversationId: 'c',
      code: 'RATE_LIMITED',
      ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    })
  assert.match(text(12), /too quickly\. Please try again in 12 seconds\.$/)
  assert.match(text(1), /in 1 second\.$/)
  assert.match(text(61), /in 2 minutes\.$/)
  assert.match(text(60), /in 1 minute\.$/)
  assert.match(text(), /wait a moment and try again\.$/)
})

test('each known code has client wording that never echoes server text', () => {
  const text = (code) =>
    describeBotReplyFailure({ conversationId: 'c', code, serverMessage: 'SERVER-INTERNAL-DETAIL' })
  assert.equal(text('NO_CONTENT'), 'No relevant video content found for this query.')
  assert.equal(text('AI_UNAVAILABLE'), 'Velora AI is temporarily unavailable. Please try again.')
  assert.doesNotMatch(text('RATE_LIMITED'), /SERVER-INTERNAL-DETAIL/)
  // Only a code this client does not recognise falls back to the server's own words.
  assert.equal(text('UNKNOWN'), 'SERVER-INTERNAL-DETAIL')
  assert.equal(
    describeBotReplyFailure({ conversationId: 'c', code: 'UNKNOWN' }),
    'Velora AI could not answer that. Please try again.',
  )
})

test('the socket provider shows the notice and drops it when a real bot reply starts', () => {
  const provider = fs.readFileSync(path.join(root, 'src/providers/SocketProvider.tsx'), 'utf8')

  assert.match(provider, /newSocket\.on\('bot_reply_failed',/)
  assert.match(provider, /normalizeBotReplyFailurePayload\(payload\)/)
  assert.match(provider, /showBotReplyFailureNotice\(failure\)/)

  // The notice is in-memory only, with its own id so it can never be mistaken for the stream.
  assert.match(provider, /BOT_NOTICE_TEMP_ID_PREFIX = 'temp-bot-notice:'/)
  assert.match(provider, /!message\.id\.startsWith\(BOT_NOTICE_TEMP_ID_PREFIX\)/)

  // Removed when streaming starts and when a confirmed bot message arrives.
  const upsertStart = provider.indexOf('const upsertStreamingBotMessage')
  const upsertBlock = provider.slice(upsertStart, upsertStart + 1400)
  assert.match(upsertBlock, /removeBotReplyFailureNotice\(payload\.conversationId\)/)
  assert.match(
    provider,
    /markAsBotConversation\(conversationId\)\s*removeBotReplyFailureNotice\(conversationId\)\s*reconcileStreamingBotMessage\(message\)/,
  )
})
