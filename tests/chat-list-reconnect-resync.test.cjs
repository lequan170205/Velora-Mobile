const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../src/providers/SocketProvider.tsx'), 'utf8')
const ast = ts.createSourceFile(
  'SocketProvider.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)

// The real handlers the provider registers with `newSocket.on(<event>, <handler>)`.
const handlerSource = {}
const visit = (node) => {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(ast) === 'newSocket.on' &&
    node.arguments.length === 2 &&
    ts.isStringLiteral(node.arguments[0])
  ) {
    handlerSource[node.arguments[0].text] = node.arguments[1].getText(ast)
  }
  ts.forEachChild(node, visit)
}
visit(ast)

const conversationListKey = ['conversations']

const loadChatSocket = () => {
  const invalidations = []
  const noop = () => undefined
  const stubs = {
    newSocket: { disconnected: false, active: true, connect: noop },
    serverDisconnectReconnectTimeoutRef: { current: null },
    lastConnectErrorMessageRef: { current: null },
    flushingOfflineMessageIdsRef: { current: new Set() },
    flushingOfflineConversationIdsRef: { current: new Set() },
    joinedConversationIds: new Set(),
    setIsConnected: noop,
    joinConversationRooms: noop,
    getLocalConversationIds: async () => [],
    flushOfflineQueueWhenReady: noop,
    clearAllOfflineMessageAckTimeouts: noop,
    clearStreamingBotMessages: noop,
    useChatStore: { getState: () => ({ clearOnlineUsers: noop }), setState: noop },
    useAuthStore: { getState: () => ({ isAuthenticated: true, user: { id: 'user-a' } }) },
    queryKeys: { conversations: { all: conversationListKey } },
    queryClient: {
      getQueryData: () => [],
      invalidateQueries: async (filters) => {
        invalidations.push(filters)
      },
    },
    console: { warn: noop },
    process: { env: {} },
  }
  const code = ts.transpileModule(
    `let wasDown = false
     return {
       connect: ${handlerSource.connect},
       disconnect: ${handlerSource.disconnect},
       connectError: ${handlerSource.connect_error},
     }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText
  const handlers = new Function(...Object.keys(stubs), code)(...Object.values(stubs))
  return { ...handlers, invalidations }
}

test('the first connection leaves the conversation list to its own first load', () => {
  const socket = loadChatSocket()
  socket.connect()
  assert.deepEqual(socket.invalidations, [])
})

test('a socket that comes back after a drop reads the conversation list again, and only the list', () => {
  const socket = loadChatSocket()
  socket.connect()
  socket.disconnect('transport close')
  socket.connect()
  assert.deepEqual(socket.invalidations, [{ queryKey: conversationListKey, exact: true }])
})

test('each drop causes one new read of the list', () => {
  const socket = loadChatSocket()
  socket.connect()
  socket.disconnect('ping timeout')
  socket.connect()
  socket.disconnect('transport close')
  socket.connect()
  assert.equal(socket.invalidations.length, 2)
})

test('a first connection that only succeeded after failed attempts also reads the list again', () => {
  const socket = loadChatSocket()
  socket.connectError(new Error('timeout'))
  socket.connect()
  assert.deepEqual(socket.invalidations, [{ queryKey: conversationListKey, exact: true }])
})
