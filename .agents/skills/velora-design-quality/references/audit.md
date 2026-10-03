# Velora UI Audit (code-level)

Systematic technical quality checks on Velora screens. Audit from source (TypeScript /
NativeWind / Reanimated); document findings, don't fix them. Score each dimension 0–4,
then produce the report below. Judge on real evidence — never report an issue you have not
confirmed at its `file:line`.

## 1. Accessibility (VoiceOver / TalkBack)

Check for:

- Interactive elements missing `accessibilityLabel`, role, or state announcements (icon-only buttons first).
- Reading/focus order that disagrees with visual order; unreachable controls; focus lost after navigation or modal close.
- Fixed font sizes or `maxFontSizeMultiplier` overrides that defeat Dynamic Type; layouts that clip or overlap at 200% text size.
- Touch targets below 44pt (iOS) / 48dp (Android) — including small icons without `hitSlop`.
- Text contrast failing 4.5:1 in either visual world (light canvas and dark call surfaces).
- Decorative images not hidden from the accessibility tree; meaningful images without labels.

Score: 0 = screen reader unusable · 1 = major gaps · 2 = partial (labels exist, order or scaling breaks) · 3 = good, minor gaps · 4 = labeled, ordered, scales cleanly.

## 2. Performance

Check for:

- Long lists (`FlatList` where `FlashList` belongs; missing keys; inline item renderers recreating per render).
- Synchronous work in scroll or gesture paths (see `velora-motion`); re-renders per frame (`setState` in scroll handlers).
- Full-size images decoded for thumbnails; missing `expo-image` recycling/caching on avatars and media.
- Unmemoized heavy rows (message bubbles, reel overlays) re-rendering on unrelated state changes.
- Heavy work on mount blocking first frame (hydrate-then-render patterns).

Score: 0 = janky everywhere · 1 = major problems · 2 = partial · 3 = good · 4 = fast launch, smooth scroll under load.

## 3. Appearance & Theming

Check for:

- Hardcoded hex/rgba in screens instead of `theme.ts` / NativeWind token classes.
- Values that exist as tokens written by hand (e.g. `fontSize: 15` instead of `text-base`).
- The two visual worlds bleeding into each other (light tokens on call surfaces, `call.*` grays on light screens) without a token-level decision.
- Inconsistent radius/spacing values that alias existing tokens (`borderRadius: 12` vs `rounded-md`).
- react-native-paper defaults (colors, ripples, type) escaping `paperTheme.ts`.

Score: 0 = hardcoded everywhere · 1 = minimal tokens · 2 = tokens exist, inconsistently used · 3 = good, minor strays · 4 = semantic throughout both worlds.

## 4. Platform Conformance (start here — pass/fail verdict)

Check for:

- Broken system gestures: edge-swipe back disabled or hijacked; swipe-from-edge fighting a `Gesture.Pan` without `activeOffset`.
- Inset violations: content under notch / Dynamic Island / home indicator / keyboard; toast or CTA rows missing safe-area padding.
- Off-platform controls: HTML-shaped buttons, web-style toggles, hover-dependent affordances, underline links where buttons belong.
- Icon drift: mixed families or stroke weights; emoji standing in for icons.
- Navigation shape: overloaded tab bar (5 tabs max), custom transitions where the native stack option exists, sheets that should be `presentation: 'modal'` / `'formSheet'` hand-rolled in JS.

Score: 0 = web port · 1 = heavy violations · 2 = some noticeable · 3 = mostly conformant · 4 = a fluent user trusts every screen.

## 5. Adaptivity

Check for:

- Fixed widths/heights that break on small phones (320pt) or large (Pro Max); `Dimensions.get` values captured once at module scope.
- Landscape: clipping, ignored, or locked without reason.
- Keyboard/IME: inputs hidden behind the keyboard; composer not tracking it.
- Long-form text going edge-to-edge on tablets without measure limits.

Score: 0 = one screen size · 1 = major breakage · 2 = partial · 3 = good, minor edge cases · 4 = adapts across sizes and orientations.

## Report format

1. **Platform Conformance verdict** first: does this read as a native app? Be blunt.
2. **Health score table**: the five dimensions with a one-line key finding each, total `/20`.
   Bands: 18–20 excellent · 14–17 good · 10–13 acceptable, significant work · 6–9 poor · 0–5 critical.
3. **Findings by severity** — tag every issue P0 (blocks task completion) / P1 (significant difficulty or platform violation; fix before release) / P2 (annoyance, workaround exists) / P3 (polish). Each: `file:line`, category, user impact, concrete recommendation. Too many P3s is noise — cap them.
4. **Systemic patterns**: recurring causes, not one-off mistakes ("hardcoded colors on 12 screens", "hitSlop missing across the tab bar").
5. **Positive findings**: what is working and should be replicated.
6. **Recommended next steps** in priority order; point motion findings at the `velora-motion` skill and UX findings at `velora-ux-patterns`.

Rules: never report without explaining user impact; never recommend generically; verify before reporting; celebrate what works.
