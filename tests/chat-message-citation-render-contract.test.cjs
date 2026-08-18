const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const { loadTypeScriptModule } = require('./chat-timeline-test-utils.cjs')

const messageMetadataPath = path.resolve(__dirname, '../src/lib/messageMetadata.ts')
const messageIdentityPath = path.resolve(__dirname, '../src/lib/messageIdentity.ts')

const citationA = {
  sourceType: 'REEL',
  reelId: 'reel-1',
  evidenceType: 'TRANSCRIPT',
  title: 'Living room tour',
  startTime: 12,
  endTime: 18,
  quote: 'Large windows face the garden.',
}

const citationB = {
  sourceType: 'REEL',
  reelId: 'reel-2',
  evidenceType: 'VISUAL',
  title: 'Kitchen view',
  startTime: 30,
  endTime: 34,
  quote: 'The island has four seats.',
}

test('citation equality is semantic so recycled bubbles update only when citation content changes', () => {
  const { areAiRagCitationsEqual } = loadTypeScriptModule({ filename: messageMetadataPath })

  assert.equal(areAiRagCitationsEqual([citationA], [{ ...citationA }]), true)
  assert.equal(areAiRagCitationsEqual([citationA], [{ ...citationA, quote: 'Changed evidence' }]), false)
  assert.equal(areAiRagCitationsEqual([citationA], [citationA, citationB]), false)
  assert.equal(areAiRagCitationsEqual(undefined, undefined), true)
  assert.equal(areAiRagCitationsEqual(undefined, []), false)
})

test('message metadata merge preserves existing citations when an incoming record omits citations', () => {
  const { mergeMessageMetadata } = loadTypeScriptModule({
    filename: messageIdentityPath,
    mocks: {
      './replyPreview': {
        mergeReplyPreview: (existing, incoming) => incoming ?? existing,
      },
    },
  })

  const merged = mergeMessageMetadata(
    {
      kind: 'velora_ai_response',
      citations: [citationA],
    },
    {
      kind: 'velora_ai_response',
      suggestedQueries: ['Show similar reels'],
    },
  )

  assert.deepEqual(merged.citations, [citationA])
  assert.deepEqual(merged.suggestedQueries, ['Show similar reels'])
})

test('message metadata merge accepts an explicit incoming citation replacement', () => {
  const { mergeMessageMetadata } = loadTypeScriptModule({
    filename: messageIdentityPath,
    mocks: {
      './replyPreview': {
        mergeReplyPreview: (existing, incoming) => incoming ?? existing,
      },
    },
  })

  const merged = mergeMessageMetadata(
    {
      kind: 'velora_ai_response',
      citations: [citationA],
    },
    {
      kind: 'velora_ai_response',
      citations: [citationB],
    },
  )

  assert.deepEqual(merged.citations, [citationB])
})
