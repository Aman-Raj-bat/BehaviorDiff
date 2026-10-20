# BehaviorDiff --- Evidence Lab

## Design Direction: Immersive Forensic Workspace

**Reference:** Lusion's Spaace project ---
https://lusion.co/projects/spaace/\
**Purpose:** Translate the reference's sense of spatial depth, cinematic
motion, and interactive 3D storytelling into BehaviorDiff's own visual
identity. This is inspiration, not a request to copy the original site.

------------------------------------------------------------------------

## 1. Product and design objective

BehaviorDiff helps developers detect behavioral regressions, minimize
failing scenarios, replay them independently, and inspect evidence. The
interface must communicate precision, trust, and technical depth.

Create a memorable first impression through a restrained immersive
scene, then prioritize clarity and speed once the user enters the
workbench.

**Design principle:** immersive on entry; forensic and legible during
work.

Do not turn the product into a generic AI landing page, gaming UI, NFT
marketplace, or decorative 3D demo.

## 2. Preserve the current product

This is a frontend/art-direction task. Before editing, inspect the
repository and current implementation.

Preserve all existing: - Execution engine and behavior-comparison
logic - Evidence format and generated artifact structure - Trusted
fixture allowlist - Comparator and shrinker behavior - Replay behavior
and actual results - CLI and API contracts - Loopback-only
server/security restrictions - Existing workflows, routes, and
functional controls

Do not replace real functionality with mock results. Do not change
engine behavior to make the UI look better. Do not delete tests or
weaken assertions.

Known regression acceptance path: `cart-noisy` should detect the
regression, shrink a 6-step scenario to 2 steps while preserving
`/items/0/lineTotal`, independently replay the minimized case, and
report the correct PASS/REGRESSION outcome according to the existing
implementation. Confirm against current tests and actual code rather
than assuming.

## 3. Art direction

### Mood

Industrial graphite, precise instrumentation, spatial depth, controlled
tension, evidence-first. The scene should feel like a dark, quiet
laboratory containing two competing behavioral paths.

### Palette

Keep the existing palette and token values wherever already defined. If
a token is missing, use these intended references:

-   Base background: `#101316`
-   Shell: `#151A1E`
-   Surface: `#1B2227`
-   Raised surface: `#252D33`
-   Ivory evidence surface: warm ivory, matching existing styles
-   Reference behavior: electric blue
-   Candidate behavior / regression: vermilion
-   Successful reduction / verified signal: acid lime
-   Primary text: high-contrast off-white
-   Secondary text: cool muted gray

Blue, vermilion, and lime are semantic signals, not decoration. Do not
use them all over the page.

### Typography

Keep the existing editorial display + compact monospaced diagnostic
pairing if present. Use readable sizes and strong hierarchy. Logs, IDs,
timestamps, file paths, and measurements may use monospace. Never
sacrifice legibility for tiny technical labels.

## 4. Spatial background concept

Create an original abstract "behavior field" rather than copying
Spaace's assets or scene.

Possible visual ingredients: - Dark, sculptural graphite forms or a
sparse geometric field - Thin wireframe paths / contour lines suggesting
execution traces - Two distinct paths: reference (blue) and candidate
(vermilion) - A small, deliberate divergence point where the paths
separate - Fine grain, subtle atmospheric haze, restrained rim
lighting - Slow, low-amplitude camera/parallax movement - Optional
particles only when sparse and purposeful

The 3D scene must remain background context. It must not compete with
headings, controls, evidence, or diagnostic text.

### Recommended placement

1.  **Landing / intro:** largest immersive treatment, with a strong
    static first frame and a clear call to action.
2.  **Demo showcase:** background motion can respond to real workflow
    stages (detect → shrink → replay → inspect). Every state must
    reflect actual app state.
3.  **Workbench:** dramatically reduce visual intensity. Use a static or
    near-static ambient background, with panels remaining opaque and
    readable.
4.  **Evidence and logs:** plain, high-contrast surfaces; no animation
    behind dense text.

Do not force a full-screen 3D environment behind every route.

## 5. Interaction and motion

Motion must explain behavior, not merely decorate it.

-   On initial entry, reveal the scene with a short, restrained camera
    move.
-   On pointer movement, use subtle parallax with clamped movement;
    never make the UI feel slippery.
-   On regression detection, a blue path and vermilion path may diverge
    at a specific point.
