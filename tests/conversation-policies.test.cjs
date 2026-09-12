const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')

const loadTypeScriptModule = (relativePath, mocks) => {
  const absolutePath = path.join(root, relativePath)
  const source = fs.readFileSync(absolutePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: absolutePath,
  }).outputText
  const loadedModule = { exports: {} }
  const localRequire = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier]
    return require(specifier)
  }
  new Function('require', 'module', 'exports', compiled)(
    localRequire,
    loadedModule,
    loadedModule.exports,
  )
  return loadedModule.exports
}

const messageIdentityMock = {
  getMessageIdentityKey: (message) =>
    message ? (message.clientMessageId ?? message.id ?? message._id ?? null) : null,
}
const replyPreviewMock = {
  buildReplyPreviewFromMessage: ({ message }) => ({
    type: message.type,
    content: `resolved:${message.id}`,
    senderId: message.senderId,
  }),
  normalizeReplyPreviewContent: (value) => String(value ?? '').trim(),
}

const messagePolicies = loadTypeScriptModule(
  'src/lib/conversation/conversationMessagePolicies.ts',
  {
    '../messageIdentity': messageIdentityMock,
    '../replyPreview': replyPreviewMock,
  },
)

const presentationPolicies = loadTypeScriptModule(
  'src/lib/conversation/conversationPresentationPolicies.ts',
  {
    '../chatMedia': {
      getMediaUploadStage: (media) => media?.stage ?? null,
      getResolvedMediaPosterUri: (media) => media?.posterUri ?? null,
      getResolvedMediaUri: (media) => media?.uri ?? null,
      isRemoteMediaUri: (uri) => /^https?:/.test(uri),
    },
    '../messageIdentity': messageIdentityMock,
    './conversationMessagePolicies': messagePolicies,
  },
)

test('optimistic rendering filters confirmed records and preserves stable cached identity', () => {
  const messages = [
    { id: 'server-1', status: 'SENT' },
    { id: 'temp-1', status: 'PENDING' },
    { id: 'failed-1', status: 'FAILED' },
  ]

  const first = messagePolicies.getRenderableOptimisticMessages(messages)
  const second = messagePolicies.getRenderableOptimisticMessages(messages)

  assert.deepEqual(
    first.map((message) => message.id),
    ['temp-1', 'failed-1'],
  )
  assert.equal(first, second)
  assert.equal(messagePolicies.getRenderableOptimisticMessages(undefined).length, 0)
})

test('reply preview backfill preserves valid previews and repairs generic reel previews', () => {
  const replyTarget = { id: 'reel-1', senderId: 'peer-1', type: 'reel' }
  const generic = {
    id: 'message-1',
    replyPreview: { type: 'text', content: 'New message' },
  }
  const repaired = messagePolicies.backfillReplyPreviewFromResolvedTarget({
    message: generic,
    replyTo: replyTarget,
  })

  assert.equal(repaired.replyPreview.type, 'reel')
  assert.equal(repaired.replyPreview.content, 'resolved:reel-1')

  const valid = {
    id: 'message-2',
    replyPreview: { type: 'reel', content: 'Existing reel', senderId: 'peer-1' },
  }
  assert.equal(
    messagePolicies.backfillReplyPreviewFromResolvedTarget({
      message: valid,
      replyTo: replyTarget,
    }),
    valid,
  )
})

test('message status, recycling type and key policies preserve existing fallbacks', () => {
  assert.equal(
    messagePolicies.getPrimaryStatusLabel({
      hasReadActivityAtOrBeyondMessage: false,
      message: { id: 'temp-1', status: 'PENDING' },
    }),
    'Sending...',
  )
  assert.equal(
    messagePolicies.getPrimaryStatusLabel({
      hasReadActivityAtOrBeyondMessage: true,
      message: { id: 'server-1', status: 'SENT' },
    }),
    null,
  )
  assert.equal(
    messagePolicies.getConversationMessageItemType({ id: 'recalled', isRecalled: true }),
    'recalled',
  )

  const recommendation = {
    id: 'ai-1',
    type: 'text',
    metadata: {
      kind: 'velora_ai_reel_recommendations',
      recommendedReels: [{ id: 'reel-1' }],
      suggestedQueries: ['more'],
    },
  }
  assert.equal(
    messagePolicies.getConversationMessageItemType(recommendation),
    'text:velora_ai_reel_recommendations',
  )
  assert.equal(
    messagePolicies.getConversationMessageKey(recommendation, 0),
    'ai-1:velora_ai_reel_recommendations:1:1',
  )
})

