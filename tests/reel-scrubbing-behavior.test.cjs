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

// Execute real callbacks with separate UI-to-RN callbacks and deferred RN-to-UI writes.
const createHarness = (platform = 'ios', { paused = false, duration = 100, width = 100 } = {}) => {
  const calls = { seeks: [], paused: [], haptics: 0, plays: 0, pauses: 0 }
  const state = { paused, scrubbing: false, pendingRatio: null, position: 0 }
  const pending = []
  const pendingUI = []
  let runtime = 'rn'
  const onUI = (callback) => {
    runtime = 'ui'
    try {
      return callback()
    } finally {
      runtime = 'rn'
    }
  }
  const shared = (initial) => {
    let value = initial
    return {
      get value() {
        return value
      },
      set value(next) {
        if (runtime === 'ui') value = next
        else pendingUI.push(() => (value = next))
      },
      get() {
        return this.value
      },
      set(next) {
        this.value = next
      },
    }
  }
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
      gesture[`${method}Callback`] = (...args) => onUI(() => callback(...args))
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
    scrubberWidth: width,
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
    lastHandledScrubGestureIdRef: { current: 0 },
    pendingSeekTarget: shared(-1),
    scrubUpdateSample: shared(0),
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
  const flushRN = () => {
    while (pending.length) pending.shift()()
  }
  const flushUI = () => {
    while (pendingUI.length) onUI(pendingUI.shift())
  }
  const flush = () => {
    flushRN()
    flushUI()
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
    pendingUI,
    gesture,
    flush,
    flushRN,
    flushUI,
    emit,
    appState: (next) => {
      context.AppState.currentState = next
      for (const listener of listeners) listener(next)
    },
    cleanup: () => cleanups.forEach((cleanup) => cleanup?.()),
    listeners,
  }
}

test('Android commits only the release target when shared writes and finalization overlap', () => {
  const h = createHarness('android')
  h.emit('onStart', 13)
  h.gesture.onEndCallback({ x: 39, velocityX: 0 }, true)
  h.gesture.onFinalizeCallback({ x: 39 }, true)
  h.flushRN()
  assert.deepEqual(h.calls.seeks, [75])
})

