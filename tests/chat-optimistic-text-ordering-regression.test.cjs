const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const { loadTypeScriptModule } = require('./chat-timeline-test-utils.cjs')

const lifecycleModule = loadTypeScriptModule({
  filename: path.resolve(__dirname, '../src/lib/optimisticSortAnchorLifecycle.ts'),
})

const getIdentityTokens = (message) =>
  Array.from(new Set([message.id, message._id, message.clientMessageId].filter(Boolean)))
const getIdentityKey = (message) => message.clientMessageId ?? message.id ?? message._id ?? null
const mergeByIdentity = (messages) => {
  const merged = []

  for (const message of messages) {
    const tokens = new Set(getIdentityTokens(message))
    const index = merged.findIndex((candidate) =>
      getIdentityTokens(candidate).some((token) => tokens.has(token)),
    )

    if (index === -1) {
      merged.push(message)
    } else {
      merged[index] = { ...merged[index], ...message }
    }
  }

  return merged
}

const messageListModule = loadTypeScriptModule({
  filename: path.resolve(__dirname, '../src/lib/messageListState.ts'),
  mocks: {
    './messageIdentity': {
      getMessageIdentityKey: getIdentityKey,
      getMessageIdentityTokens: getIdentityTokens,
      mergeMessageCollectionByIdentity: mergeByIdentity,
    },
  },
})

const {
  pruneSettledTextOptimisticSortAnchors,
  removeOptimisticSortAnchorsWithTextLease,
  settleTextOptimisticSortAnchors,
} = lifecycleModule
const { buildMessageListState } = messageListModule

const makeMessage = ({
  clientMessageId,
  createdAt,
  id = clientMessageId,
  media,
  status = 'PENDING',
  type = media ? 'image' : 'text',
}) => ({
  id,
  clientMessageId,
  conversationId: 'conversation-1',
  senderId: 'user-me',
  sender: { id: 'user-me' },
  content: clientMessageId,
  ...(media ? { media } : {}),
  type,
  status,
  createdAt,
  updatedAt: createdAt,
})

const makeAnchor = ({ frontierCreatedAtMs, frontierMessageId, sequence, batchId }) => ({
  frontierCreatedAtMs,
  frontierMessageId,
  sequence,
  ...(batchId !== undefined ? { batchId } : {}),
})

const M0_TIME = Date.parse('2026-01-01T00:00:00.000Z')
const A_SERVER_TIME = '2026-01-01T00:00:01.000Z'
const B_SERVER_TIME = '2026-01-01T00:00:02.000Z'
const C_SERVER_TIME = '2026-01-01T00:00:03.000Z'
const D_SERVER_TIME = '2026-01-01T00:00:04.000Z'

const anchorsAB = {
  'temp-a': makeAnchor({ frontierCreatedAtMs: M0_TIME, frontierMessageId: 'm0', sequence: 1 }),
  'temp-b': makeAnchor({ frontierCreatedAtMs: M0_TIME, frontierMessageId: 'm0', sequence: 2 }),
}

const getOrderedClientIds = ({ localOptimistic, anchors, serverMessages }) => {
  const state = buildMessageListState({
    localOptimistic,
    optimisticSortAnchorsByMessageId: anchors,
    previousLayoutById: new Map(),
    serverMessages,
  })

  return state.orderedMessages.map((message) => message.clientMessageId ?? message.id)
}

test('text anchors stay leased while another non-failed optimistic owner remains', () => {
  const pendingB = makeMessage({
    clientMessageId: 'temp-b',
    createdAt: '2026-01-01T00:00:00.200Z',
  })

  const next = removeOptimisticSortAnchorsWithTextLease([pendingB], anchorsAB, ['temp-a'])

  assert.strictEqual(next, anchorsAB)
  assert.deepEqual(Object.keys(next).sort(), ['temp-a', 'temp-b'])
})

test('all settled anchors release together when no optimistic owner remains', () => {
  const next = settleTextOptimisticSortAnchors([], anchorsAB)

  assert.notStrictEqual(next, anchorsAB)
  assert.deepEqual(next, {})
})

test('failed newest optimistic keeps the earlier anchors required for its stable position', () => {
  const failedB = makeMessage({
    clientMessageId: 'temp-b',
    createdAt: '2026-01-01T00:00:00.200Z',
    status: 'FAILED',
  })

  const next = settleTextOptimisticSortAnchors([failedB], anchorsAB)

  assert.strictEqual(next, anchorsAB)
})

test('failed older optimistic does not pin newer settled anchors forever', () => {
  const failedA = makeMessage({
    clientMessageId: 'temp-a',
    createdAt: '2026-01-01T00:00:00.100Z',
    status: 'FAILED',
  })
  const anchorsABC = {
    ...anchorsAB,
    'temp-c': makeAnchor({ frontierCreatedAtMs: M0_TIME, frontierMessageId: 'm0', sequence: 3 }),
  }

  const next = settleTextOptimisticSortAnchors([failedA], anchorsABC)

  assert.deepEqual(Object.keys(next), ['temp-a'])
})

test('failed optimistic on a newer frontier retains its transitive older anchor chain', () => {
  const failedC = makeMessage({
    clientMessageId: 'temp-c',
    createdAt: '2026-01-01T00:00:01.100Z',
    status: 'FAILED',
  })
  const anchorsABC = {
    ...anchorsAB,
    'temp-c': makeAnchor({
      frontierCreatedAtMs: Date.parse(A_SERVER_TIME),
      frontierMessageId: 'server-a',
      sequence: 1,
    }),
  }
  const futureD = makeAnchor({
    frontierCreatedAtMs: Date.parse(C_SERVER_TIME),
    frontierMessageId: 'server-c',
    sequence: 1,
  })

  const next = settleTextOptimisticSortAnchors(
    [failedC],
    { ...anchorsABC, 'temp-d': futureD },
  )

  assert.deepEqual(Object.keys(next).sort(), ['temp-a', 'temp-b', 'temp-c'])
})

