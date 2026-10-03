const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const React = require('react')
const ts = require('typescript')

const source = fs.readFileSync(path.resolve(__dirname, '../src/components/call/VideoParticipantGrid.tsx'), 'utf8')
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const moduleUnderTest = { exports: {} }
new Function('require', 'module', 'exports', output)(
  (name) => name === 'react-native' ? { View: 'View' } : require(name),
  moduleUnderTest, moduleUnderTest.exports,
)
const { VideoParticipantGrid } = moduleUnderTest.exports

test('video grid preserves row layout, child order, keys and styles across orientation and child changes', () => {
  const tile = (key, camera = 'RTCView') => React.createElement('ParticipantTile', { key }, React.createElement(camera))
  const fixtures = [
    [[], [], []],
    [[tile('one')], [1], [1]],
    [[tile('remote-participant'), tile('local-participant')], [1, 1], [2]],
    [[tile('a'), tile('b'), tile('c')], [2, 1], [2, 1]],
    [[tile('a'), tile('b'), tile('c'), tile('d')], [2, 2], [2, 2]],
    [[tile('a'), tile('b'), tile('c'), tile('d'), tile('e')], [2, 2, 1], [2, 2, 1]],
    [[tile('a'), tile('b'), tile('c'), tile('d'), tile('e'), tile('f')], [2, 2, 2], [2, 2, 2]],
    [null, [], []],
    [undefined, [], []],
    [false, [], []],
    [true, [], []],
    [tile(''), [1], [1]],
    [[null, tile('peer:='), [false, tile(undefined), [tile('third')]]], [2, 1], [2, 1]],
    [React.createElement(React.Fragment, null, tile('a'), tile('b')), [1], [1]],
    [['label', 0, ''], [2, 1], [2, 1]],
  ]
  for (const remoteCamera of ['RTCView', 'CameraOffSurface']) {
    for (const localCamera of ['RTCView', 'CameraOffSurface']) {
      fixtures.push([[tile('remote-participant', remoteCamera), tile('local-participant', localCamera)], [1, 1], [2]])
    }
  }

  for (const [children, portraitRows, landscapeRows] of fixtures) {
    const expectedTiles = React.Children.toArray(children)
    for (const isLandscape of [false, true]) {
      const tree = VideoParticipantGrid({ children, isLandscape })
      assert.equal(tree.type, 'View')
      assert.equal(tree.props.className, 'flex-1')
      assert.deepEqual(tree.props.style, { gap: 3 })
      const rows = tree.props.children
      assert.deepEqual(rows.map((row) => row.props.children.length), isLandscape ? landscapeRows : portraitRows)
      let childIndex = 0
      rows.forEach((row, rowIndex) => {
        assert.equal(row.type, 'View')
        assert.equal(row.key, `video-row-${rowIndex}`)
        assert.equal(row.props.className, 'flex-1 flex-row')
        assert.deepEqual(row.props.style, { gap: 3 })
        row.props.children.forEach((wrapper, tileIndex) => {
          const expected = expectedTiles[childIndex++]
          assert.equal(wrapper.type, 'View')
          assert.equal(wrapper.props.className, 'flex-1')
          if (React.isValidElement(expected)) {
            assert.equal(wrapper.key, expected.key)
            assert.equal(wrapper.props.children.type, expected.type)
            assert.equal(wrapper.props.children.props, expected.props)
          } else {
            assert.equal(wrapper.key, `video-tile-${rowIndex}-${tileIndex}`)
            assert.equal(wrapper.props.children, expected)
          }
        })
      })
      assert.equal(childIndex, expectedTiles.length)
    }
  }
})
