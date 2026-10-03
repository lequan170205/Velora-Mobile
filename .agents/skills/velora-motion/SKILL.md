---
name: velora-motion
description: Motion, gesture, and interaction rules for Velora Mobile (React Native + Reanimated 4 + Gesture Handler + expo-haptics + keyboard-controller). Use when adding or changing any animation, transition, gesture, haptic, sheet behavior, screen transition, press feedback, or when motion stutters, feels wrong, or needs review/audit. Enforces the should-this-animate gate, exact curves/durations/springs, UI-thread discipline, reduced motion, and a strict review bar. Deep API internals live in the react-native-best-practices skill; recipes in references/recipes.md.
---

# Velora Motion

Mobile changes three things about animation, and everything here follows from them:

1. **No hover.** Every web hover affordance must become press, position, or nothing.
2. **Two runtimes.** Worklets run on the UI thread every frame; React renders on the RN runtime. Motion that touches React per frame stutters the moment the app does anything else. The craft is keeping motion on the UI thread.
3. **The finger is on the element.** Interruptibility and velocity handoff are the baseline, not polish.

Reanimated 4 + worklets + gesture-handler + expo-haptics + keyboard-controller are installed,
and the root providers (`GestureHandlerRootView`, `KeyboardProvider`, `BottomSheetModalProvider`)
are mounted in `app/_layout.tsx`. Never re-mount them; never add a new animation dependency
(including Lottie) without explicit need — Skia is available for custom drawn effects.

## Build sequence (in order; steps 1–2 gate everything)

### 1. Should this animate at all?

| Frequency                                                               | Decision                                             |
| ----------------------------------------------------------------------- | ---------------------------------------------------- |
| 100+/day — tab switches, keyboard, scrolling, settings toggles          | **No animation.** Platform default or nothing. Stop. |
| Tens/day — press feedback, row selection, list navigation               | Near-imperceptible only: <150ms, or nothing          |
| Occasional — sheets, modals, toasts, onboarding steps                   | Standard animation                                   |
| Rare/first-time — success states, empty-state illustration, celebration | The delight budget lives here                        |

Tab switches never slide (`animation: 'none'`) — tabs are peers, not a hierarchy. If the
request fails this gate, say so and write zero code.

### 2. Name the purpose in one word

**feedback**, **spatial consistency**, **state indication**, **preventing a jarring change**,
**explanation**, or **delight** (rare tier only). Can't name it → don't build it.

### 3. Cheapest tool that works (walk down, stop at first fit)

| Need                                                   | Tool (installed in this repo)                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| State-driven change, no gesture (press, toggle, color) | Reanimated CSS transition (`transitionProperty`)                                |
| Loop / multi-stage / plays on mount                    | Reanimated CSS keyframes or `withRepeat`/`withSequence`                         |
| Element mounting/unmounting, list reflow               | Layout animations (`entering` / `exiting` / `itemLayoutAnimation`)              |
| Anything a finger touches, or derived from scroll      | `useSharedValue` + `Gesture` + `useAnimatedStyle`                               |
| In-screen bottom sheet                                 | `AnimatedActionSheet` (existing) or `@gorhom/bottom-sheet`                      |
| Sheet that is its own screen                           | `presentation: 'formSheet'` / `'modal'` on the native stack — never hand-rolled |
| Screen-to-screen                                       | Native stack options in Expo Router. Never rebuild in JS                        |
| UI tracking the keyboard                               | `react-native-keyboard-controller` (`useReanimatedKeyboardAnimation`)           |
| Paged horizontal content                               | `react-native-pager-view`                                                       |
| Celebration / drawn effects                            | Skia or composed Reanimated sequences                                           |

### 4. Properties

- Animate **`transform` + `opacity`** only. `width/height/margin/padding/flex/top/left/gap` re-run Yoga every frame for the node _and its siblings_.
- One exception: an **absolutely positioned element with no children** (tab pill, progress fill) may animate `width` — nothing re-lays-out and corner radius survives.
- **Never `scale(0)`** — start from `scale(0.9–0.97)` + `opacity: 0`.
- `transform` is an array and order matters (`[{ translateY }, { scale }]` — keep translate first).
- Never animate `BlurView` intensity or Android `elevation` — crossfade a static layer's opacity instead.
- `Extrapolation.CLAMP` on every interpolate driven by unbounded input (scroll).

### 5. Spring or timing

**A finger was involved → spring**, carrying velocity. Use the Apple-parameter form:

| Interaction                       | Config                                           |
| --------------------------------- | ------------------------------------------------ |
| Default settle, no overshoot      | `{ duration: 400, dampingRatio: 1 }`             |
| Snap back / reposition after drag | `{ duration: 400, dampingRatio: 0.8, velocity }` |
| Sheet / drawer                    | `{ duration: 300, dampingRatio: 0.8, velocity }` |
| Must not pass a hard edge         | add `overshootClamping: true`                    |

Bounce only when the gesture carried momentum. Easing otherwise:

```js
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1) // repo standard, strong ease-out
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1) // on-screen movement
const EASE_SHEET = Easing.bezier(0.32, 0.72, 0, 1) // iOS sheet curve
```

`EASE_OUT` at `bezier(0.22, 1, 0.36, 1)` is already used across the codebase — converge on it,
don't mint near-duplicates. **Never `ease-in` on entrances/UI** (it delays the moment the user
is watching); exits may finish faster (~20% shorter than entry).

