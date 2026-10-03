const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8')
const source = read('src/components/chat/MessageBubbleImpl.tsx')
const file = ts.createSourceFile('MessageBubbleImpl.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let reactionRow
const visit = (node) => {
  if (ts.isJsxElement(node) && node.openingElement.getText(file).includes("'reactionHeight'")) reactionRow = node
  ts.forEachChild(node, visit)
}
visit(file)
assert.ok(reactionRow)
const expression = reactionRow.children.find(ts.isJsxExpression).expression
assert.ok(ts.isCallExpression(expression))
assert.equal(expression.expression.getText(file), 'renderReactionBadges')
assert.deepEqual(expression.arguments.map((argument) => argument.getText(file)), ['reactionSummary', 'onReactionPress'])
const helper = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'renderReactionBadges')
assert.ok(helper)
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const cnModule = { exports: {} }
new Function('require', 'exports', compile(read('src/lib/cn.ts')))(require, cnModule.exports)
const moduleUnderTest = { exports: {} }
new Function('require', 'exports', 'Pressable', 'Text', 'cn', compile(`${helper.getText(file)}
exports.renderReactionBadges = renderReactionBadges`))(
  require, moduleUnderTest.exports, 'Pressable', 'Text', cnModule.exports.cn,
)
const { renderReactionBadges } = moduleUnderTest.exports

test('reaction badges preserve keys/order, labels, hit area and the callback for each render', () => {
  const fixtures = [
    [{}, []],
    [{ '👍': 1 }, [['👍', 1]]],
    [{ '😂': 2, '💖': 1 }, [['😂', 2], ['💖', 1]]],
    [{ '👍 👏 ❤️': 5 }, [['👍 👏 ❤️', 5]]],
    [{ '10': 2, '2': 3, '👍': 1 }, [['2', 3], ['10', 2], ['👍', 1]]],
    [{ '': 0 }, [['', 0]]],
    [{ '👩‍💻': 1, 'é': 4 }, [['👩‍💻', 1], ['é', 4]]],
  ]
  for (const [summary, expected] of fixtures) {
    Object.freeze(summary)
    const first = []
    const second = []
    const firstTree = renderReactionBadges(summary, (emoji) => first.push(emoji))
    const secondTree = renderReactionBadges(summary, (emoji) => second.push(emoji))
    assert.deepEqual(first, [])
    assert.deepEqual(second, [])
    for (const tree of [firstTree, secondTree]) {
      assert.equal(tree.length, expected.length)
      tree.forEach((badge, index) => {
        const [emoji, count] = expected[index]
        assert.equal(badge.type, 'Pressable')
        assert.equal(badge.key, emoji)
        assert.equal(badge.props.hitSlop, 6)
        assert.equal(badge.props.className, 'flex-row items-center rounded-full px-2 py-1 bg-surface-input')
        const [label, counter] = badge.props.children
        assert.equal(label.type, 'Text')
        assert.deepEqual(label.props, { className: 'text-xs', children: emoji })
        assert.equal(counter.type, 'Text')
        assert.deepEqual(counter.props, { className: 'text-xs ml-0.5 text-text-muted', children: count })
        badge.props.onPress({ ignoredEvent: true })
      })
    }
    const emojis = expected.map(([emoji]) => emoji)
    assert.deepEqual(first, emojis)
    assert.deepEqual(second, emojis)
    for (const callback of [undefined, null]) {
      const tree = renderReactionBadges(summary, callback)
      assert.deepEqual(tree.map((badge) => badge.key), emojis)
      tree.forEach((badge) => assert.doesNotThrow(() => badge.props.onPress()))
    }
  }
})