-   On shrinking, visually remove rejected steps only when the real
    shrink operation has completed; reflect the real count (e.g. 6 → 2
    only when the run reports that result).
-   On replay, a subtle scan or trace can indicate progress; completion
    must use actual replay status.
-   On success, use a restrained lime confirmation, not a full-screen
    flash.
-   Respect `prefers-reduced-motion`; provide a static version.
-   Disable or simplify heavy effects on small screens, low-power
    devices, and when WebGL is unavailable.
-   Avoid forced audio, flashing, continuous rapid movement, and scroll
    hijacking.

## 6. Technical implementation guidance

Inspect the existing stack before choosing an implementation. The
frontend is React + Vite + TypeScript + Tailwind.

Preferred order: 1. CSS gradients, pseudo-elements, a fine grid, and
subtle lighting if they achieve the intended result. 2. A small,
isolated Canvas/WebGL scene only if it materially improves the visual
outcome. 3. Add a 3D dependency such as Three.js only after checking
current dependencies, bundle impact, browser support, and fallback
behavior.

If using WebGL/Three.js: - Isolate it in a lazy-loaded decorative
component. - Keep the main app usable if scene loading fails. - Use
`pointer-events: none` on decorative layers. - Clean up animation
frames, listeners, and GPU resources on unmount. - Avoid excessive draw
calls, huge textures, expensive postprocessing, and unnecessary
physics. - Pause or reduce rendering when the tab is hidden if feasible
within the existing architecture. - Ensure text and controls are normal
DOM elements, not rendered into the scene. - Keep all core workflows
independent of the scene. - Do not add remote runtime dependencies or
load assets from untrusted sources.

## 7. Demo showcase requirements

The showcase must demonstrate the real application, not a fake product
video: 1. Start from a known scenario/fixture. 2. Run the actual
comparison. 3. Show the actual regression result and mismatch evidence.
4. Run the actual shrinker and show the actual minimized step count. 5.
Independently replay the minimized scenario. 6. Display actual final
status and evidence artifacts.

Use the supplied hand-cursor asset as an **in-page illustrative/demo
cursor** if that remains part of the current task. It must not be
confused with the user's native system cursor. Animate it only to guide
users through real interactive controls. Provide pause/replay controls
and ensure the showcase works without the cursor animation.

No fake terminal output, invented metrics, pretend progress, inert
buttons, or animation that claims a run succeeded before it has.

## 8. Accessibility and usability

-   Maintain readable contrast over every background state.
-   Keep keyboard navigation and visible focus indicators.
-   Respect reduced motion.
-   Make decorative canvases inaccessible to screen readers; expose
    actual state through semantic DOM.
-   Ensure all primary actions work with keyboard and pointer.
-   Avoid hover-only information.
-   Provide a static fallback for WebGL failures and mobile devices.
-   Ensure the UI remains responsive and usable at narrow widths.

## 9. Explicitly avoid

-   Copying Spaace's logo, proprietary assets, source code, models,
    textures, or exact scene composition
-   Generic purple/blue "AI glow" blobs
-   A busy 3D scene behind logs and evidence
-   Neon accents on every element
-   Overuse of glassmorphism
-   Fake scanlines, excessive bloom, strong chromatic aberration, or
    noisy particle storms
-   Scroll-jacking and long intro sequences
-   Replacing functional controls with decorative mockups
-   Rewriting the engine or changing API/evidence contracts
-   Adding a large dependency solely for a background effect

## 10. Definition of done

-   The visual direction is clearly distinct and more immersive, but
    remains recognizably BehaviorDiff.
-   Existing routes and workflows remain functional.
-   The demo showcase runs the real regression → shrink → independent
    replay → evidence workflow.
-   The in-page hand cursor, if retained, is separate from the native
    cursor and works reliably.
-   Existing tests still pass; no tests are removed or weakened.
-   Run the relevant test suite, build, and demo. Report exact commands
    and results.
-   Verify the page at desktop and narrow viewport sizes, including
    fallback/reduced-motion behavior.
-   Report any unverified browser-level checks honestly.
-   Summarize changed files and explain any dependency added with its
    rationale.

------------------------------------------------------------------------

## Final design statement

**BehaviorDiff is a forensic instrument in a spatial environment.** Let
the opening scene establish atmosphere and technical ambition. As soon
as the user starts investigating a regression, let the environment
recede and let the evidence become the hero.
