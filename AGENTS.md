## Mobile UI development

Before creating or modifying a mobile screen, read:

- `docs/mobile-ux-engineering.md`

Treat its screen classification, scroll ownership, keyboard behavior,
safe-area, gesture and validation rules as repository invariants.

Do not introduce raw scrolling or keyboard-handling primitives in screen
components when an existing project layout primitive covers the use case.

A UI task is not complete until the rendered behavior has been validated.
