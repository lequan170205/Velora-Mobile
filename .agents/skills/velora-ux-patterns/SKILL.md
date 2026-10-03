---
name: velora-ux-patterns
description: UX interaction patterns and quality rules for Velora Mobile screens - forms, navigation, empty/loading/error states, accessibility outcomes, touch targets, and surface-specific UX for auth, chat inbox, conversation, reels, calls, friends, and search. Use when designing or reviewing screen flows, forms, onboarding, feedback and status states, navigation behavior, or when a screen "feels confusing" or "doesn't feel professional" and the cause is interaction design rather than visual polish. Run references/pre-delivery-checklist.md before delivering any new or changed screen. Visual quality lives in velora-design-quality; motion rules live in velora-motion.
---

# Velora UX Patterns

Priority-ordered UX rules plus the patterns that repeat across Velora's surfaces. When rules
conflict, higher priority wins.

## Rule categories by priority

| Priority | Category            | Must have                                                                                                                             | Avoid                                                                                        |
| -------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1        | Accessibility       | Contrast 4.5:1, labels on every control, logical focus order, Dynamic Type without clipping                                           | Icon-only buttons without labels, color as the only indicator                                |
| 2        | Touch & interaction | ≥44pt targets (48dp Android), `hitSlop` for small visuals, visible pressed feedback, gesture regions that don't fight                 | Hover-style affordances, instant 0ms state flips with no feedback, nested tap/drag conflicts |
| 3        | Performance         | FlashList for long lists, recycled images (`expo-image`), reserved space for async content (no layout jump)                           | Full-size decodes for thumbnails, unvirtualized timelines, layout jumps on load              |
| 4        | Layout & responsive | Safe areas on all fixed bars, 4/8 spacing rhythm, no horizontal scroll, content insets behind sticky bars                             | Fixed pixel widths, CTAs under the home indicator, lists hidden behind the composer          |
| 5        | Typography & color  | `Typography` variants, semantic tokens for both visual worlds                                                                         | Raw hex in screens, gray-on-gray secondary text, label bigger than its value                 |
| 6        | Feedback & forms    | Visible labels above inputs, error text below the field at the field, loading state on every async action, one primary CTA per screen | Placeholder-as-label, errors only in a toast, double CTAs with the same intent               |
| 7        | Navigation          | Predictable back (system edge-swipe intact), ≤5 tabs, sheets for interruptions, deep-linkable content screens                         | Custom back handling, overloaded tab bar, modal-ception                                      |

## Global patterns

**Async actions.** Every async action shows progress at the button (Button `isLoading`) or in
place (skeleton matching the final layout's shape — never a bare spinner floating in an empty
screen). Failure surfaces inline where the user acted, names the problem, and offers the
recovery ("Retry", "Edit and retry"), never a bare "Something went wrong".

**Empty states.** An empty screen is an invitation: one line saying what belongs here, one CTA
to create it ("Start a conversation", "Invite friends"), optionally one quiet illustration or
icon. Never a bare white screen. Search is never blank: recents, suggestions, or popular
results fill the first frame.

**Destructive actions.** Confirm via action sheet (AnimatedActionSheet) with the destructive
choice last and visually marked; the confirm button names the object ("Delete chat?", not
"Are you sure?"). Blocking/leaving flows never lose unsaved input.

**Selection over typing.** Offer tappable options for enumerable choices (friend picker,
visibility, durations); free text only for names and search. Repeat-visible buttons live in
the thumb zone (bottom third); destructive/end-call controls are large, pinned, and never
adjacent to a high-frequency action.

**Vocabulary consistency.** One word per concept app-wide: the button that says "Publish"
produces a toast that says "Published". The conversation is "chat" everywhere or "inbox"
everywhere, never mixed. Errors state what happened + what to do, in the product's voice,
without apologizing twice.

## Surface patterns

**Auth (login, register, forgot/reset, verify-email).** react-hook-form + zod already in
place: validate per-field on blur, submit errors under their field, keep values on failure.
Keyboard `returnKeyType` chains fields; the submit button shows `isLoading` and disables
double-submits (SafeTouchableOpacity where needed). Never hide the password field behind a
re-toggle during validation errors. Success navigates once — no double-fires.

**Inbox & conversation.** Timeline anchors and read-frontier are contract territory (see the
`conversation-realtime-sync` skill) — UX changes must not reorder or re-anchor on animation.
Optimistic sends show a pending state that resolves visibly; failed sends keep the message
with a retry affordance, never silently drop it. The composer tracks the keyboard
frame-by-frame (keyboard-controller), keeps its cream surface family, and never traps the
user when the keyboard dismisses. Long-press menus use native-style action sheets; swipe
actions declare their axis so vertical scroll wins (see `velora-motion`).

**Reels feed & creator.** Immersive surface: overlays respect safe areas and stay legible
over arbitrary video (scrim, not hope). Double-tap-like must not fight the vertical pager;
progress indicators reserve their space. Creation flow (crop/trim/publish) preserves drafts —
media-editing contracts live in the `reel-creator-media-editing` skill. Loading a reel never
jumps layout: poster/thumbnail reserves the frame.

**Calls.** Dark `call.*` world, glanceable from arm's length: controls ≥48pt, labels on
icon controls, state (muted, camera off, connecting) readable at a glance and announced to
accessibility. One primary control region (the dock), secondary actions in a sheet. The
end-call action is red, oversized, and isolated from mute/camera toggles. Lifecycle and
membership UX contracts live in the `native-call-lifecycle` skill.

**Friends & search.** Selection UIs (pick recipients, add members) show chosen state clearly
(avatar stack or count on the confirm button); the confirm button stays in the thumb zone and
summarizes ("Create group · 3"). Request accept/decline are side-by-side equals with distinct
visual weight (accept primary).

**Profile & settings.** Settings rows are full-width pressables with label + current value +
chevron; destructive rows isolated in their own group with red text. Every toggle persists
immediately and shows the result (optimistic with rollback on failure).

## Before delivering any screen

Load [references/pre-delivery-checklist.md](references/pre-delivery-checklist.md) and run it.
It is the canonical checklist — process steps, visual quality, interaction, both visual
worlds, layout, accessibility. If a box cannot be honestly ticked, the screen is not done.
