const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const searchScreen = read('app/(tabs)/search.tsx')
const resultTabs = read('src/components/search/SearchResultTabs.tsx')
const tagChips = read('src/components/search/SearchTagChips.tsx')
const tagRow = read('src/components/search/SearchTagRow.tsx')
const aiButton = read('src/components/search/VeloraAiButton.tsx')

test('Search keeps the Velora AI action beside the search bar while browsing', () => {
  const topBarStart = searchScreen.indexOf('function SearchTopBar')
  const searchBarStart = searchScreen.indexOf('<AppSearchBar')

  assert.ok(topBarStart >= 0)
  assert.ok(searchBarStart > topBarStart)
  assert.match(searchScreen, /<VeloraAiButton isLoading=\{isBotLoading\} onPress=\{onBotChat\} \/>/)
  assert.match(aiButton, /accessibilityLabel="Open Velora AI"/)
  assert.match(aiButton, /velora-mark\.png/)
  assert.doesNotMatch(aiButton, /auto-awesome/)
  assert.match(aiButton, /tintColor/)
  assert.match(searchScreen, /accessibilityLabel="Back"/)
})

test('Search browse mode puts one tag chip rail under the bar and a reel grid below it', () => {
  const chipsAt = searchScreen.indexOf('<SearchTagChips')
  const gridAt = searchScreen.indexOf('<BrowseReelsFeed')

  assert.ok(chipsAt > searchScreen.indexOf('<SearchTopBar'))
  assert.ok(gridAt > chipsAt)
  assert.match(tagChips, /horizontal/)
  assert.match(tagChips, /label="For you"/)
  assert.match(tagChips, /accessibilityState=\{\{ selected: active \}\}/)
  assert.match(searchScreen, /numColumns=\{3\}/)
  assert.match(searchScreen, /onEndReached=\{onEndReached\}/)
  assert.match(searchScreen, /useTagReelsFeed/)
  assert.match(searchScreen, /deriveTagsFromReels\(recommendedReels/)
})

test('Search results use underlined filter tabs for For you, Accounts, Reels, and Tags', () => {
  assert.match(resultTabs, /accessibilityRole="tab"/)
  assert.match(resultTabs, /accessibilityState=\{\{ selected: active \}\}/)
  assert.match(resultTabs, /min-h-11 flex-1/)
  assert.doesNotMatch(resultTabs, /ActivityIndicator/)

  for (const label of ['For you', 'Accounts', 'Reels', 'Tags']) {
    assert.match(resultTabs, new RegExp(`label: '${label}'`))
  }

  assert.match(searchScreen, /<SearchResultTabs selected=\{selectedTab\}/)
})

test('Tapping a tag leaves search and filters the browse grid by that tag', () => {
  const handlerStart = searchScreen.indexOf('const handleTagPress')

  assert.ok(handlerStart >= 0)
  assert.match(
    searchScreen.slice(handlerStart, handlerStart + 200),
    /setActiveTag\(tag\)[\s\S]*handleExitSearch\(\)/,
  )
  assert.match(tagRow, /accessibilityLabel=\{`Browse reels tagged \$\{item\.tag\}`\}/)
})

test('Search uses shared contact rows and branded state treatments', () => {
  assert.match(
    searchScreen,
    /<ChatAvatar name=\{user\.fullName\} picture=\{user\.picture\} size=\{52\}/,
  )
  assert.match(searchScreen, /className="flex-row items-center px-5 py-3\.5"/)
  assert.match(searchScreen, /function ContactRowSkeleton/)
  assert.match(searchScreen, /function TagRowsSkeleton/)
  assert.match(searchScreen, /ReelThumbnailGridSkeleton/)
  assert.match(searchScreen, /rounded-\[24px\] border border-brand-soft bg-surface-accent/)
  assert.match(searchScreen, /icon="cloud-off"/)
  assert.match(searchScreen, /title="You’re offline"/)
  assert.doesNotMatch(searchScreen, /<Image/)
})

test('Cache cleanup after a block only touches shapes it understands', () => {
  const friendCache = read('src/lib/friendCache.ts')

  assert.match(friendCache, /\[\.\.\.queryKeys\.search\.all, 'global'\]/)
  assert.match(friendCache, /\[\.\.\.queryKeys\.search\.all, 'tag-reels'\]/)
})
