---
name: velora-design-quality
description: Build, redesign, restyle, polish, or audit Velora Mobile screens and components at production design quality. Use when creating or changing any UI under app/ or src/components/ that affects how a screen looks, when the user asks to improve/polish/redesign a screen, when adding new screens or visual surfaces, or when auditing UI quality (hierarchy, spacing, typography, color, states, platform conformance). For aesthetic direction and anti-generic review load velora-visual-taste; for UX flows, forms, and states load velora-ux-patterns; for animation and gestures load velora-motion.
---

# Velora Design Quality

Operate as a design director shipping product UI, not marketing pages. Velora is a
communication app: chat, calls, reels, friends, profile. Every surface is **Operate mode**
(the visitor completes a task) or **Experience mode** (reels, call, media viewer). Scannability,
consistency, native expectations, and the real usage scene outrank self-expression. Brand lives
in precise details, not decoration.

## Source of truth (read before any UI edit)

The design language is committed code. Read it; do not invent parallel systems:

- `src/constants/theme.ts` — semantic color tokens (bg, brand, text, status, call, surface, bubble, border), spacing, radius, typography scales.
- `tailwind.config.js` + `src/lib/cn.ts` — the same tokens as NativeWind classes (`bg-bg-primary`, `text-secondary`, `rounded-lg`, `font-heading`, size scale `xs2…hero`). Prefer classes over inline styles; inline only for truly dynamic values.
- Fonts: **Inter** (body) + **Space Grotesk** (display/heading), loaded via `@expo-google-fonts`. Two families, no more. (`theme.ts` still lists a mono face that is not installed — do not use it.)
- Primitives: `src/components/ui/` (Button, Input, Typography), `src/components/base/` (AppPressable, AppText, AppTextInput), `src/components/common/` (AnimatedActionSheet, SafeTouchableOpacity).
- Providers already mounted in `app/_layout.tsx`: GestureHandlerRootView → SafeAreaProvider → PaperProvider → KeyboardProvider → BottomSheetModalProvider. Never re-mount them.

Rules that follow from this:

- **No new hardcoded hex, sizes, or radii.** Extend `theme.ts` + `tailwind.config.js` together (they must stay in sync) when a genuinely new semantic value is needed.
- **Typography goes through `Typography` variants** (display/h1/h2/body/bodyMedium/button/caption). Do not hand-roll font-size/line-height pairs in screens.
- **react-native-paper is legacy surface area** (Button wraps it). Use it only where it already exists; build new UI with the token system.

## Refinement preserves; redesign replaces

- **Refinement** keeps the incumbent identity, layout, copy, and everything outside the requested scope. Polish what is there; do not reskin it.
- **Redesign** keeps product truth (content, function, routes, behavior) but treats the old look as evidence. Choose the new direction deliberately, then commit — never split the difference into a light polish of a discarded design.
- If unsure which mode the user wants, ask once before editing. Never silently replace factual copy, route structure, or navigation labels.

## Two intentional visual worlds

Velora deliberately runs two palettes; this is design, not drift:

1. **Light product canvas** — white/neutral surfaces, near-black text, single orange accent (`#FF6B2C`). Chat inbox, auth, friends, search, profile, settings.
2. **Dark media surfaces** — the `call.*` token family (near-black `#05090C` base, elevated grays, high-legibility white text). Calls, media viewers, reel overlays.

Match the world to the surface's use scene (ambient light, glanceability), never to a category habit. Do not introduce a third world ad hoc; a new dark surface must reuse `call.*`-style tokens added to `theme.ts` first.

## Process

1. **Read the surface's job.** What is the user trying to accomplish here, what comes before and after, what is the one thing they should notice first? Write the answer in one line before touching code.
2. **Direction before pixels.** For anything beyond a small fix, state the plan: layout structure (an ASCII wireframe beats prose when comparing options), token usage, states needed. Confirm it reads as a deliberate Velora screen, not a generic template (see the `velora-visual-taste` skill for the tells).
3. **Build completely.** Real content (real usernames, message drafts, durations — organic, not lorem ipsum or "John Doe"), all states (default, pressed, disabled, loading, empty, error), working controls. No placeholder-everywhere deliveries.
4. **Verify in bounded passes, not a loop.** Build fully, then inspect once with a batched round (screenshots or on-device review covering the changed screens plus both visual worlds if touched), fix everything it shows in one batch, confirm with at most one more round, and stop. Open-ended self-polish burns money and makes things worse.

## Craft floor (verify on the built result, not the intention)

Each item is a check on the shipped screen:

- **Contrast:** body and placeholder text ≥ 4.5:1, large text ≥ 3:1. On colored surfaces (orange buttons, dark call surfaces) tint secondary text from that surface's hue or its foreground — never raw gray.
- **Spacing:** related elements tight, groups generously separated, more space above a heading than below it. Use the spacing scale (`spacing.xs…xxxl` / Tailwind spacing), never arbitrary values; rhythm is 4/8-based.
- **Type:** obvious scale and weight steps; hierarchy from size, weight, and color — not everything bold. Line lengths in message bubbles and cards stay readable; no orphaned single-word lines in buttons or headings.
- **Elevation declared once:** a surface is separated by a border **or** a soft shadow, never both stacked. Shadows are soft and tinted toward the surface hue; a zero-offset colored glow is decoration. Card radii come from the radius tokens; full pills are for small controls, badges, and avatars only.
- **Imagery & icons:** avatars are photos → initials → icon, in that order of preference; icons from one family (`@expo/vector-icons` / `expo-symbols`) with consistent stroke and size per hierarchy level; never emoji as structural icons; never mixed filled/outline at the same level.
- **States:** every interactive element has pressed (AppPressable gives opacity 0.82 + Android ripple by default), disabled (visually quiet, non-interactive), loading where async, empty with guidance + one CTA, error naming the problem and the recovery.
- **Native surfaces:** respect safe areas on every fixed bar and CTA row; keyboard must never cover the focused input (KeyboardProvider is mounted — use `react-native-keyboard-controller` APIs); system edge-swipe back stays intact; Dynamic Type (`allowFontScaling`) must not clip or overlap layouts.
- **Copy:** the product's own voice. Controls name their action ("Save changes", not "Submit"); the same action keeps the same word through its whole flow; errors state what happened and what to do next. No exclamation marks, no marketing voice inside product UI.
- **Coverage:** everything the task asked for is present and findable within seconds.

## Audit workflow

When asked to audit, review, or score UI quality (not a single change), load
[references/audit.md](references/audit.md) and follow its five-dimension scoring
(Accessibility, Performance, Appearance & Theming, Platform Conformance, Adaptivity) with
P0–P3 findings. Report findings with `file:line` evidence; do not fix while auditing unless asked.

## Restraint

Spend the boldness budget in one place per screen. Let one element be the memorable thing
(a composed empty state, a reel overlay treatment, a call-surface detail) and keep everything
around it quiet and disciplined. Before shipping, take one accessory off (Chanel): the last
gradient, the extra badge, the second accent usage usually goes.