test('header and typing policies preserve direct and group identity fallbacks', () => {
  const direct = {
    isGroup: false,
    participants: [
      { id: 'me', name: 'Me' },
      { id: 'peer', fullName: 'Peer Name', picture: 'https://peer/avatar.jpg' },
    ],
  }
  assert.deepEqual(
    presentationPolicies.getConversationHeaderIdentity({
      conversation: direct,
      currentUserId: 'me',
    }),
    {
      displayName: 'Peer Name',
      avatarUrl: 'https://peer/avatar.jpg',
      otherUserId: 'peer',
    },
  )

  const group = {
    isGroup: true,
    name: 'Team',
    participants: [
      { id: 'me', name: 'Me' },
      { id: 'one', name: 'One' },
      { id: 'two', fullName: 'Two' },
    ],
  }
  assert.equal(
    presentationPolicies.getGroupTypingLabel({
      activeTypers: ['one', 'two'],
      conversation: group,
      currentUserId: 'me',
    }),
    'One and Two are typing',
  )
})

test('gallery policy filters recalled/local media and bounds anchor viewer windows', () => {
  const messages = [
    { id: 'newest', type: 'image', status: 'SENT', media: { uri: 'https://cdn/new.jpg' } },
    { id: 'pending', type: 'video', status: 'PENDING', media: { uri: 'file:///video.mp4' } },
    { id: 'recalled', type: 'image', isRecalled: true, media: { uri: 'https://cdn/old.jpg' } },
  ]
  const items = presentationPolicies.buildConversationMediaGalleryItems(messages)

  assert.deepEqual(
    items.map((item) => item.id),
    ['pending', 'newest'],
  )
  assert.equal(items[0].canSave, false)
  assert.equal(items[1].canSave, true)

  const manyItems = Array.from({ length: 12 }, (_, index) => ({ id: String(index) }))
  const anchorItems = presentationPolicies.getConversationMediaViewerItems({
    items: manyItems,
    sourceIndex: 6,
    timelineMode: 'anchor',
  })
  assert.deepEqual(
    anchorItems.map((item) => item.id),
    ['2', '3', '4', '5', '6', '7', '8', '9', '10'],
  )
})

test('receipt policy anchors group and direct activity without duplicate sent labels', () => {
  const groupParticipants = [
    { id: 'me', name: 'Me' },
    { id: 'one', name: 'One' },
    { id: 'two', name: 'Two' },
  ]
  const orderedMessages = [
    { id: 'peer-new', senderId: 'one' },
    { id: 'mine', senderId: 'me', status: 'SENT', readBy: [{ userId: 'two' }] },
    { id: 'older', senderId: 'two' },
  ]
  const groupModel = presentationPolicies.buildConversationReceiptModel({
    conversation: { isGroup: true, participants: groupParticipants },
    currentUserId: 'me',
    orderedMessages,
    otherParticipant: null,
  })

  assert.deepEqual(
    groupModel.readReceiptsByIdentityKey.get('peer-new').map((participant) => participant.id),
    ['one'],
  )
  assert.deepEqual(
    groupModel.readReceiptsByIdentityKey.get('mine').map((participant) => participant.id),
    ['two'],
  )
  assert.equal(groupModel.primaryStatusByIdentityKey.has('mine'), false)

  const peer = { id: 'peer', name: 'Peer' }
  const directModel = presentationPolicies.buildConversationReceiptModel({
    conversation: { isGroup: false, participants: [{ id: 'me' }, peer] },
    currentUserId: 'me',
    orderedMessages: [
      { id: 'mine-new', senderId: 'me', status: 'SENT' },
      { id: 'peer-old', senderId: 'peer' },
    ],
    otherParticipant: peer,
  })
  assert.deepEqual(directModel.readReceiptsByIdentityKey.get('peer-old'), [peer])
  assert.equal(directModel.primaryStatusByIdentityKey.get('mine-new'), 'Sent')
})