test('media batch cleanup cannot release a media anchor while text siblings are still pending', () => {
  const pendingA = makeMessage({
    clientMessageId: 'temp-a',
    createdAt: '2026-01-01T00:00:00.100Z',
  })
  const pendingB = makeMessage({
    clientMessageId: 'temp-b',
    createdAt: '2026-01-01T00:00:00.300Z',
  })
  const confirmedMedia = makeMessage({
    clientMessageId: 'temp-media',
    id: 'server-media',
    createdAt: A_SERVER_TIME,
    media: { fileUrl: 'https://example.test/image.jpg' },
    status: 'SENT',
  })
  const anchors = {
    'temp-a': makeAnchor({ frontierCreatedAtMs: M0_TIME, frontierMessageId: 'm0', sequence: 1 }),
    'temp-media': makeAnchor({
      frontierCreatedAtMs: M0_TIME,
      frontierMessageId: 'm0',
      sequence: 2,
      batchId: 'batch-1',
    }),
    'temp-b': makeAnchor({ frontierCreatedAtMs: M0_TIME, frontierMessageId: 'm0', sequence: 3 }),
  }

  const next = removeOptimisticSortAnchorsWithTextLease(
    [pendingA, pendingB],
    anchors,
    ['temp-media'],
  )

  assert.strictEqual(next, anchors)
  assert.deepEqual(
    getOrderedClientIds({
      localOptimistic: [pendingA, pendingB],
      anchors: next,
      serverMessages: [confirmedMedia],
    }),
    ['temp-b', 'temp-media', 'temp-a'],
  )
})

test('hydration pruning preserves an active mixed ordering domain and drops it once settled', () => {
  const activeB = makeMessage({
    clientMessageId: 'temp-b',
    createdAt: '2026-01-01T00:00:00.200Z',
  })
  const mediaAnchor = makeAnchor({
    frontierCreatedAtMs: M0_TIME,
    frontierMessageId: 'm0',
    sequence: 3,
    batchId: 'batch-1',
  })
  const anchors = { ...anchorsAB, 'temp-media': mediaAnchor }

  const withPendingText = pruneSettledTextOptimisticSortAnchors(
    { 'conversation-1': [activeB] },
    { 'conversation-1': anchors },
  )
  assert.strictEqual(withPendingText['conversation-1'], anchors)

  const withoutPendingOwners = pruneSettledTextOptimisticSortAnchors(
    {},
    { 'conversation-1': anchors },
  )
  assert.deepEqual(withoutPendingOwners, {})
})

test('A confirmation does not temporarily flip B ahead of A on the rendered timeline', () => {
  const pendingB = makeMessage({
    clientMessageId: 'temp-b',
    createdAt: '2026-01-01T00:00:00.200Z',
  })
  const confirmedA = makeMessage({
    id: 'server-a',
    clientMessageId: 'temp-a',
    createdAt: A_SERVER_TIME,
    status: 'SENT',
  })

  assert.deepEqual(
    getOrderedClientIds({
      localOptimistic: [pendingB],
      anchors: anchorsAB,
      serverMessages: [confirmedA],
    }),
    ['temp-b', 'temp-a'],
  )
})

test('A/B/C remain newest-first when B confirms while C is still pending', () => {
  const confirmedA = makeMessage({
    id: 'server-a',
    clientMessageId: 'temp-a',
    createdAt: A_SERVER_TIME,
    status: 'SENT',
  })
  const confirmedB = makeMessage({
    id: 'server-b',
    clientMessageId: 'temp-b',
    createdAt: B_SERVER_TIME,
    status: 'SENT',
  })
  const pendingC = makeMessage({
    clientMessageId: 'temp-c',
    createdAt: '2026-01-01T00:00:01.100Z',
  })
  const anchorsABC = {
    ...anchorsAB,
    'temp-c': makeAnchor({
      frontierCreatedAtMs: Date.parse(A_SERVER_TIME),
      frontierMessageId: 'server-a',
      sequence: 1,
    }),
  }

  assert.deepEqual(
    getOrderedClientIds({
      localOptimistic: [pendingC],
      anchors: anchorsABC,
      serverMessages: [confirmedA, confirmedB],
    }),
    ['temp-c', 'temp-b', 'temp-a'],
  )
})

test('canonical ordering remains correct after the final optimistic ordering domain settles', () => {
  const confirmedA = makeMessage({
    id: 'server-a',
    clientMessageId: 'temp-a',
    createdAt: A_SERVER_TIME,
    status: 'SENT',
  })
  const confirmedB = makeMessage({
    id: 'server-b',
    clientMessageId: 'temp-b',
    createdAt: B_SERVER_TIME,
    status: 'SENT',
  })
  const confirmedC = makeMessage({
    id: 'server-c',
    clientMessageId: 'temp-c',
    createdAt: C_SERVER_TIME,
    status: 'SENT',
  })
  const confirmedD = makeMessage({
    id: 'server-d',
    clientMessageId: 'temp-d',
    createdAt: D_SERVER_TIME,
    status: 'SENT',
  })

  assert.deepEqual(
    getOrderedClientIds({
      localOptimistic: [],
      anchors: {},
      serverMessages: [confirmedA, confirmedB, confirmedC, confirmedD],
    }),
    ['temp-d', 'temp-c', 'temp-b', 'temp-a'],
  )
})
