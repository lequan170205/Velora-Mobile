const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const loadTypeScriptModule = (relativePath) => {
  const absolutePath = path.join(root, relativePath)
  const compiled = ts.transpileModule(fs.readFileSync(absolutePath, 'utf8'), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: absolutePath,
  }).outputText
  const loadedModule = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(
    require,
    loadedModule,
    loadedModule.exports,
  )
  return loadedModule.exports
}

const presentation = loadTypeScriptModule('src/lib/call/callHistoryPresentation.ts')
const { normalizeMessageMetadata } = loadTypeScriptModule('src/lib/messageMetadata.ts')

const call = (overrides) => ({
  callType: 'VOICE',
  isGroupCall: false,
  outcome: 'COMPLETED',
  role: 'CALLER',
  result: 'ANSWERED',
  ...overrides,
})

test('call wording follows the viewer side of the call', () => {
  const { describeCallForViewer } = presentation

  assert.deepEqual(describeCallForViewer(call({ durationSec: 192 })), {
    title: 'Outgoing voice call',
    detail: '3:12',
    icon: 'call-made',
    isMissed: false,
  })
  assert.deepEqual(
    describeCallForViewer(call({ role: 'CALLEE', callType: 'VIDEO', durationSec: 3725 })),
    { title: 'Incoming video call', detail: '1:02:05', icon: 'call-received', isMissed: false },
  )
  assert.deepEqual(
    describeCallForViewer(call({ outcome: 'MISSED', role: 'CALLEE', result: 'MISSED' })),
    { title: 'Missed voice call', detail: null, icon: 'call-missed', isMissed: true },
  )
  assert.equal(
    describeCallForViewer(
      call({ outcome: 'MISSED', result: 'CANCELLED', terminalReason: 'no_answer' }),
    ).title,
    'No answer',
  )
  assert.equal(
    describeCallForViewer(call({ outcome: 'MISSED', result: 'CANCELLED', terminalReason: 'busy' }))
      .title,
    'Line busy',
  )
  assert.equal(
    describeCallForViewer(
      call({ outcome: 'MISSED', result: 'CANCELLED', terminalReason: 'cancelled' }),
    ).title,
    'Cancelled voice call',
  )
  assert.equal(
    describeCallForViewer(call({ outcome: 'DECLINED', result: 'DECLINED' })).title,
    'Voice call declined',
  )
  assert.equal(
    describeCallForViewer(call({ outcome: 'DECLINED', role: 'CALLEE', result: 'DECLINED' })).title,
    'Declined voice call',
  )
  assert.equal(
    describeCallForViewer(call({ outcome: 'FAILED', result: 'FAILED' })).title,
    'Voice call failed',
  )
})

test('group members who were not in the call see a neutral summary', () => {
  assert.deepEqual(
    presentation.describeCallForViewer(
      call({ isGroupCall: true, role: null, result: null, durationSec: 59 }),
    ),
    { title: 'Group voice call', detail: '0:59', icon: 'call-end', isMissed: false },
  )
})

test('a logged call is described from the current user participant entry', () => {
  const callLog = {
    callId: 'call-1',
    callType: 'VOICE',
    isGroupCall: false,
    initiatorId: 'caller',
    outcome: 'MISSED',
    terminalReason: 'no_answer',
    participants: [
      { userId: 'caller', role: 'CALLER', result: 'CANCELLED' },
      { userId: 'callee', role: 'CALLEE', result: 'MISSED' },
    ],
  }

  assert.equal(presentation.describeCallLogForViewer(callLog, 'callee').title, 'Missed voice call')
  assert.equal(presentation.describeCallLogForViewer(callLog, 'caller').title, 'No answer')
  assert.equal(presentation.describeCallLogForViewer(callLog, null).isMissed, false)
})

test('call list times are short and relative to today', () => {
  const now = new Date(2026, 9, 22, 18, 0)
  const at = (day, hour, minute) => new Date(2026, 9, day, hour, minute).toISOString()

  assert.equal(presentation.formatCallListTime(at(22, 9, 5), now), '09:05')
  assert.equal(presentation.formatCallListTime(at(21, 23, 0), now), 'Yesterday')
  assert.equal(presentation.formatCallListTime(at(18, 12, 0), now), 'Sun')
  assert.equal(presentation.formatCallListTime(at(3, 12, 0), now), '3 Oct')
  assert.equal(presentation.formatCallListTime('not-a-date', now), '')
})

