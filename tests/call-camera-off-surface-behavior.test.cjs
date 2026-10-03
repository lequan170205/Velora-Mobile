const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8')
const load = (source, mocks = {}) => {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const moduleUnderTest = { exports: {} }
  new Function('require', 'module', 'exports', output)(
    (name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    moduleUnderTest, moduleUnderTest.exports,
  )
  return moduleUnderTest.exports
}

const { colors } = load(read('src/constants/theme.ts'))
const { CameraOffSurface } = load(read('src/components/call/CameraOffSurface.tsx'), {
  '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' },
  'react-native': { Image: 'Image', View: 'View' },
  '../../constants/theme': { colors },
  '../base/AppText': { AppText: 'AppText' },
  './PeerAvatar': { PeerAvatar: 'PeerAvatar' },
})

test('camera-off surface preserves background, local/remote identity, status and defaults', () => {
  for (const local of [undefined, false, true]) {
    for (const avatarUrl of [null, '', 'file:///avatar.png', ' ']) {
      for (const name of [null, '', ' alice ', '👩‍💻']) {
        for (const status of [undefined, '', 'Connecting', '👩‍💻']) {
          const props = Object.freeze({ avatarUrl, name, status, local })
          const tree = CameraOffSurface(props)
          assert.equal(tree.type, 'View')
          assert.equal(tree.props.className, 'flex-1 items-center justify-center overflow-hidden rounded-[18px]')
          assert.deepEqual(tree.props.style, { backgroundColor: colors.call.cameraOffSurface })
          const [background, overlay, identity, label] = tree.props.children
          if (avatarUrl) {
            assert.equal(background.type, 'Image')
            assert.deepEqual(background.props, {
              source: { uri: avatarUrl }, resizeMode: 'cover', blurRadius: 42,
              className: 'absolute inset-0 h-full w-full',
              style: { opacity: 0.34, transform: [{ scale: 1.25 }] },
            })
          } else assert.equal(background, null)
          assert.equal(overlay.type, 'View')
          assert.deepEqual(overlay.props, { className: 'absolute inset-0 bg-black/25' })
          if (local) {
            assert.equal(identity.type, 'View')
            assert.equal(identity.props.className, 'h-14 w-14 items-center justify-center rounded-full')
            assert.deepEqual(identity.props.style, { backgroundColor: colors.call.localAvatar })
            assert.equal(identity.props.children.type, 'MaterialIcons')
            assert.deepEqual(identity.props.children.props, { name: 'person', size: 42, color: colors.call.localAvatarIcon })
          } else {
            assert.equal(identity.type, 'PeerAvatar')
            assert.deepEqual(identity.props, { avatarUrl, name, size: 52 })
          }
          if (status) {
            assert.equal(label.type, 'AppText')
            assert.deepEqual(label.props, {
              className: 'mt-4 max-w-[82%] text-center text-[16px] font-medium',
              style: { color: colors.call.textPrimary }, numberOfLines: 2, children: status,
            })
          } else assert.equal(label, null)
        }
      }
    }
  }
})
