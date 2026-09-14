const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const searchScreen = fs.readFileSync(path.join(root, 'app/(tabs)/search.tsx'), 'utf8')

test('Search keeps the Velora header and AI action above the search controls', () => {
  const headerStart = searchScreen.indexOf('function SearchHeader')
  const searchBarStart = searchScreen.indexOf('<AppSearchBar')

  assert.ok(headerStart >= 0)
  assert.ok(searchBarStart > headerStart)
  assert.match(searchScreen, /Velora/)
  assert.match(searchScreen, /Search/)
  assert.match(searchScreen, /accessibilityLabel="Open Velora AI"/)
  assert.match(searchScreen, /name="auto-awesome"/)
  assert.match(
    searchScreen,
    /h-12 w-12 items-center justify-center overflow-hidden rounded-\[18px\].*bg-surface-accent/,
  )
})

test('Search uses a Friends-style segmented control with every result label visible', () => {
  const tabStart = searchScreen.indexOf('function SearchTabButton')
  const sectionHeaderStart = searchScreen.indexOf('function SearchSectionHeader')
  const tabImplementation = searchScreen.slice(tabStart, sectionHeaderStart)

  assert.match(searchScreen, /mx-5 mt-3 flex-row rounded-full bg-surface-muted p-1/)
  assert.match(tabImplementation, /h-11 flex-1 flex-row items-center justify-center rounded-full/)
  assert.match(tabImplementation, /accessibilityRole="tab"/)
  assert.match(tabImplementation, /accessibilityState=\{\{ selected: active \}\}/)
  assert.match(tabImplementation, /<AppText/)
  assert.doesNotMatch(tabImplementation, /ActivityIndicator/)
  assert.doesNotMatch(tabImplementation, /Velora AI/)

  for (const label of ['All', 'Reels', 'Contacts']) {
    assert.match(searchScreen, new RegExp(`label="${label}"`))
  }
})

test('Search uses shared contact rows and branded state treatments', () => {
  assert.match(
    searchScreen,
    /<ChatAvatar name=\{user\.fullName\} picture=\{user\.picture\} size=\{52\}/,
  )
  assert.match(searchScreen, /className="flex-row items-center px-5 py-3\.5"/)
  assert.match(searchScreen, /function ContactRowSkeleton/)
  assert.match(searchScreen, /function SuggestionChipSkeleton/)
  assert.match(searchScreen, /ReelThumbnailGridSkeleton/)
  assert.match(searchScreen, /rounded-\[24px\] border border-brand-soft bg-surface-accent/)
  assert.match(searchScreen, /icon="cloud-off"/)
  assert.match(searchScreen, /title="You’re offline"/)
  assert.doesNotMatch(searchScreen, /<Image/)
})
