# Velora Motion Recipes

Starting points for the cases that come up most in this repo. Adapt, don't paste blindly.
Shared assumptions: Reanimated 4 + worklets + gesture-handler + expo-haptics installed;
root providers mounted in `app/_layout.tsx`.

```js
import { useMemo } from 'react'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  useAnimatedReaction,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
  Easing,
  FadeInDown,
  FadeOutDown,
  LinearTransition,
} from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { scheduleOnRN } from 'react-native-worklets'
import * as Haptics from 'expo-haptics'

const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1)
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1)
```

Two worklets everything drag-related needs — momentum projection (where a flick was going, so
a fast short swipe commits) and rubber-banding (a boundary resists instead of stopping dead):

```js
function project(velocity, decelerationRate = 0.998) {
  'worklet'
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate)
}
function rubberband(overshoot, dimension, constant = 0.55) {
  'worklet'
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))
}
```

## Press feedback

Repo default is `AppPressable` (opacity 0.82 + ripple, `hitSlop` 8) — that already passes the
gate for 100+/day controls. For hero actions and cards where a more physical feel is earned
(rare tier only), a Reanimated CSS transition is the whole implementation — no gesture, no
shared value, and `setState` is fine because it fires twice per press, not per frame:

```jsx
const [pressed, setPressed] = useState(false)
// <Pressable onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} hitSlop={12}>
;<Animated.View
  style={[
    styles.card,
    pressed && { transform: [{ scale: 0.97 }] },
    {
      transitionProperty: 'transform',
      transitionDuration: '120ms',
      transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
    },
  ]}
/>
```

## Drag-to-dismiss surface (sheets, overlays, media viewer panels)

First check: if the sheet is its own destination, use `presentation: 'formSheet'` and get the
platform sheet for free. Build the gesture only when the surface must live inside an existing
screen (call sheets, in-chat previews) and the existing `AnimatedActionSheet` doesn't fit.

```jsx
const translateY = useSharedValue(0)
const context = useSharedValue(0)

const pan = useMemo(
  () =>
    Gesture.Pan()
      .activeOffsetY([-10, 10]) // declare the axis or vertical scroll wins
      .onStart(() => {
        context.set(translateY.get())
      }) // continue from where the eye last saw it
      .onUpdate((e) => {
        const next = context.get() + e.translationY
        translateY.set(next >= 0 ? next : rubberband(next, HEIGHT))
      })
      .onEnd((e) => {
        const projected = translateY.get() + project(e.velocityY)
        if (projected > HEIGHT * 0.4) {
          // velocity decides — a flick is enough
          translateY.set(
            withSpring(
              HEIGHT,
              { duration: 300, dampingRatio: 1, velocity: e.velocityY, overshootClamping: true },
              (finished) => {
                if (finished) scheduleOnRN(onClose)
              },
            ),
          )
        } else {
          translateY.set(withSpring(0, { duration: 300, dampingRatio: 0.8, velocity: e.velocityY }))
          scheduleOnRN(Haptics.impactAsync, Haptics.ImpactFeedbackStyle.Light) // snapped home
        }
      }),
  [onClose],
)

const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.get() }] }))
const backdropStyle = useAnimatedStyle(() => ({
  opacity: interpolate(translateY.get(), [0, HEIGHT], [1, 0], Extrapolation.CLAMP),
}))
```

The velocity handoff to the spring is the detail that separates "fluid" from "fine".

## Collapsing header on scroll (conversation/profile headers)

```jsx
const scrollY = useSharedValue(0)
const onScroll = useAnimatedScrollHandler((e) => {
  scrollY.set(e.contentOffset.y)
})
const titleStyle = useAnimatedStyle(() => ({
  opacity: interpolate(scrollY.get(), [0, 60], [1, 0], Extrapolation.CLAMP),
  transform: [{ translateY: interpolate(scrollY.get(), [0, 60], [0, -12], Extrapolation.CLAMP) }],
}))
// <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16}>
```

Never collapse by animating the header's `height` — that's a layout pass on every scroll frame,
competing with the scroll itself. Fixed container height, translate the content, clip.

## List entrances

