const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

function loadChatMediaHelpers() {
  // Only the pure caption helpers are needed; the rest of chatMedia pulls in React Native modules.
  const source = read('src/lib/chatMedia.ts')
  const start = source.indexOf('export const CHAT_IMAGE_PLACEHOLDER')
  const placeholders = source.slice(
    start,
    source.indexOf('\n', source.indexOf('CHAT_VIDEO_PLACEHOLDER')),
  )
  const captionStart = source.indexOf('export const getChatImageCaption')
  const captionEnd = source.indexOf('export const getMediaPlaceholderLabel')
  const compiled = ts.transpileModule(
    placeholders + '\n' + source.slice(captionStart, captionEnd),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    },
  ).outputText
  const module = { exports: {} }
  new Function('module', 'exports', compiled)(module, module.exports)
  return module.exports
}

const { getChatImageCaption, MAX_CHAT_IMAGE_CAPTION_LENGTH, BOT_IMAGE_PICK_QUALITY } =
  loadChatMediaHelpers()

test('the composer placeholder is not a caption, a typed question is', () => {
  assert.equal(getChatImageCaption('[Hình ảnh]'), '')
  assert.equal(getChatImageCaption('  [Hình ảnh]  '), '')
  assert.equal(getChatImageCaption(undefined), '')
  assert.equal(getChatImageCaption(null), '')
  assert.equal(getChatImageCaption('  find reels like this '), 'find reels like this')
})

test('photos for Velora AI are capped in caption length and compressed', () => {
  assert.equal(MAX_CHAT_IMAGE_CAPTION_LENGTH, 500)
  assert.ok(BOT_IMAGE_PICK_QUALITY > 0 && BOT_IMAGE_PICK_QUALITY < 1)
})

test('a caption becomes the content of the first photo only', () => {
  const source = read('src/hooks/useChatMediaUploads.ts')
  assert.match(source, /options\?\.caption\?\.trim\(\)\.slice\(0, MAX_CHAT_IMAGE_CAPTION_LENGTH\)/)
  assert.match(source, /kind === 'image' && assetIndex === 0 && caption/)
})

test('only chats with Velora AI preview and caption a photo before sending', () => {
  const screen = read('app/conversation/[id].tsx')
  assert.match(screen, /state\.botConversationIds\.has\(conversationId\)/)
  assert.match(screen, /captionMedia=\{isBotConversation\}/)

  const input = read('src/components/chat/MessageInput.tsx')
  assert.match(input, /if \(!captionMedia\) \{\s*await onSendMedia\?\.\(assets\)/)
  assert.match(input, /attachPhoto\(photo\)/)
  assert.match(input, /onSendMedia\?\.\(\[photo\], message \? \{ caption: message \} : undefined\)/)
  assert.match(input, /singleCompressedImage=\{captionMedia\}/)
})

test('the launcher offers a single compressed photo for Velora AI and the usual picker elsewhere', () => {
  const launcher = read('src/components/chat/AttachmentLauncherSheet.tsx')
  assert.match(launcher, /singleCompressedImage \? \['images'\] : \['images', 'videos'\]/)
  assert.match(launcher, /allowsMultipleSelection: !singleCompressedImage/)
  assert.match(launcher, /quality: singleCompressedImage && Platform\.OS === 'ios' \? BOT_IMAGE_PICK_QUALITY : 1/)
})

test('a photo caption is shown under the photo, but the placeholder is not', () => {
  const bubble = read('src/components/chat/MessageBubbleContent.tsx')
  assert.match(bubble, /getChatImageCaption\(message\.content\)/)
  assert.match(bubble, /if \(!caption\) \{\s*return mediaBubble/)
})

test('the picked photo sits above the normal text field, which takes the caption and sends it', () => {
  const input = read('src/components/chat/MessageInput.tsx')

  // The photo preview is rendered before the composer pill, so it is stacked above the text field.
  const previewAt = input.indexOf('accessibilityLabel="Photo to send"')
  const pillAt = input.indexOf('styles.composerPill,')
  assert.ok(previewAt > 0 && pillAt > previewAt, 'the preview must come before the text field')
  assert.match(input, /accessibilityLabel="Remove photo"/)

  // The same text field and send button carry the caption: no separate sheet, no extra Send.
  assert.match(input, /placeholder=\{pendingPhoto \? 'Add a caption…' : 'Message'\}/)
  assert.match(input, /maxLength=\{pendingPhoto \? MAX_CHAT_IMAGE_CAPTION_LENGTH : 1000\}/)
  // A photo alone is sendable: the send button shows even with an empty text field.
  assert.match(input, /if \(\(!message && !photo\) \|\| sendLockRef\.current\) return/)
  assert.match(input, /value\.trim\(\)\.length > 0 \|\| pendingPhotoRef\.current !== null/)
  // Removing the photo drops back to the text-only send state.
  assert.match(input, /const stillHasText = textRef\.current\.trim\(\)\.length > 0/)
})

test('the old modal caption sheet is gone', () => {
  assert.equal(fs.existsSync(path.join(root, 'src/components/chat/ImageCaptionSheet.tsx')), false)
  assert.doesNotMatch(read('src/components/chat/MessageInput.tsx'), /ImageCaptionSheet/)
})
