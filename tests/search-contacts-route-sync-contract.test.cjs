const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const searchScreen = read('app/(tabs)/search.tsx')
const friendsScreen = read('app/(tabs)/friends.tsx')

test('repeated Friends entry reselects Accounts after a manual Search tab change', () => {
  assert.match(
    friendsScreen,
    /router\.push\(\{ pathname: '\/\(tabs\)\/search', params: \{ tab: 'contacts' \} \}\)/,
  )

  const switchHandlerStart = searchScreen.indexOf('const handleSwitchSearchTab')
  const exitHandlerStart = searchScreen.indexOf('const handleExitSearch')
  const switchHandler = searchScreen.slice(switchHandlerStart, exitHandlerStart)

  assert.ok(switchHandlerStart >= 0 && exitHandlerStart > switchHandlerStart)
  assert.match(switchHandler, /setSelectedTab\(tab\)/)
  assert.match(switchHandler, /router\.setParams\(\{ tab \}\)/)
  assert.match(searchScreen, /onChange=\{handleSwitchSearchTab\}/)
  assert.doesNotMatch(searchScreen, /onPress=\{\(\) => setSelectedTab\(/)

  // The route param drives both the tab and search mode, and leaving search clears it so the
  // next Friends entry is observed as a param change.
  assert.match(
    searchScreen,
    /useEffect\(\(\) => \{[\s\S]*if \(routeTab\) \{[\s\S]*setSelectedTab\(routeTab\)[\s\S]*setIsSearching\(true\)[\s\S]*\}, \[routeTab\]\)/,
  )
  assert.match(
    searchScreen.slice(exitHandlerStart, exitHandlerStart + 600),
    /router\.setParams\(\{ tab: undefined \}\)/,
  )
})

test('missing or invalid Search tab params still default to For you', () => {
  assert.match(searchScreen, /normalizedValue === 'contacts'/)
  assert.match(searchScreen, /normalizedValue === 'tags'/)
  assert.match(searchScreen, /\? normalizedValue\s+: null/)
  assert.match(searchScreen, /useState<SearchTabKey>\(\(\) => routeTab \?\? 'all'\)/)
  assert.match(searchScreen, /useState\(\(\) => routeTab !== null\)/)
})