| Element                          | Duration                          |
| -------------------------------- | --------------------------------- |
| Press feedback                   | 100–150ms                         |
| Toggle, chip, small state change | 150–200ms                         |
| Sheet, modal, drawer             | spring, ~300ms perceived          |
| Screen transition                | platform default — don't override |

### 6. UI-thread discipline (where RN motion dies)

- **Never `setState` from a gesture or scroll handler.** Shared value → `useAnimatedStyle`; React never re-renders.
- **Never read or write a shared value during render** (`.get()` in JSX). Touch shared values only in worklets, handlers, effects.
- **Use `.get()` / `.set()`**, not `.value` — the React-Compiler-safe form.
- **`scheduleOnRN(fn, ...args)`** (from `react-native-worklets`) to call back to JS — only in `onEnd` or a threshold `useAnimatedReaction`, never per frame. (It replaces deprecated `runOnJS`.)
- Functions called from a worklet start with `'worklet'`.
- Layout-animation builders (`FadeInDown.duration(...)`) live at module scope or in `useMemo` — never inline in render.
- Wrap `Gesture` builders in `useMemo` so a re-render doesn't reattach the recognizer mid-drag.

### 7. Press, not hover

- Feedback on **press-in**, commit on press-out.
- Repo primitive: `AppPressable` (opacity 0.82 + Android ripple + `hitSlop`/`pressRetentionOffset` 8). For a more physical feel, add `scale: 0.97` @ 120ms via a Reanimated CSS transition (recipe in `references/recipes.md`). Don't fork a third pattern per screen.
- 44pt minimum target (48dp Android); `hitSlop` expands small visuals.
- Gestures inside scrollables **declare their axis** (`activeOffsetX`/`activeOffsetY` ±10) or they steal the scroll.

### 8. Haptics (expo-haptics)

| Moment                                                 | Call                               |
| ------------------------------------------------------ | ---------------------------------- |
| Value ticks a step (picker, segmented control, detent) | `Haptics.selectionAsync()`         |
| Snap home, drag commits, sheet detent catches          | `impactAsync(Light)`               |
| Heavy/destructive lands (end call confirmed, delete)   | `impactAsync(Medium)`              |
| Operation succeeded / failed                           | `notificationAsync(Success/Error)` |

Absolute rules: **same frame as the visual** (fire at the causal moment, not when the animation
ends) · **one per user action** (never on scroll, never per frame, never on uncaused entrances) ·
**never the only feedback**. From a worklet: `scheduleOnRN(Haptics.selectionAsync)`.

### 9. Reduced motion & Dynamic Type

`useReducedMotion()` / `ReduceMotion.System` ship **with** the animation. Reduced motion =
fewer and gentler, not zero: keep opacity/color that explain state, drop translation, scale,
parallax, overshoot. Screen transitions become `animation: 'fade'`. Text scales
(`allowFontScaling` default on): never animate to a hardcoded height — measure with `onLayout`
or animate a transform.

## Setup that silently breaks motion

`GestureHandlerRootView` missing (it's mounted — don't shadow it) · gestures dead with no
error · Expo Go is not a performance environment — **judge feel on a release build on the
slowest supported device**; dev builds hide exactly the problems you're looking for.

## Never ship

| Never                                           | Instead                                              |
| ----------------------------------------------- | ---------------------------------------------------- |
| `PanResponder`                                  | `Gesture.Pan()`                                      |
| `setState` in gesture/scroll handler            | shared value + `useAnimatedStyle`                    |
| `runOnJS` (deprecated)                          | `scheduleOnRN`                                       |
| `scheduleOnRN` per frame                        | `onEnd` / threshold `useAnimatedReaction`            |
| Shared value read/written during render         | `.get()`/`.set()` in worklets & effects              |
| Core `Animated` for anything a finger touches   | Reanimated                                           |
| Animating `height/width/margin/flex/top`        | `transform` + `opacity` (absolute childless exempt)  |
| Animating `BlurView` intensity / `elevation`    | crossfade a static layer                             |
| `entering` on virtualized list rows (FlashList) | animate the container once, or `itemLayoutAnimation` |
| Screen transition rebuilt in JS                 | native stack `animation`                             |
| Sliding between tabs                            | `animation: 'none'`                                  |
| `Easing.in(...)` on entrances                   | `EASE_OUT` above                                     |
| `scale(0)` entrance                             | `scale(0.95)` + `opacity: 0`                         |
| Distance-only dismissal threshold               | velocity **or** distance — a flick is enough         |
| Hard stop at a drag boundary                    | rubber-band resistance                               |
| Haptic per frame / as only feedback             | one per commit, paired with a visual                 |

## Recipes & review

- Ready-to-build implementations for Velora's common cases: [references/recipes.md](references/recipes.md). Start from the recipe, not a blank file.
- Reviewing or auditing motion (own diff or a whole area): [references/review.md](references/review.md) — ten non-negotiable standards, escalation triggers, remedial hierarchy. Default to flagging; approval is earned.

## Output

Write the code. Then in a few lines: the **gate result** (frequency tier + named purpose,
including what you rejected), the **ingredients** (tool, properties, curve/spring, thread),
and **what to feel-check on device** (flick it, interrupt it mid-flight, reverse it, slowest
Android available). The code is the deliverable.
