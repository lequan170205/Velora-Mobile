const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const friendsScreen = read('app/(tabs)/friends.tsx')
const animatedActionSheet = read('src/components/common/AnimatedActionSheet.tsx')
const profileActionsMenu = read('src/components/profile/ProfileActionsMenu.tsx')

const sheetStart = friendsScreen.indexOf('export function FriendActionsSheet')
const screenStart = friendsScreen.indexOf('export default function FriendsScreen')
assert.ok(sheetStart >= 0, 'FriendActionsSheet export should exist')
assert.ok(screenStart > sheetStart, 'FriendsScreen should follow FriendActionsSheet')

const friendActionsSheet = friendsScreen.slice(sheetStart, screenStart)
const friendsScreenBody = friendsScreen.slice(screenStart)

const sliceBetween = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.ok(start >= 0, `missing start marker: ${startMarker}`)
  assert.ok(end > start, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

test('the temporary sheet preview route is not part of production routes', () => {
  assert.equal(fs.existsSync(path.join(root, 'app/(auth)/sheet-preview.tsx')), false)
})

test('Block requires confirmation before invoking the mutation', () => {
  const confirmationBranchStart = friendActionsSheet.indexOf('{confirmation ?')
  const initialActionsStart = friendActionsSheet.indexOf(') : (', confirmationBranchStart)
  const blockMutationIndex = friendActionsSheet.indexOf('onBlock(friend, closeAfterSuccess)')
  const initialActions = friendActionsSheet.slice(initialActionsStart)

  assert.ok(confirmationBranchStart >= 0, 'the sheet should have a confirmation branch')
  assert.ok(initialActionsStart > confirmationBranchStart, 'the initial action branch should exist')
  assert.ok(blockMutationIndex > 0, 'the confirmation branch should invoke Block')
  assert.match(
    initialActions,
    /onPress=\{\(\) => setConfirmation\('block'\)\}/,
  )
  assert.doesNotMatch(initialActions, /onBlock\(friend, closeAfterSuccess\)/)
  assert.match(
    friendActionsSheet,
    /accessibilityHint="Opens a confirmation before blocking this account"/,
  )
  assert.match(friendActionsSheet, /confirmationTitle[\s\S]*confirmation === 'block'/)
  assert.match(friendActionsSheet, /confirmation === 'remove' \? 'Remove' : 'Block'/)
})

test('remove and block submissions share pending and duplicate guards', () => {
  const removeCallback = sliceBetween(
    friendsScreenBody,
    'const removeSelectedFriend = useCallback(',
    'const blockSelectedFriend = useCallback(',
  )
  const blockCallback = sliceBetween(
    friendsScreenBody,
    'const blockSelectedFriend = useCallback(',
    'const openFriendActions = useCallback(',
  )

  for (const callback of [removeCallback, blockCallback]) {
    assert.match(
      callback,
      /if \(friendActionStartedRef\.current \|\| remove\.isPending \|\| block\.isPending\) return/,
    )
    assert.match(callback, /friendActionStartedRef\.current = true/)
    assert.match(callback, /onSettled: \(\) => \{\s*friendActionStartedRef\.current = false/)
  }

  assert.match(friendActionsSheet, /disabled=\{isActionPending\}/)
  assert.match(friendActionsSheet, /const actionsDisabled = isActionPending \|\| isClosing/)
  assert.match(friendActionsSheet, /if \(!confirmation \|\| actionsDisabled\) return/)
  assert.match(animatedActionSheet, /if \(\(disabled && !options\.force\) \|\| isClosingRef\.current\)/)
  assert.match(animatedActionSheet, /onRequestClose=\{\(\) => close\(\)\}/)
  assert.match(friendsScreenBody, /isBlocking=\{block\.isPending\}/)
  assert.match(
    friendsScreenBody,
    /isRemoving=\{\s*Boolean\(selectedFriend\)[\s\S]*remove\.isPending[\s\S]*selectedFriend\?\.user\.id/,
  )
})

test('a failed block leaves confirmation retryable until a successful mutation', () => {
  const blockCallback = sliceBetween(
    friendsScreenBody,
    'const blockSelectedFriend = useCallback(',
    'const openFriendActions = useCallback(',
  )
  const confirmationBranch = sliceBetween(
    friendActionsSheet,
    'const confirmDestructiveAction = () => {',
    'return (',
  )

  assert.match(blockCallback, /block\.mutate\(friend\.user\.id, \{\s*onSuccess,\s*onSettled:/)
  assert.doesNotMatch(blockCallback, /onError/)
  assert.match(confirmationBranch, /onBlock\(friend, closeAfterSuccess\)/)
  assert.match(friendActionsSheet, /confirmation === 'block' && isBlocking/)
  assert.match(friendActionsSheet, /onPress=\{confirmDestructiveAction\}/)
  assert.match(friendActionsSheet, /disabled=\{actionsDisabled\}/)
})

test('profile navigation runs only after the shared sheet exit animation completes', () => {
  const closeStart = animatedActionSheet.indexOf('const close = useCallback(')
  const closeCompletion = animatedActionSheet.indexOf('onClose()\n        afterClose?.()', closeStart)
  const viewProfilePress = friendActionsSheet.indexOf(
    'onPress={() => close(() => onViewProfile(friend))}',
  )

  assert.ok(closeStart >= 0, 'shared sheet close handler should exist')
  assert.ok(closeCompletion > closeStart, 'close should invoke callbacks in its completion block')
  assert.ok(viewProfilePress >= 0, 'View profile should use the shared close callback')
  assert.match(
    animatedActionSheet.slice(closeStart),
    /setTimeout\(\(\) => \{[\s\S]*onClose\(\)[\s\S]*afterClose\?\.\(\)[\s\S]*\}, 150\)/,
  )
  assert.match(animatedActionSheet, /duration: 150/)
  assert.match(friendActionsSheet, /<AnimatedActionSheet[\s\S]*onClose=\{handleClosed\}/)
  assert.match(profileActionsMenu, /<AnimatedActionSheet/)
})
