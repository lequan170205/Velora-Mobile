const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const source = fs.readFileSync(path.resolve(__dirname, '../src/components/chat/MessageBubbleImpl.tsx'), 'utf8')
const file = ts.createSourceFile('MessageBubbleImpl.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let receiptRow
const visit = (node) => {
  if (ts.isJsxElement(node) && node.openingElement.getText(file).includes('style={primaryMetaRowStyle}')) receiptRow = node
  ts.forEachChild(node, visit)
}
visit(file)
assert.ok(receiptRow)
assert.equal(receiptRow.openingElement.getText(file), '<Animated.View style={primaryMetaRowStyle} className="w-full">')
const expression = receiptRow.children.find(ts.isJsxExpression).expression
assert.ok(ts.isCallExpression(expression))
assert.equal(expression.expression.getText(file), 'renderMessageReceiptContent')
assert.equal(expression.arguments.length, 1)
assert.ok(ts.isObjectLiteralExpression(expression.arguments[0]))
assert.deepEqual(expression.arguments[0].properties.map((property) => {
  assert.ok(ts.isShorthandPropertyAssignment(property))
  return property.name.text
}), ['primaryStatusLabel', 'readReceiptParticipants', 'visibleReceiptParticipants', 'hiddenReceiptCount'])
const helper = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'renderMessageReceiptContent')
assert.ok(helper)
const output = ts.transpileModule(`
${helper.getText(file)}
exports.renderMessageReceiptContent = renderMessageReceiptContent
`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const moduleUnderTest = { exports: {} }
new Function('require', 'exports', 'Image', 'Text', 'View', output)(
  require, moduleUnderTest.exports, 'Image', 'Text', 'View',
)
const { renderMessageReceiptContent } = moduleUnderTest.exports

test('receipt content preserves status priority, avatar order, fallback, overflow and changing inputs', () => {
  const people = [
    [{ id: 'photo', name: 'alice', picture: 'file:///avatar.png' }, 'A'],
    [{ id: 'name', name: 'bob', fullName: 'Other', email: 'other@example.com' }, 'B'],
    [{ id: 'full', name: '', fullName: 'carol', email: 'other@example.com', picture: '' }, 'C'],
    [{ id: 'email', email: 'dave@example.com' }, 'D'],
    [{ id: 'missing' }, '?'],
    [{ id: 'space', name: ' ', fullName: 'Other' }, ' '],
    [{ id: 'unicode', name: 'éclair', picture: null }, 'É'],
  ]
  const fixtures = [[], ...people.map((person) => [person]), people.slice(0, 3), people.slice(0, 4), people]
  for (const primaryStatusLabel of [null, '', 'Sending...', 'Sent', 'Failed']) {
    for (const fixture of fixtures) {
      const readReceiptParticipants = Object.freeze(fixture.map(([person]) => Object.freeze(person)))
      const visibleReceiptParticipants = Object.freeze(readReceiptParticipants.slice(0, 3))
      const hiddenReceiptCount = Math.max(0, readReceiptParticipants.length - visibleReceiptParticipants.length)
      const tree = renderMessageReceiptContent({ primaryStatusLabel, readReceiptParticipants, visibleReceiptParticipants, hiddenReceiptCount })
      if (!readReceiptParticipants.length && !primaryStatusLabel) {
        assert.equal(tree, null)
        continue
      }
      assert.equal(tree.type, 'View')
      assert.equal(tree.props.className, 'flex-row justify-end items-center gap-1 px-1')
      if (!readReceiptParticipants.length) {
        assert.equal(tree.props.children.type, 'Text')
        assert.deepEqual(tree.props.children.props, { className: 'text-[11px] text-text-muted', children: primaryStatusLabel })
        continue
      }
      const avatars = tree.props.children
      assert.equal(avatars.type, 'View')
      assert.equal(avatars.props.className, 'flex-row items-center')
      const [visible, overflow] = avatars.props.children
      assert.equal(visible.length, Math.min(3, fixture.length))
      visible.forEach((avatar, index) => {
        const [person, initial] = fixture[index]
        assert.equal(avatar.key, person.id)
        assert.deepEqual(avatar.props.style, { marginLeft: index === 0 ? 0 : -4, zIndex: 4 - index })
        if (person.picture) {
          assert.equal(avatar.type, 'Image')
          assert.deepEqual(avatar.props.source, { uri: person.picture })
          assert.equal(avatar.props.className, 'h-4 w-4 rounded-full border border-bg-primary')
        } else {
          assert.equal(avatar.type, 'View')
          assert.equal(avatar.props.className, 'h-4 w-4 items-center justify-center rounded-full border border-bg-primary bg-surface-muted')
          assert.equal(avatar.props.children.type, 'Text')
          assert.deepEqual(avatar.props.children.props, { className: 'text-[8px] font-medium text-text-primary', children: initial })
        }
      })
      if (hiddenReceiptCount > 0) {
        assert.equal(overflow.type, 'Text')
        assert.deepEqual(overflow.props, { className: 'ml-1 text-[10px] text-text-muted', children: ['+', hiddenReceiptCount] })
      } else {
        assert.equal(overflow, null)
      }
    }
  }
})
