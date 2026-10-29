const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

const read = (...parts) => readFileSync(join(__dirname, '..', ...parts), 'utf8')

test('the chat library picker asks iOS for compatible images so HEIC photos arrive as JPEG', () => {
  const sheet = read('src', 'components', 'chat', 'AttachmentLauncherSheet.tsx')
  const mainPicker = sheet.slice(sheet.indexOf("mediaTypes: ['images', 'videos']"))
  assert.match(
    mainPicker.slice(0, 400),
    /preferredAssetRepresentationMode:\s*ImagePicker\.UIImagePickerPreferredAssetRepresentationMode\.Compatible/,
  )
})

test('chat uploads still accept only JPEG, PNG and WebP images', () => {
  const media = read('src', 'lib', 'chatMedia.ts')
  assert.match(media, /allowedChatImageTypes = \['image\/jpeg', 'image\/png', 'image\/webp'\]/)
})
