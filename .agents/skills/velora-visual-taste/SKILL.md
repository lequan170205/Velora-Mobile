---
name: velora-visual-taste
description: Visual taste and anti-generic design discipline for Velora Mobile UI. Use when choosing an aesthetic direction for a new screen, when a design must feel distinct, premium, or "less AI-generated", when reviewing screens for genericness, template-look, or consistency drift, or when planning a redesign (preserve vs overhaul). Also use when the user references a vibe ("cleaner", "more premium", "Apple-like", "playful") or complains everything looks the same. For build-process and quality floor use velora-design-quality; for animation taste use velora-motion.
---

# Velora Visual Taste

Every rule here is contextual. First read the brief, then pull only what fits. The single
failure mode this skill exists to prevent: shipping a default aesthetic instead of a decision.

## 1. Design read before anything

Before touching code, state in one line: **"Reading this as: \<screen> for \<user/job>, in a
\<adjective> register, using \<which Velora world + tokens>."**

Read these signals:

- **Surface kind** — auth, inbox, conversation, reels, call, friends, search, profile, settings, sheet.
- **Vibe words the user used** — "calm", "premium", "playful", "clean". The audience picks the register, not your taste.
- **Reference signals** — screenshots, apps they named ("Linear-style", "Apple-like").
- **Quiet constraints** — trust-critical flows (auth, calls, errors) override expressiveness. Glanceability on call surfaces overrides cleverness.

If the read genuinely diverges, ask **one** question ("Should the reel composer feel closer to
quiet-utility or expressive-creator?"). If you can infer, declare the read and proceed.

## 2. Dials (set them explicitly)

Three dials gate layout, motion, and density decisions. Baseline for Velora product UI:
`VARIANCE 4 · MOTION 4 · DENSITY 5`. Override per surface:

| Surface                                | Variance       | Motion | Density       |
| -------------------------------------- | -------------- | ------ | ------------- |
| Auth, settings, profile                | 3–4            | 2–3    | 4             |
| Inbox, conversation, friends, search   | 4              | 3–4    | 5             |
| Reels feed, creator, media viewer      | 6–7            | 6–7    | 6 (immersive) |
| Call surfaces                          | 3 (glanceable) | 3      | 4             |
| Celebration / first-run moments (rare) | 6–7            | 6–7    | 3             |

- **VARIANCE** — 1 = perfect symmetry; 10 = asymmetric/masonry. Above 5, layouts must still collapse to clean single-column on narrow phones.
- **MOTION** — 1 = static; 10 = choreography. Every point above 3 costs performance and must follow `velora-motion` (gates, threads, reduced motion).
- **DENSITY** — 1 = gallery-airy; 10 = cockpit. Chat timelines run denser than auth screens; call rosters denser still.

Motion claimed = motion shown. If a dial says 6 and the screen ships static, the dial was wrong — fix the dial, don't fake the claim.

## 3. Consistency locks (mandatory once set)

- **Accent lock.** One accent per flow: brand orange `#FF6B2C` (and its `brand.*` family). A screen does not grow a blue link or teal badge in its second section. Red is reserved for destructive/end-call/error. Status greens only for presence/success.
- **Shape lock.** One radius system from the token scale. Pills are for small controls, badges, avatars — never cards. Mixed radii on the same hierarchy level is broken design.
- **Elevation lock.** Border or shadow, once, per surface (see `velora-design-quality` floor).
- **Icon lock.** One icon family, one stroke weight per level, filled XOR outline per level. No emoji as structural icons anywhere.
- **Copy register lock.** One voice per surface: plain verbs, sentence case, no filler. Don't mix playful onboarding jokes into error messages, or marketing superlatives into settings.
- **World lock.** Light product canvas or dark media surface per the surface's job (see `velora-design-quality`). Within a flow, do not flip worlds screen-to-screen.

## 4. AI tells (mobile edition — avoid on sight)

These are the defaults models reach for when not deciding. Any one of them on a free axis
means the choice was not made:

**Layout**

- Three (or four) identical equal-width stat/feature cards as the screen's structure. Cards are the lazy container; nested cards are always wrong. Group with dividers, headers, or space instead.
- A big-number-with-small-label hero metric template pasted onto profile/stats surfaces without a reason.
- Section headers with ALL-CAPS tracked-out eyebrow labels above them. The heading carries its own weight; delete the label.
- Numbered steps (`1 / 2 / 3`, `01`, `02`) unless the sequence itself carries information.
- Centered everything. Centered titles + centered rows + centered CTAs reads as a template; left-align content, center only single-moment screens (empty states, success).

**Decoration**

- Gradient text, gradient borders, gradient backgrounds as filler. A gradient is a Velora brand moment (button, hero) or it is noise.
- Glass/blur panels that don't sit over moving media. `bg-glass` belongs over content that scrolls beneath it, not as a card style.
- Decorative colored dots before every list row, nav item, and badge — a dot must carry real state (presence, live) and be rationed.
- Hard offset shadows, neon glows, progress rings and sparklines standing in for real content.
- Emoji in headers, empty states, or section titles as illustration.

**Content**

- Fake-precise numbers (`92%`, `4.1×`) that don't come from real data.
- Generic filler ("John Doe", "Acme", "Lorem") instead of believable content in the product's register.
- Placeholder-as-label inputs; ghost buttons with invisible contrast; two CTAs with the same intent on one screen ("Start chat" + "Message" + "Say hi" — pick one).
- Em-dash (`—`) in any user-visible string. Use a period, comma, or line break. This is binary: zero em-dashes ship.

## 5. Redesign protocol

Detect the mode before proposing anything:

- **Preserve** — modernize without breaking the brand. Audit first: extract the tokens actually in use, what's doing work, what's filler. Evolve gradually.
- **Overhaul** — new visual language on existing function. Treat as fresh direction; keep routes, data contracts, and behavior identical.

Never change silently, in either mode: route structure, navigation labels, button copy that
downstream analytics or muscle memory depends on, brand color, the two-worlds split, legal/
status copy. List these in the proposal when relevant.

Modernization levers in priority order (stop when the brief is satisfied):

1. Typography refresh (hierarchy via `Typography` variants) — biggest lift per unit of risk.
2. Spacing & vertical rhythm.
3. Color recalibration within tokens (desaturate strays, unify neutrals).
4. Motion layer on existing components (per `velora-motion`).
5. Recompose the key screen region.
6. Full block replacement — only when the existing block is unsalvageable.

## 6. Restraint and self-critique

- Spend boldness in one place per screen. One composed moment (an empty state, a transition, a reel overlay) and quiet discipline around it.
- Before shipping, re-read every visible string. Flag grammar breaks, unclear referents, forced wordplay, and anything that sounds like a model pretending to be a designer. Rewrite as a plain functional sentence.
- Review the screen as rendered (screenshot or device), not as code. If any part reads like the generic version you would produce for any similar screen, revise that part and say what changed.
- When torn between refined and committed, commit. Half-applied personality is worse than none.
