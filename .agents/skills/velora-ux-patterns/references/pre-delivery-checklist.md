# Velora Pre-Delivery Checklist (canonical)

Run before delivering any new or changed screen. The only checklist — do not invent
per-task variants. Check honestly; an unticked box means the screen is not done.

## Process

- [ ] The screen's job was stated in one line before building (what the user accomplishes, what they should notice first).
- [ ] Verified on a small phone (320–375pt width) and a large one (Pro Max), portrait; landscape where the screen supports it.
- [ ] Verified with Dynamic Type at large sizes — no clipping, no overlap, no truncated controls.
- [ ] Verified with Reduce Motion enabled (per `velora-motion`: gentler, not zero).
- [ ] Both visual worlds checked where touched (light canvas tokens, `call.*` dark surfaces) — contrast never assumed from the other world.
- [ ] Reviewed as rendered (screenshot or on-device), not only as code.

## Visual quality

- [ ] No emoji used as structural icons; icons from one family, consistent stroke and size per level.
- [ ] Semantic tokens only — no new hardcoded hex, font sizes, or radii (tokens extended in `theme.ts` + `tailwind.config.js` if genuinely needed).
- [ ] Pressed states don't shift layout bounds (opacity/ripple/scale, never margin/size changes).
- [ ] One accent (brand orange); red only destructive/end-call/error; status colors only presence/success.
- [ ] Elevation declared once per surface (border or shadow); radii from the token scale; pills only for small controls.

## Interaction

- [ ] Every tappable element gives pressed feedback (AppPressable default or deliberate replacement) within ~120ms.
- [ ] Touch targets ≥44pt (48dp Android); `hitSlop` expands smaller visuals without growing them.
- [ ] One primary CTA per screen; no two CTAs with the same intent; primary actions in the thumb zone.
- [ ] Every async action shows loading where it was triggered and an inline failure with recovery.
- [ ] Disabled states are visually quiet and non-interactive; double-submit guarded where relevant.
- [ ] Screen reader order matches visual order; icon-only controls labeled; state changes (muted, sent, failed) announced.

## Both visual worlds

- [ ] Primary and secondary text ≥4.5:1 in light and dark surfaces actually used by this screen.
- [ ] Dividers, borders, and pressed/disabled states distinguishable in both worlds.
- [ ] Scrims and overlays measured against real content behind them (reels, call surfaces), not a fixed opacity habit.

## Layout

- [ ] Safe areas respected on headers, tab bar, composer, toasts, and CTA bars.
- [ ] Scroll content inset so nothing sits permanently behind fixed bars.
- [ ] 4/8 spacing rhythm; related grouped tight, groups separated generously; long text measures kept readable.
- [ ] No horizontal scroll; no fixed full-screen widths; keyboard never covers the focused input.

## Accessibility

- [ ] Decorative images hidden from the accessibility tree; meaningful ones labeled.
- [ ] Form fields: label visible above, error below the field, helper text where needed; nothing placeholder-only.
- [ ] Color never the only indicator (status, errors, selected states have text or shape).
- [ ] Reduce Motion and Dynamic Type supported without breakage.

## Motion (if any was added)

- [ ] Passed the `velora-motion` gates: frequency tier + named purpose; under 300ms; correct curve; UI-thread for gestures; reduced-motion honored.