for (const platform of ['android', 'ios']) {
  test(`${platform} previews the drag without native seeks and commits once on release`, () => {
    const h = createHarness(platform)
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

  test(`${platform} preserves an intentional pause and ignores duplicate release callbacks`, () => {
    const h = createHarness(platform, { paused: true })
    h.emit('onStart')
    h.gesture.onEndCallback({ x: 26, velocityX: 0 }, true)
    h.gesture.onEndCallback({ x: 39, velocityX: 0 }, true)
    h.gesture.onFinalizeCallback({ x: 39 }, true)
    h.flushRN()
    assert.deepEqual(h.calls.seeks, [50])
    assert.deepEqual(h.calls.paused, [true])
    assert.equal(h.state.paused, true)
    assert.equal(h.calls.plays, 0)
  })

  test(`${platform} finalization cleans up cancellation without committing a seek`, () => {
    for (const paused of [false, true]) {
      const h = createHarness(platform, { paused })
      h.emit('onStart')
      h.emit('onEnd', 26, { success: false })
      assert.equal(h.state.scrubbing, true)
      h.emit('onFinalize', 26, { success: false })
      h.emit('onFinalize', 26, { success: false })
      h.emit('onEnd')
      assert.deepEqual(h.calls.seeks, [])
      assert.equal(h.state.paused, paused)
      assert.equal(h.state.scrubbing, false)
      assert.equal(h.state.pendingRatio, null)
      assert.equal(h.calls.plays, paused ? 0 : 1)
      assert.equal(h.context.timelinePreviewRatio.value, 0.8)
    }
  })

  test(`${platform} ignores finalization before a drag starts and invalid timelines`, () => {
    const h = createHarness(platform)
    h.emit('onEnd')
    h.emit('onFinalize', 26, { success: false })
    assert.deepEqual(h.calls.seeks, [])
    assert.deepEqual(h.calls.paused, [])
    for (const options of [{ duration: 0 }, { width: 0 }]) {
      const invalid = createHarness(platform, options)
      invalid.emit('onStart')
      invalid.emit('onEnd')
      invalid.emit('onFinalize')
      assert.deepEqual(invalid.calls.seeks, [])
      assert.deepEqual(invalid.calls.paused, [])
    }
  })

  test(`${platform} fences queued updates and releases after source/account change, blur, or unmount`, () => {
    for (const invalidate of [
      (h) => {
        h.context.playerIdentityRef.current.playerGeneration += 1
      },
      (h) => {
        h.context.isActiveRef.current = false
      },
      (h) => h.cleanup(),
    ]) {
      const h = createHarness(platform)
      h.emit('onStart')
      for (let i = 0; i < 6; i += 1) h.gesture.onUpdateCallback({ x: 13 })
      h.gesture.onEndCallback({ x: 26, velocityX: 0 }, true)
      h.gesture.onFinalizeCallback({ x: 26 }, true)
      invalidate(h)
      h.flush()
      assert.deepEqual(h.calls.seeks, [])
      assert.deepEqual(h.calls.paused, [true])
      assert.equal(h.calls.plays, 0)
    }
  })

  test(`${platform} rejects a queued start after source/account change, blur, background, or unmount`, () => {
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
      (h) => h.cleanup(),
    ]) {
      const h = createHarness(platform)
      h.gesture.onStartCallback({ x: 26 })
      h.gesture.onEndCallback({ x: 26, velocityX: 0 }, true)
      h.gesture.onFinalizeCallback({ x: 26 }, true)
      invalidate(h)
      h.flush()
      assert.deepEqual(h.calls.seeks, [])
      assert.deepEqual(h.calls.paused, [])
    }
  })

  test(`${platform} backgrounding cancels scrubbing and rejects a late foreground release`, () => {
    for (const paused of [false, true]) {
      const h = createHarness(platform, { paused })
      h.emit('onStart')
      h.gesture.onEndCallback({ x: 39, velocityX: 0 }, true)
      h.appState('inactive')
      assert.equal(h.state.paused, paused)
      assert.equal(h.state.scrubbing, false)
      assert.equal(h.state.pendingRatio, null)
      const pauseCalls = [...h.calls.paused]
      h.appState('active')
      h.emit('onEnd')
      h.emit('onFinalize')
      assert.deepEqual(h.calls.seeks, [])
      assert.deepEqual(h.calls.paused, pauseCalls)
      assert.equal(h.calls.plays, 0)
    }
  })

  test(`${platform} rejects a queued start that crosses a background/foreground cycle`, () => {
    const h = createHarness(platform)
    h.gesture.onStartCallback({ x: 13 })
    h.appState('inactive')
    h.appState('active')
    h.emit('onEnd', 39)
    assert.deepEqual(h.calls.seeks, [])
    assert.deepEqual(h.calls.paused, [])
    assert.equal(h.calls.plays, 0)
    h.emit('onStart')
    h.emit('onEnd')
    assert.deepEqual(h.calls.seeks, [50])
    assert.equal(h.calls.plays, 1)
  })

  test(`${platform} a newer drag ignores an older queued release and keeps playback intent`, () => {
    const h = createHarness(platform)
    h.emit('onStart')
    h.gesture.onEndCallback({ x: 39, velocityX: 0 }, true)
    h.gesture.onFinalizeCallback({ x: 39 }, true)
    h.emit('onStart', 13)
    assert.deepEqual(h.calls.seeks, [])
    h.emit('onEnd', 13)
    assert.deepEqual(h.calls.seeks, [25])
    assert.equal(h.state.paused, false)
    assert.equal(h.calls.plays, 1)
  })

  test(`${platform} a fast drag resumes even when React has not rendered the pause`, () => {
    const h = createHarness(platform)
    h.gesture.onStartCallback({ x: 40 })
    h.gesture.onEndCallback({ x: 13, velocityX: 0 }, true)
    h.gesture.onFinalizeCallback({ x: 13 }, true)
    h.flushRN()
    assert.deepEqual(h.calls.seeks, [25])
    assert.equal(h.calls.pauses, 1)
    assert.equal(h.calls.plays, 1)
    assert.equal(h.state.paused, false)
  })

  test(`${platform} clamps the final seek and preserves the existing release momentum`, () => {
    for (const [x, velocityX, expected] of [
      [-10, 0, 0],
      [100, 0, 100],
      [26, -500, 46.5],
      [26, 500, 53.5],
      [26, 260, 50],
    ]) {
      const h = createHarness(platform)
      h.emit('onStart')
      h.emit('onEnd', x, { velocityX })
      assert.deepEqual(h.calls.seeks, [expected])
    }
  })

  test(`${platform} repeated fast drags preserve the latest pause intent before React renders`, () => {
    for (const paused of [false, true]) {
      const h = createHarness(platform, { paused })
      for (const x of [13, 39, 26]) {
        h.gesture.onStartCallback({ x: 40 })
        h.gesture.onEndCallback({ x, velocityX: 0 }, true)
        h.gesture.onFinalizeCallback({ x }, true)
        h.flushRN()
      }
      assert.deepEqual(h.calls.seeks, [25, 75, 50])
      assert.equal(h.calls.pauses, 3)
      assert.equal(h.calls.plays, paused ? 0 : 3)
      assert.equal(h.state.paused, paused)
      h.flushUI()
      assert.equal(h.context.timelinePreviewRatio.value, 0.5)
    }
  })

  test(`${platform} ignores all older callbacks when two gestures queue before RN catches up`, () => {
    const h = createHarness(platform)
    for (const x of [13, 39]) {
      h.gesture.onStartCallback({ x })
      for (let i = 0; i < 6; i += 1) h.gesture.onUpdateCallback({ x })
      h.gesture.onEndCallback({ x, velocityX: 0 }, true)
      h.gesture.onFinalizeCallback({ x }, true)
    }
    h.flushRN()
    assert.deepEqual(h.calls.seeks, [75])
    assert.equal(h.calls.pauses, 1)
    assert.equal(h.calls.plays, 1)
  })
}
