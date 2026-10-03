const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const load = (source, mocks = {}) => {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', output)(
    (name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    module,
    module.exports,
  )
  return module.exports
}

const { colors } = load(read('src/constants/theme.ts'))
const { IconButton } = load(read('src/components/call/IconButton.tsx'), {
  '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' },
  '../base/AppPressable': { AppPressable: 'AppPressable' },
  '../../constants/theme': { colors },
})

test('call control rendering preserves defaults, accessibility, styles and callback', () => {
  const options = [{}]
  for (const disabled of [false, true])
    for (const selected of [false, true])
      for (const destructive of [false, true])
        for (const expanded of [undefined, false, true])
          for (const size of [undefined, 32, 0])
            options.push({ disabled, selected, destructive, expanded, size })

  for (const props of options) {
    let calls = 0
    const onPress = () => { calls += 1 }
    const element = IconButton({ icon: 'mic', label: 'Mute microphone', onPress, ...props })
    const { disabled = false, selected = false, destructive = false, expanded, size = 48 } = props
    assert.equal(calls, 0)
    assert.equal(element.type, 'AppPressable')
    assert.deepEqual({ ...element.props, children: undefined }, {
      activeOpacity: disabled ? 1 : 0.68,
      disabled,
      onPress,
      accessibilityRole: 'button',
      accessibilityLabel: 'Mute microphone',
      accessibilityState: { disabled, selected, expanded },
      className: 'items-center justify-center rounded-full',
      style: {
        width: size, height: size, opacity: disabled ? 0.34 : 1,
        backgroundColor: destructive ? colors.call.endCall : selected ? colors.bubble.outgoing : colors.call.control,
      },
      children: undefined,
    })
    assert.equal(element.props.children.type, 'MaterialIcons')
    assert.deepEqual(element.props.children.props, {
      name: 'mic', size: destructive ? 27 : 25,
      color: selected && !destructive ? colors.bubble.outgoingText : colors.call.textPrimary,
    })
    if (!disabled) {
      element.props.onPress()
      assert.equal(calls, 1)
    }
  }
})