```jsx
const ROW_ENTER = FadeInDown.duration(250) // module scope — builders rebuilt in render cost every re-render
function Row({ item, index }) {
  const entering = useMemo(() => ROW_ENTER.delay(Math.min(index, 6) * 40), [index])
  return <Animated.View entering={entering}>{/* ... */}</Animated.View>
}
```

Stagger 30–80ms. **Never put `entering` on rows inside FlashList/FlatList** — rows are
recycled and the animation re-fires on every scroll cycle. Animate the container once, or use
`itemLayoutAnimation` for reflow:

```jsx
const ROW_CLOSE = LinearTransition.duration(200) // module scope
;<Animated.FlatList data={items} itemLayoutAnimation={ROW_CLOSE} />
```

## Keyboard-synced footer (chat composer)

`KeyboardProvider` is mounted at the root. Drive UI from the keyboard's real position, frame
by frame on the UI thread — never `Keyboard.addListener` + a timed animation (it lags or leads
the system curve visibly):

```jsx
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
const { height } = useReanimatedKeyboardAnimation() // 0 → -keyboardHeight
const footerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: height.get() }] }))
```

## Tab / segmented indicator

Measure once with `onLayout`, then animate transforms. This is the sanctioned `width`
animation — the pill is absolutely positioned with no children, so nothing re-lays-out and the
corner radius survives (`scaleX` would smear it). `ease-in-out` because the pill moves across
the screen; fire `selectionAsync()` on the press, not when the pill lands:

```jsx
const x = useSharedValue(0)
const w = useSharedValue(0)
useEffect(() => {
  const l = layouts[active]
  if (!l) return
  x.set(withTiming(l.x, { duration: 250, easing: EASE_IN_OUT }))
  w.set(withTiming(l.width, { duration: 250, easing: EASE_IN_OUT }))
}, [active, layouts])
const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }], width: w.get() }))
```

## Screen transitions (Expo Router — never hand-rolled)

```jsx
<Stack.Screen name="settings" options={{ animation: 'slide_from_right', animationMatchesGesture: true }} />
<Stack.Screen name="compose" options={{ presentation: 'modal' }} />
<Stack.Screen name="filter" options={{ presentation: 'formSheet', sheetAllowedDetents: 'fitToContents', sheetGrabberVisible: true }} />
```

| Navigation                                 | Option                                             |
| ------------------------------------------ | -------------------------------------------------- |
| Deeper into a hierarchy                    | `animation: 'default'` (platform push, unmodified) |
| Self-contained task to abandon             | `presentation: 'modal'`                            |
| Short interruption (picker, filter, share) | `presentation: 'formSheet'`                        |
| Between tabs                               | `animation: 'none'`                                |
| Reduced motion                             | `animation: 'fade'`                                |

`animationMatchesGesture: true` whenever a custom `animation` is set, or the iOS back swipe
disagrees with the forward transition. Android caps form-sheet detents at three and shows no
grabber — don't rely on the grabber as the only drag affordance.

## Fire once at a threshold (pull-to-refresh arming, detent catch)

```jsx
const armed = useSharedValue(false)
useAnimatedReaction(
  () => pullDistance.get() > REFRESH_THRESHOLD,
  (isArmed, wasArmed) => {
    if (isArmed !== wasArmed) {
      armed.set(isArmed)
      scheduleOnRN(Haptics.impactAsync, Haptics.ImpactFeedbackStyle.Light)
    }
  },
)
```

The comparison runs on the UI thread every frame; the JS call happens twice per pull.

## Toast

```jsx
const TOAST_ENTER = FadeInDown.duration(300).easing(EASE_OUT)
const TOAST_EXIT = FadeOutDown.duration(250).easing(EASE_OUT) // exits ~20% faster
// <Animated.View entering={TOAST_ENTER} exiting={TOAST_EXIT}
//   style={{ position: 'absolute', bottom: insets.bottom + 16, left: 16, right: 16 }} />
```

It exits the way it entered; safe-area insets always (a toast at `bottom: 16` sits under the
home indicator). 300ms cap holds — a toast is uninvited, so if anything it should be quicker
than motion the user asked for.
