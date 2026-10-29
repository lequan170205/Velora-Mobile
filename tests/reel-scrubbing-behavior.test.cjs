const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const source = fs.readFileSync(
  path.join(__dirname, '../src/components/reels/ReelFeedItem.tsx'),
  'utf8',
)
const file = ts.createSourceFile('ReelFeedItem.tsx', source, ts.ScriptTarget.Latest, true)
const declarations = new Map()
const effects = []
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    declarations.set(node.name.text, `const ${node.getText(file)}`)
  }
  if (
    ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) &&
    node.expression.expression.getText(file) === 'useEffect' &&
    node.getText(file).includes('AppState.addEventListener')
  ) {
    effects.push(node.getText(file))
  }
  ts.forEachChild(node, visit)
}
visit(file)
const names = [
  'SCRUBBER_EDGE_GUTTER',
  'clamp',
  'mapScrubTouchX',
  'setIsPausedByUser',
  'isCurrentScrub',
  'seekToRatio',
  'beginScrub',
  'updateScrub',
  'finishScrub',
  'scrubGesture',
]
for (const name of names) assert.ok(declarations.has(name), `missing actual callback: ${name}`)
assert.equal(effects.length, 1)
const code = ts.transpileModule(
  `${names.map((name) => declarations.get(name)).join('\n')}
${effects[0]}
return { beginScrub, updateScrub, finishScrub, scrubGesture }`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText

const shared = (value) => ({
  value,
  get() {
    return this.value
  },
  set(next) {
    this.value = next
  },
})

// Execute the component's real gesture callbacks with controllable RN scheduling.
const createHarness = (platform = 'ios', { paused = false, duration = 100 } = {}) => {
  const calls = { seeks: [], paused: [], haptics: 0, plays: 0, pauses: 0 }
  const state = { paused, scrubbing: false, pendingRatio: null, position: 0 }
  const pending = []
  const listeners = new Set()
  const cleanups = []
  const gesture = {}
  for (const method of [
    'enabled',
    'averageTouches',
    'maxPointers',
    'activeOffsetX',
    'failOffsetY',
  ]) {
    gesture[method] = () => gesture
  }
  for (const method of ['onStart', 'onUpdate', 'onEnd', 'onFinalize']) {
    gesture[method] = (callback) => {
      gesture[`${method}Callback`] = callback
      return gesture
    }
  }
  const context = {
    AppState: {
      currentState: 'active',
      addEventListener: (_event, listener) => {
        listeners.add(listener)
        return { remove: () => listeners.delete(listener) }
      },
    },
    Platform: { OS: platform },
    Gesture: { Pan: () => gesture },
    useCallback: (callback) => callback,
    useMemo: (factory) => factory(),
    useEffect: (effect) => cleanups.push(effect()),
    withTiming: (value) => value,
    cancelAnimation: () => undefined,
    scheduleOnRN: (callback, ...args) => pending.push(() => callback(...args)),
    durationSeconds: duration,
    scrubberWidth: 100,
    isActive: true,
    isActiveRef: { current: true },
    isPausedByUser: paused,
    isPausedByUserRef: { current: paused },
    playerGeneration: 1,
    playerIdentityRef: { current: { playerGeneration: 1 } },
    videoSourceKey: 'viewer:reel:source',
    videoRef: {
      current: {
        seekTo: (seconds) => calls.seeks.push(seconds),
        play: () => {
          calls.plays += 1
        },
        pause: () => {
          calls.pauses += 1
        },
      },
    },
    lastPlaybackPositionRef: { current: 80 },
    scrubSessionRef: { current: null },
    resumeAfterScrub: shared(0),
    pendingSeekTarget: shared(-1),
    lastScrubRatio: shared(0),
    scrubUpdateSample: shared(0),
    scrubReleaseHandled: shared(0),
    scrubGestureId: shared(0),
    timelinePreviewRatio: shared(0),
    playbackState: { isPlayable: true },
    TIMELINE_MOTION_EASING: 'existing easing',
    setIsPausedByUserState: (value) => {
      calls.paused.push(value)
      state.paused = value
    },
    setIsScrubbing: (value) => {
      state.scrubbing = value
    },
    setPendingSeekRatio: (value) => {
      state.pendingRatio = value
    },
    setScrubPosition: (value) => {
      state.position = value
    },
    triggerScrubStartHaptic: () => {
      calls.haptics += 1
    },
  }
  const callbacks = new Function(...Object.keys(context), code)(...Object.values(context))
  const flush = () => {
    while (pending.length) pending.shift()()
  }
  const emit = (event, x = 26, extra = {}) => {
    gesture[`${event}Callback`]({ x, velocityX: 0, ...extra }, extra.success ?? true)
    flush()
  }
  return {
    callbacks,
    calls,
    context,
    state,
    pending,
    gesture,
    flush,
    emit,
    appState: (next) => {
      context.AppState.currentState = next
      for (const listener of listeners) listener(next)
    },
    cleanup: () => cleanups.forEach((cleanup) => cleanup?.()),
    listeners,
  }
}

test('iOS updates the timeline during dragging and seeks only once on release', () => {
  const h = createHarness()
  h.emit('onStart', 40)
  for (let i = 0; i < 12; i += 1) h.emit('onUpdate', 20)
  assert.deepEqual(h.calls.seeks, [])
  assert.ok(h.context.timelinePreviewRatio.value > 0)
  assert.equal(h.state.position, (20 / 52) * 100)
  assert.equal(h.state.scrubbing, true)
  assert.equal(h.state.paused, true)
  h.emit('onEnd', 26)
  h.emit('onFinalize', 26)
  assert.deepEqual(h.calls.seeks, [50])
  assert.deepEqual(h.calls.paused, [true, false])
  assert.equal(h.calls.plays, 1)
  assert.equal(h.calls.pauses, 1)
  assert.equal(h.state.scrubbing, false)
})

test('Android retains its initial, sampled preview, and final native seeks', () => {
  const h = createHarness('android')
  h.emit('onStart', 0)
  for (let i = 0; i < 12; i += 1) h.emit('onUpdate', 26)
  assert.deepEqual(h.calls.seeks, [0, 50, 50])
  h.emit('onEnd', 13)
  h.emit('onFinalize', 13)
  assert.deepEqual(h.calls.seeks, [0, 50, 50, 25])
  assert.deepEqual(h.calls.paused, [true, false])
  assert.equal(h.calls.plays, 0)
  assert.equal(h.listeners.size, 0)
})

test('iOS preserves an intentional pause and ignores duplicate release callbacks', () => {
  const h = createHarness('ios', { paused: true })
  h.emit('onStart')
  h.emit('onEnd')
  h.emit('onEnd')
  h.emit('onFinalize')
  assert.deepEqual(h.calls.seeks, [50])
  assert.deepEqual(h.calls.paused, [true])
  assert.equal(h.state.paused, true)
  assert.equal(h.calls.plays, 0)
})

test('iOS cancellation restores playback intent without committing a seek', () => {
  for (const paused of [false, true]) {
    const h = createHarness('ios', { paused })
    h.emit('onStart')
    h.emit('onEnd', 26, { success: false })
    h.emit('onFinalize', 26, { success: false })
    assert.deepEqual(h.calls.seeks, [])
    assert.equal(h.state.paused, paused)
    assert.equal(h.state.scrubbing, false)
    assert.equal(h.state.pendingRatio, null)
    assert.equal(h.calls.plays, paused ? 0 : 1)
    assert.equal(h.context.timelinePreviewRatio.value, 0.8)
  }
})

test('iOS ignores finalization before a drag starts and invalid timelines', () => {
  const h = createHarness()
  h.emit('onFinalize', 26, { success: false })
  assert.deepEqual(h.calls.seeks, [])
  assert.deepEqual(h.calls.paused, [])
  const invalid = createHarness('ios', { duration: 0 })
  invalid.emit('onStart')
  invalid.emit('onEnd')
  assert.deepEqual(invalid.calls.seeks, [])
  assert.deepEqual(invalid.calls.paused, [])
})

test('iOS fences queued updates and releases after source change, blur, or unmount', () => {
  for (const invalidate of [
    (h) => {
      h.context.playerIdentityRef.current.playerGeneration += 1
    },
    (h) => {
      h.context.isActiveRef.current = false
    },
    (h) => h.cleanup(),
  ]) {
    const h = createHarness()
    h.emit('onStart')
    h.gesture.onEndCallback({ x: 26, velocityX: 0 }, true)
    invalidate(h)
    h.flush()
    h.callbacks.updateScrub(10, 1)
    assert.deepEqual(h.calls.seeks, [])
    assert.deepEqual(h.calls.paused, [true])
    assert.equal(h.calls.plays, 0)
  }
})

test('iOS rejects a queued drag start after its source or active screen changes', () => {
  for (const invalidate of [
    (h) => {
      h.context.playerIdentityRef.current.playerGeneration += 1
    },
    (h) => {
      h.context.isActiveRef.current = false
    },
    (h) => {
      h.context.AppState.currentState = 'background'
    },
  ]) {
    const h = createHarness()
    h.gesture.onStartCallback({ x: 26 })
    invalidate(h)
    h.flush()
    assert.deepEqual(h.calls.seeks, [])
    assert.deepEqual(h.calls.paused, [])
  }
})

test('backgrounding cancels iOS scrubbing and late foreground release cannot seek or resume', () => {
  for (const paused of [false, true]) {
    const h = createHarness('ios', { paused })
    h.emit('onStart')
    h.appState('inactive')
    assert.equal(h.state.paused, paused)
    assert.equal(h.state.scrubbing, false)
    assert.equal(h.state.pendingRatio, null)
    const pauseCalls = [...h.calls.paused]
    h.appState('active')
    h.emit('onEnd')
    assert.deepEqual(h.calls.seeks, [])
    assert.deepEqual(h.calls.paused, pauseCalls)
    assert.equal(h.calls.plays, 0)
  }
})

test('a newer iOS drag ignores the older release and keeps the original playback intent', () => {
  const h = createHarness()
  h.emit('onStart')
  h.emit('onStart', 13)
  h.callbacks.finishScrub(75, 0, 1)
  assert.deepEqual(h.calls.seeks, [])
  h.emit('onEnd', 13)
  assert.deepEqual(h.calls.seeks, [25])
  assert.equal(h.state.paused, false)
  assert.equal(h.calls.plays, 1)
})

test('a fast iOS drag resumes the player even when React has not rendered the pause', () => {
  const h = createHarness()
  h.gesture.onStartCallback({ x: 40 })
  h.gesture.onEndCallback({ x: 13, velocityX: 0 }, true)
  h.gesture.onFinalizeCallback({ x: 13 }, true)
  h.flush()
  assert.deepEqual(h.calls.seeks, [25])
  assert.equal(h.calls.pauses, 1)
  assert.equal(h.calls.plays, 1)
  assert.equal(h.state.paused, false)
})

test('iOS clamps the final seek and preserves the existing release momentum', () => {
  for (const [x, velocityX, expected] of [
    [-10, 0, 0],
    [100, 0, 100],
    [26, -500, 46.5],
  ]) {
    const h = createHarness()
    h.emit('onStart')
    h.emit('onEnd', x, { velocityX })
    assert.deepEqual(h.calls.seeks, [expected])
  }
})
