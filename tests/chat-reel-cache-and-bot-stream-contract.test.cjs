const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('chat reel cards cache thumbnails and owner avatars on disk under stable keys', () => {
  const card = read('src/components/chat/ChatReelCard.tsx')

  assert.match(card, /import \{ Image \} from 'expo-image'/)
  assert.doesNotMatch(card, /import \{[^}]*\bImage\b[^}]*\} from 'react-native'/)
  // With a thumbnailKey the key matches ReelThumbnailGrid; otherwise the unsigned URL path keys it.
  assert.match(card, /`reel-thumbnail:\$\{reelId \?\? 'chat'\}:\$\{thumbnailKey\.trim\(\)\}`/)
  assert.match(card, /`reel-thumbnail-url:\$\{stripSignedQuery\(uri\)\}`/)
  assert.match(
    card,
    /cacheKey: getReelThumbnailCacheKey\(canonicalReelId, thumbnailKey, thumbnailUri\)/,
  )
  assert.match(card, /cachePolicy="memory-disk"/)
  assert.match(card, /recyclingKey=\{canonicalReelId \?\? thumbnailUri\}/)
  assert.match(card, /cacheKey: `reel-owner-avatar:\$\{stripSignedQuery\(reelCreatorAvatarUri\)\}`/)
})

test('reel reply previews in chat use the cached thumbnail pipeline with a detail fallback', () => {
  const bubble = read('src/components/chat/MessageBubbleImpl.tsx')
  const thumbnail = read('src/components/chat/ReplyReelThumbnail.tsx')

  assert.match(bubble, /<ReplyReelThumbnail[\s\S]*?uri=\{resolvedReplyPreviewThumbnailUri\}/)
  assert.match(bubble, /reelId: resolvedReplyTarget\.media\.reelId/)
  assert.match(thumbnail, /import \{ Image \} from 'expo-image'/)
  assert.match(thumbnail, /useReelDetail\(normalizedReelId \?\? undefined/)
  assert.match(
    thumbnail,
    /cacheKey: getReelThumbnailCacheKey\(normalizedReelId, thumbnail\.key, thumbnail\.uri\)/,
  )
  assert.match(thumbnail, /cachePolicy="memory-disk"/)
})

test('the composer reply bar shows a cached reel thumbnail instead of a black tile', () => {
  const input = read('src/components/chat/MessageInput.tsx')

  assert.match(input, /import \{ Image \} from 'expo-image'/)
  assert.match(input, /import \{ getReelThumbnailCacheKey \} from '\.\/ChatReelCard'/)
  assert.match(input, /useReelDetail\(replyReelId \?\? undefined/)
  assert.match(
    input,
    /\{ uri: replyReelDetail\?\.thumbnailUrl, key: replyReelDetail\?\.thumbnailKey \}/,
  )
  assert.match(input, /cachePolicy="memory-disk"/)
  assert.match(input, /setFailedReplyThumbnails/)
})

test('the long-press menu reel preview uses the cached thumbnail pipeline', () => {
  const menu = read('src/components/chat/MessageContextMenu/MessageContextMenu.tsx')

  assert.match(menu, /function ContextReelPreview\(/)
  assert.match(menu, /return <ContextReelPreview message=\{message\} \/>/)
  assert.match(menu, /useReelDetail\(reelId \?\? undefined/)
  assert.match(menu, /cacheKey: getReelThumbnailCacheKey\(reelId, thumbnail\.key, thumbnail\.uri\)/)
})

test('the composer reply card uses a real border colour token, not the black default', () => {
  const input = read('src/components/chat/MessageInput.tsx')

  assert.match(input, /border border-border-warm bg-surface-cream/)
  // Reel replies carry the same left accent as text replies.
  assert.match(input, /borderLeftWidth: 3,/)
  assert.doesNotMatch(input, /borderLeftWidth: isReplyReel/)
  assert.doesNotMatch(input, /border border-warm\b/)
})

test('late bot stream tokens cannot start a second bubble after the final reply', () => {
  const socket = read('src/providers/SocketProvider.tsx')

  assert.match(socket, /const finishedBotStreams = new Set<string>\(\)/)
  assert.match(
    socket,
    /const upsertStreamingBotMessage = [\s\S]*?if \(finishedBotStreams\.has\(payload\.conversationId\)\) \{\s*return\s*\}/,
  )
  assert.match(
    socket,
    /const reconcileStreamingBotMessage = [\s\S]*?finishedBotStreams\.add\(message\.conversationId\)/,
  )
  // A new user turn reopens streaming, from both the socket ack and the REST echo.
  assert.match(socket, /finishedBotStreams\.delete\(incomingMessage\.conversationId\)/)
  assert.match(socket, /if \(isOwnMessage\) \{\s*finishedBotStreams\.delete\(conversationId\)/)
})
