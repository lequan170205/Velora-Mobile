const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const { loadTypeScriptModule } = require('./chat-timeline-test-utils.cjs')

const recyclingPath = path.resolve(__dirname, '../src/lib/messageBubbleRecycling.ts')

const citationA = {
  sourceType: 'REEL',
  reelId: 'reel-1',
  evidenceType: 'TRANSCRIPT',
  title: 'Living room tour',
  startTime: 12,
  endTime: 18,
  quote: 'Large windows face the garden.',
}

test('ordinary message bubbles share one recycling key instead of keying by message id', () => {
  const { getMessageBubbleRecyclingKey } = loadTypeScriptModule({ filename: recyclingPath })

  assert.equal(getMessageBubbleRecyclingKey(undefined), 'default')
  assert.equal(getMessageBubbleRecyclingKey([]), 'default')
})

test('citation-only metadata changes still produce a different recycling key', () => {
  const { getMessageBubbleRecyclingKey } = loadTypeScriptModule({ filename: recyclingPath })

  const firstKey = getMessageBubbleRecyclingKey([citationA])
  const sameContentKey = getMessageBubbleRecyclingKey([{ ...citationA }])
  const changedContentKey = getMessageBubbleRecyclingKey([
    { ...citationA, quote: 'Updated evidence' },
  ])

  assert.equal(firstKey, sameContentKey)
  assert.notEqual(firstKey, changedContentKey)
})
