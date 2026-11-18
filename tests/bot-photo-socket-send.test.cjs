const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

function loadSendMessageOverSocket() {
  const compiled = ts.transpileModule(read('src/lib/sendMessageOverSocket.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const module = { exports: {} }
  new Function('module', 'exports', compiled)(module, module.exports)
  return module.exports
}

const { sendMessageOverSocket } = loadSendMessageOverSocket()

class FakeSocket extends EventEmitter {
  constructor(connected = true) {
    super()
    this.connected = connected
    this.sent = []
  }
  // The real client's emit goes to the server; here it is recorded.
  emit(event, payload) {
    if (event === 'send_message') {
      this.sent.push(payload)
      return true
    }
    return super.emit(event, payload)
  }
  serverSays(event, payload) {
    super.emit(event, payload)
  }
}

const payload = {
  conversationId: 'conv-1',
  clientMessageId: 'client-1',
  content: 'find reels like this',
  type: 'image',
  media: { fileKey: 'chat-images/u/a.jpg', fileUrl: 'https://cdn/x.jpg', mimeType: 'image/jpeg' },
}

test('emits send_message with the media and resolves on the matching message_synced', async () => {
  const socket = new FakeSocket()
  const pending = sendMessageOverSocket(socket, payload, 1000)

  assert.equal(socket.sent.length, 1)
  assert.deepEqual(socket.sent[0], payload)

  socket.serverSays('message_synced', { id: 'other', clientMessageId: 'someone-else' })
  socket.serverSays('message_synced', { id: 'saved-1', clientMessageId: 'client-1' })
  assert.equal((await pending).id, 'saved-1')
  // Listeners are removed, so nothing leaks per photo.
  assert.equal(socket.listenerCount('message_synced'), 0)
  assert.equal(socket.listenerCount('message_failed'), 0)
  assert.equal(socket.listenerCount('disconnect'), 0)
})

test('rejects when the server answers message_failed for this message only', async () => {
  const socket = new FakeSocket()
  const pending = sendMessageOverSocket(socket, payload, 1000)

  socket.serverSays('message_failed', { conversationId: 'conv-1', clientMessageId: 'other' })
  socket.serverSays('message_failed', { conversationId: 'conv-1', clientMessageId: 'client-1' })
  await assert.rejects(pending, /rejected/)
  assert.equal(socket.listenerCount('message_synced'), 0)
})

test('rejects when the socket drops or never answers, and rejects at once when not connected', async () => {
  const dropped = new FakeSocket()
  const droppedPending = sendMessageOverSocket(dropped, payload, 1000)
  dropped.serverSays('disconnect')
  await assert.rejects(droppedPending, /disconnected/)

  const silent = new FakeSocket()
  await assert.rejects(sendMessageOverSocket(silent, payload, 20), /timed out/)
  assert.equal(silent.listenerCount('message_synced'), 0)

  const offline = new FakeSocket(false)
  await assert.rejects(sendMessageOverSocket(offline, payload, 1000), /not connected/)
  assert.equal(offline.sent.length, 0)
})

test('the upload provider sends bot-chat photos over the socket only, with no HTTP fallback', () => {
  const provider = read('src/providers/ChatMediaUploadProvider.tsx')

  assert.match(provider, /import \{ sendMessageOverSocket \} from '..\/lib\/sendMessageOverSocket'/)
  // Only a photo in a bot conversation takes the socket; other media keeps its existing send.
  assert.match(
    provider,
    /job\.type === 'image' &&\s*useChatStore\.getState\(\)\.isBotConversation\(job\.conversationId\)/,
  )
  assert.match(provider, /savedMessage = await sendMessageOverSocket\(activeSocket, \{/)
  // A socket that is not ready throws (so the job is requeued) instead of falling back to HTTP.
  assert.match(provider, /throw new Error\('socket is not ready'\)/)
  assert.doesNotMatch(provider, /retrying over HTTP/)
  // The one remaining HTTP send is the else branch for non-bot-photo media.
  assert.equal(provider.match(/conversationApi\.sendMessage\(/g).length, 1)
  assert.match(provider, /\} else \{\s*savedMessage = await conversationApi\.sendMessage/)
  // The retry that follows a transport failure reuses the clientMessageId.
  assert.match(provider, /const outgoingMessage = \{\s*clientMessageId,/)
})
