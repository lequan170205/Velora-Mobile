const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const searchScreen = read('app/(tabs)/search.tsx')
const friendsScreen = read('app/(tabs)/friends.tsx')

test('repeated Friends entry reselects Contacts after a manual Search tab change', () => {
  assert.match(
    friendsScreen,
    /router\.push\(\{ pathname: '\/\(tabs\)\/search', params: \{ tab: 'contacts' \} \}\)/,
  )

  const switchHandlerStart = searchScreen.indexOf('const handleSwitchSearchTab')
  const suggestionHandlerStart = searchScreen.indexOf('const handleSuggestionPress')
  const switchHandler = searchScreen.slice(switchHandlerStart, suggestionHandlerStart)

  assert.match(switchHandler, /setSelectedTab\(tab\)/)
  assert.match(switchHandler, /router\.setParams\(\{ tab \}\)/)
  assert.match(searchScreen, /onPress=\{\(\) => handleSwitchSearchTab\('all'\)\}/)
  assert.match(searchScreen, /onPress=\{\(\) => handleSwitchSearchTab\('reels'\)\}/)
  assert.match(searchScreen, /onPress=\{\(\) => handleSwitchSearchTab\('contacts'\)\}/)
  assert.doesNotMatch(searchScreen, /onPress=\{\(\) => setSelectedTab\(/)
  assert.match(
    searchScreen,
    /const handleSuggestionPress[\s\S]*handleSwitchSearchTab\('all'\)[\s\S]*\[handleSwitchSearchTab\]/,
  )
  assert.match(
    searchScreen,
    /useEffect\(\(\) => \{[\s\S]*if \(routeTab\) \{[\s\S]*setSelectedTab\(routeTab\)[\s\S]*\}, \[routeTab\]\)/,
  )
  assert.doesNotMatch(
    searchScreen.slice(suggestionHandlerStart, searchScreen.indexOf('const handleUserPress')),
    /setSelectedTab\(/,
  )
})

test('missing or invalid Search tab params still default to All', () => {
  assert.match(
    searchScreen,
    /normalizedValue === 'all' \|\| normalizedValue === 'reels' \|\| normalizedValue === 'contacts'/,
  )
  assert.match(searchScreen, /\? normalizedValue\s+: null/)
  assert.match(searchScreen, /useState<SearchTabKey>\(\(\) => routeTab \?\? 'all'\)/)
})
