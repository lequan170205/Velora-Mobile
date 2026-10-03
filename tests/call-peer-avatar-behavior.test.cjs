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
const { PeerAvatar } = load(read('src/components/call/PeerAvatar.tsx'), {
  'react-native': { Image: 'Image', View: 'View' },
  '../../constants/theme': { colors },
  '../base/AppText': { AppText: 'AppText' },
})

test('call avatar preserves image props, existing name fallback and all caller sizes', () => {
  const fixtures = [
    [null, null, 'U'],
    [null, '', 'U'],
    ['', ' \t\n', 'U'],
    [null, ' alice ', 'A'],
    [null, 'bob', 'B'],
    [null, 'éclair', 'É'],
    [null, 'ßmith', 'SS'],
    [null, '👩‍💻', '\ud83d'],
    [null, '\nBobby', 'B'],
    [null, '0', '0'],
    ['https://example.com/avatar.png', null, null],
    ['file:///avatar.png', 'carol', null],
    [' ', 'alice', null],
    ['', ' dave', 'D'],
  ]
  for (const [avatarUrl, name, initial] of fixtures) {
    for (const size of [52, 56, 84, 110]) {
      const tree = PeerAvatar({ avatarUrl, name, size })
      assert.equal(tree.type, 'View')
      assert.equal(tree.props.className, 'items-center justify-center overflow-hidden rounded-full')
      assert.deepEqual(tree.props.style, {
        width: size, height: size, backgroundColor: colors.call.avatarFallback,
        borderColor: colors.call.avatarBorder, borderWidth: 1,
      })
      const content = tree.props.children
      if (avatarUrl) {
        assert.equal(content.type, 'Image')
        assert.deepEqual(content.props, { source: { uri: avatarUrl }, resizeMode: 'cover', className: 'h-full w-full' })
      } else {
        assert.equal(content.type, 'AppText')
        assert.deepEqual(content.props, {
          className: 'font-heading font-semibold',
          style: { color: colors.call.textSecondary, fontSize: size * 0.38 },
          children: initial,
        })
      }
    }
  }
})