test('call_log metadata is normalized and keeps its kind without a payload', () => {
  assert.deepEqual(
    normalizeMessageMetadata({
      kind: 'call_log',
      callLog: {
        callId: 'call-1',
        call_type: 'VIDEO',
        initiatorId: 'caller',
        outcome: 'COMPLETED',
        durationSec: 60.4,
        participants: [
          { userId: 'caller', role: 'CALLER', result: 'ANSWERED' },
          { userId: 'bad', role: 'HOST', result: 'ANSWERED' },
        ],
      },
    }),
    {
      kind: 'call_log',
      callLog: {
        callId: 'call-1',
        callType: 'VIDEO',
        isGroupCall: false,
        initiatorId: 'caller',
        outcome: 'COMPLETED',
        durationSec: 60,
        participants: [{ userId: 'caller', role: 'CALLER', result: 'ANSWERED' }],
      },
    },
  )
  assert.deepEqual(normalizeMessageMetadata({ kind: 'call_log', callLog: { outcome: 'X' } }), {
    kind: 'call_log',
  })
})

test('call rows are server-authored rows, never optimistic acknowledgements', () => {
  const chatStore = read('src/stores/chatStore.ts')
  const messageBubble = read('src/components/chat/MessageBubble.tsx')
  const messageIdentity = read('src/lib/messageIdentity.ts')

  assert.match(chatStore, /currentMessage\.metadata\?\.kind === 'call_log'[\s\S]*return state/)
  assert.match(
    messageBubble,
    /metadata\?\.kind === 'call_log'[\s\S]*<CallLogRow[\s\S]*metadata\?\.kind === 'group_system_activity'/,
  )
  assert.match(messageIdentity, /\.\.\.\(callLog !== undefined \? \{ callLog \} : \{\}\)/)
})

test('tab bar entries, routes and tab index constants stay in the same order', () => {
  const layout = read('app/(tabs)/_layout.tsx')
  const tabBar = read('src/components/navigation/CustomTabBar.tsx')
  const routes = [...layout.matchAll(/<Tabs\.Screen name="([^"]+)"/g)].map((match) => match[1])
  const tabsBlock = tabBar.slice(tabBar.indexOf('const TABS'), tabBar.indexOf('type BarTheme'))
  const tabNames = [...tabsBlock.matchAll(/name: (?:'([^']+)'|CALLS_TAB_NAME)/g)].map(
    (match) => match[1] ?? 'calls',
  )
  const constant = (name) => Number(new RegExp(`${name} = (\\d+)`).exec(tabBar)[1])

  assert.deepEqual(routes, ['index', 'calls', 'search', 'reels', 'friends', 'profile'])
  assert.deepEqual(tabNames, routes)
  assert.equal(routes[constant('REELS_TAB_INDEX')], 'reels')
  assert.equal(routes[constant('PROFILE_TAB_INDEX')], 'profile')
  assert.equal(routes[constant('MESSAGES_TAB_INDEX')], 'index')
  assert.match(tabBar, /badgeCount=\{tab\.name === CALLS_TAB_NAME \? missedCallCount : 0\}/)
})

test('missed calls refresh the badge and open their conversation from a push', () => {
  const socketProvider = read('src/providers/SocketProvider.tsx')
  const fcmProvider = read('src/providers/FcmDebugProvider.tsx')
  const queryProvider = read('src/providers/QueryProvider.tsx')
  const callsScreen = read('app/(tabs)/calls.tsx')

  // Call rows reach every device through new_message: the socket joins every
  // conversation room, and the server never sends them as message activity.
  const newMessageHandler = socketProvider.slice(
    socketProvider.indexOf("newSocket.on('new_message'"),
    socketProvider.indexOf("'conversation_message_activity'"),
  )
  assert.match(
    newMessageHandler,
    /metadata\?\.kind === 'call_log'\) \{[\s\S]*invalidateCallHistoryQueries\(queryClient\)/,
  )
  assert.match(socketProvider, /joinConversationRooms\(\s*Array\.isArray\(cachedConversations\)/)
  assert.match(fcmProvider, /new Set\(\['NEW_MESSAGE', 'MISSED_CALL'\]\)/)
  assert.match(queryProvider, /removeQueries\(\{ queryKey: queryKeys\.calls\.all \}\)/)
  assert.match(callsScreen, /useFocusEffect[\s\S]*markMissedCallsSeen\(\)/)
})

test('the Calls tab spinner only follows a pull, never a background refetch', () => {
  const callsScreen = read('app/(tabs)/calls.tsx')

  assert.match(callsScreen, /<RefreshControl\s+refreshing=\{isRefreshing\}/)
  assert.doesNotMatch(callsScreen, /refreshing=\{[^}]*isRefetching/)
})
