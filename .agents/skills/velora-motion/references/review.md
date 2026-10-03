# Velora Motion Review & Audit

Review motion code against a high craft bar. Default to flagging; approval is earned. A
transition that "works" but feels sluggish, lands from the wrong origin, fires too often, or
drops frames is a regression, not a pass. When unsure whether motion feels right, the
strongest move is often to recommend deleting it — and when feel can't be judged from code
(a crossfade, a spring's bounce), say so and put a feel-check step in the findings instead
of guessing.

## The ten non-negotiable standards

1. **Justified motion.** Every animation answers "why does this animate?" — spatial consistency, state indication, feedback, explanation, preventing a jarring change. "It looks cool" on a frequently-seen element is a block.
2. **Frequency-appropriate.** 100+/day actions get no animation. Tens/day: near-imperceptible. Occasional: standard. Rare/first-time: delight allowed.
3. **Responsive easing.** Entrances/exits use ease-out or the repo's strong curve (`bezier(0.22, 1, 0.36, 1)`). `ease-in` on UI is a block.
4. **Sub-300ms UI.** Anything slower on a UI element needs a stated reason. Press 100–150ms; small state changes 150–200ms; sheets are springs ~300ms perceived.
5. **Origin & physicality.** Overlays scale from their trigger, not center. Never `scale(0)` — `scale(0.9–0.97)` + opacity. Full-screen modals are exempt (centered is correct).
6. **Interruptible.** Rapidly-triggered or gesture-driven motion (toasts, toggles, drags, sheets) retargets from current state — springs carry velocity; keyframes that restart from zero don't.
7. **GPU/UI-thread only.** `transform` + `opacity`; never layout properties, never `setState` per frame, never `scheduleOnRN` per frame.
8. **Accessibility.** `useReducedMotion` honored (gentler, not zero); Dynamic Type doesn't break measured heights.
9. **Asymmetric enter/exit.** Deliberate phases (press, hold, destructive confirm) animate slower; system responses snap; exits ~20% faster than entries. Symmetric timing on press-and-release is a finding.
10. **Cohesion.** Motion matches the surface's register (calm product canvas vs expressive reels) and the app's existing curves. One bouncy island in a calm app is a finding.

## Escalation triggers (flag on sight, hard)

- `transitionProperty: 'all'` or animating unlisted property sets
- `scale(0)` or pure-fade entrances with no initial transform
- `ease-in` on any entrance/UI interaction; weak built-in easings on deliberate motion
- Animation on a tab switch, keyboard action, or other 100+/day action
- UI duration > 300ms with no stated reason
- Overlays anchored to a trigger scaling from center
- Keyframes/restart-from-zero on toasts, toggles, or rapidly-triggered UI
- Animating `width/height/margin/padding/top/left/flex` (absolute childless elements exempt)
- `setState`, `.value` writes, or shared-value reads inside render or scroll/gesture handlers
- `runOnJS` (deprecated); `scheduleOnRN` called per frame
- `entering` animations on FlashList/FlatList rows
- Missing `activeOffsetX/Y` on a pan gesture inside a scrollable
- Missing reduced-motion handling on any movement
- Everything-at-once group entrance where a 30–80ms stagger belongs

## Remedial preference hierarchy

Prefer earlier moves over later ones:

1. **Delete** the animation (high-frequency / no purpose).
2. **Reduce** — shorter, smaller, fewer properties.
3. **Fix the easing** — `ease-in` → repo ease-out curve.
4. **Fix origin/physicality** — trigger-anchored origin; `scale(0)` → `scale(0.95)` + opacity.
5. **Make it interruptible** — springs/retargeting transitions for gesture-driven motion.
6. **Move to the UI thread / GPU** — layout props → transform+opacity; `.get()`/`.set()`; builders at module scope.
7. **Asymmetric timing** — slow the deliberate phase, snap the response.
8. **Polish** — stagger, velocity handoff, rubber-band boundaries, threshold haptics.
9. **Accessibility & cohesion** — reduced motion, register-matched curves.

## Output format (per review)

**Part 1 — findings table**, one row per issue, `Before | After | Why`, citing `file:line`,
with exact replacement values (curve, duration, spring config) — never approximations.

**Part 2 — verdict**, grouped by tier (omit empty): feel-breaking regressions → missed
simplifications → performance → interruptibility & timing → origin/physicality/cohesion →
accessibility. Close with an explicit **Block** (any feel-breaking regression, high-frequency
animation, `scale(0)`/`ease-in` on UI, non-GPU animation with an easy fix) or **Approve**
(none of those; durations/easing in bounds; interruptibility and reduced motion handled).

## Whole-area audit (when asked to audit or "improve the animations")

1. **Recon** — map where motion lives: grep `withSpring|withTiming|Easing|useSharedValue|Gesture\.|entering=|exiting=|Haptics|transitionProperty` across `src/` and `app/`. Note the existing conventions (repo ease-out curve, AnimatedActionSheet, bottom-sheet) — plans extend those, never invent parallel ones. Build a frequency map (what's hit constantly vs rarely); it drives severity.
2. **Audit** against the ten standards above.
3. **Vet** — re-read the cited code for every finding; reject by-design, mis-attributed, or duplicated items (e.g. centered full-screen modal, platform default transitions).
4. **Prioritize** by leverage (impact ÷ effort) in one table: `# | Severity (HIGH/MEDIUM/LOW) | Standard | file:line | Finding | Fix`. HIGH = feel-breaking (wrong easing, animation on high-frequency actions, dropped frames, `scale(0)`); MEDIUM = noticeably off (wrong origin, non-interruptible, missing reduced motion); LOW = polish (stagger, token consolidation). List 2–4 **missed opportunities** (state changes that teleport, rare delight moments) separately — additive, not corrective.
5. **Stop and present**; implement only what's selected. "The motion here is already right" is a valid audit result.
