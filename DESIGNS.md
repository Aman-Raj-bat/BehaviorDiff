# BehaviorDiff — Design System & Landing Page Specification

**Product:** BehaviorDiff — Evidence Lab  
**Design direction:** Forensic Instrument / Product-led Developer Tool  
**Primary objective:** Create a visually distinctive landing page that showcases the real product and communicates its value immediately.

This document is the design source of truth for the landing page and its visual relationship to the Evidence Lab. Follow it alongside the implementation prompt.

---

## 1. Product identity

BehaviorDiff is a deterministic debugging tool that compares reference and candidate HTTP/JSON behavior, detects semantic regressions, minimizes failing stateful request sequences, and produces reproducible evidence.

The product's central promise is:

**Find the difference. Prove the bug.**

The design must communicate three capabilities:

1. **Detect** — identify the precise behavioral mismatch.
2. **Minimize** — reduce a noisy failing sequence while preserving the original target mismatch.
3. **Prove** — independently replay the minimized sequence and inspect the evidence.

BehaviorDiff is an engineering instrument, not an AI assistant, generic analytics dashboard, or marketing-first SaaS product.

The landing page must make the product itself the hero.

## 2. Design inspiration

Use the supplied product-led landing-page reference as inspiration:

https://pin.it/5VvusDRej

Study the reference if accessible. Adapt its useful principles for BehaviorDiff, such as product framing, browser-window presentation, composition, hierarchy, typography, whitespace, and motion.

Do not copy its branding, text, or exact layout.

If the reference is inaccessible, follow this specification and report the limitation instead of pretending it was inspected.

Additional product references:

- Replay — investigation timelines and debugging context.
- Requestly — API requests, responses, and JSON inspection.
- Sentry — issue hierarchy and diagnostic evidence.
- Linear — visual restraint, spacing, and typography.
- Chromatic — presenting comparisons as reviewable evidence.

These references inform different aspects of the experience. They are not templates to reproduce.

## 3. Art direction

### Overall feel

A premium forensic engineering instrument: precise, confident, editorial, technical, and visually memorable.

The landing page should feel deliberately composed, with the actual application displayed as a large, convincing product preview.

Use:

- Strong editorial typography.
- Carefully controlled asymmetry.
- Restrained technical details.
- Fine rules and measurement-inspired dividers.
- Deliberate whitespace.
- High-contrast evidence surfaces.
- A cohesive relationship between the hero and application UI.

Avoid:

- Giant empty hero sections.
- Generic SaaS feature-card grids.
- Excessive rounded containers.
- Gradient-heavy decoration.
- Glassmorphism as the primary visual language.
- Random decorative charts.
- Tiny uppercase labels everywhere.
- Decorative elements that compete with the actual product.

## 4. Color system

Inspect the existing CSS variables before introducing new tokens.

The established palette is:

| Token | Color | Purpose |
|---|---|---|
| Background | `#101316` | Main application and page background |
| Shell | `#151A1E` | Navigation and major structural surfaces |
| Surface | `#1B2227` | Secondary panels |
| Raised surface | `#252D33` | Controls and inset panels |
| Ivory evidence | `#F0EDE4` | High-emphasis evidence surfaces |
| Primary text | `#F4F1E9` | Main text on dark backgrounds |
| Secondary text | `#A5ADB0` | Supporting text |
| Muted text | `#747F85` | Low-priority metadata |
| Reference | `#78AFFF` | Reference behavior |
| Candidate | `#FF654F` | Candidate mismatch |
| Action | `#D7FF64` | Primary actions and accepted reductions |
| Success | `#A8D98A` | Verified successful outcomes |
| Warning | `#F5C86A` | Warnings and cautionary states |

Maintain the semantic meaning of these colors.

Reference and candidate must remain visually distinguishable without relying on color alone. Use labels and layout as well.

Do not use every accent simultaneously in every component.

## 5. Typography

Establish three clear levels:

**Display typography**
- Large editorial headings.
- Confident, distinctive character.
- Used sparingly for the primary message.

**Interface typography**
- Highly readable labels, navigation, controls, and descriptions.
- Consistent sizing and line height.
- No unnecessary microtext.

**Technical typography**
- Monospaced identifiers, JSON, HTTP metadata, JSON Pointers, and execution metrics.
- Comfortable line spacing.
- Adequate contrast.

Prefer existing fonts, local assets, and reliable system stacks. The product must render correctly without depending on a remote font service.

## 6. Landing page architecture

### A. Compact navigation

The navigation should contain:

- BehaviorDiff identity.
- Product or Evidence Lab link.
- Documentation link, only if an actual destination exists.
- GitHub link to the actual repository, if configured.
- A clear launch action.

Keep navigation compact. It must not compete with the headline or product preview.

Do not create dead links.

### B. Hero

The hero must immediately communicate the product's value.

Primary headline:

**Find the difference. Prove the bug.**

Supporting copy should explain that BehaviorDiff compares API behavior, minimizes failing scenarios, and independently replays the result.

Primary CTA:

**Launch Evidence Lab**

Secondary CTA:

**View on GitHub**

Use actual configured destinations. Do not invent a repository URL.

The hero should be composed around the product preview rather than a large decorative illustration.

At desktop widths, the headline, CTA, and a substantial part of the product preview should appear in the initial viewport.

Do not force visitors to scroll through a large marketing block before seeing the product.

### C. Product-window presentation

The product preview is the visual centerpiece.

Frame it as a convincing application window with restrained browser chrome, subtle depth, clean edges, and a well-composed workspace.

The preview should communicate:

- Current scenario.
- Reference versus candidate.
- The actual mismatch.
- The exact JSON Pointer.
- The reduction from six steps to two.

The preview must be consistent with the real application's visual language.

Where feasible, reuse existing UI components and actual checked-in fixture evidence. If a scripted presentation is necessary, clearly distinguish it from a live execution and derive its content from the real fixture or verified evidence.

Do not build a disconnected mock application that is presented as the real working tool.

### D. Product demonstration sequence

If motion is implemented, use a restrained, purposeful sequence:

1. Present the reference/candidate comparison.
2. Emphasize the mismatch.
3. Reveal the exact failing path and step.
4. Present the six-to-two-step reduction.
5. Confirm replay of the preserved mismatch.

The animation should explain the product, not merely decorate it.

Requirements:

- Respect `prefers-reduced-motion`.
- Avoid rapid transitions and distracting looping effects.
- Do not fabricate network activity, progress, or execution results.
- Do not claim a live run occurred when the content is a scripted presentation.
- Keep the static initial state useful and understandable.

### E. Capability explanation

Below the hero, explain the product through three distinct stages:

**Detect**
Compare reference and candidate behavior to identify the precise mismatch.

**Minimize**
Reduce a noisy stateful sequence while preserving the intended failure.

**Prove**
Replay the minimized scenario and inspect reproducible evidence.

Use a visual progression or a connected composition rather than three generic cards with icons.

### F. Final call to action

End with a compact invitation to launch the actual Evidence Lab and, if available, inspect the repository.

Keep the call to action consistent with the product's visual identity.

## 7. Product evidence used in the showcase

Use the existing checked-in demonstration scenario and its verified facts:

- Scenario: `cart-total`
- Original noisy scenario: six steps
- Minimized scenario: two steps
- Retained steps: `create-cart`, `add-item`
- Failing step: `add-item`
- JSON Pointer: `/items/0/lineTotal`
- Reference value: `2`
- Candidate value: `1`
- Classification: `BUSINESS_DIFFERENCE`

The existing bounded shrinker may report `minimalUnderOperations=true`. This means the configured bounded search completed, not that global minimality has been proven.

Use these facts consistently across the product preview, copy, and any animation.

Never fabricate attempt counts, replay counts, intermediate operations, or success states.

If the landing page uses live data, obtain it from the actual application. If it uses a scripted showcase, keep the content grounded in verified fixture evidence and do not misrepresent it as a live execution.

## 8. Responsive behavior

### Desktop

- Strong editorial hero.
- Large product-window preview.
- Balanced headline and workspace composition.
- No oversized empty areas.
- No horizontal page scrollbar.
- The product remains visible early in the page.

### Tablet

- Recompose the headline and preview deliberately.
- Maintain comfortable spacing.
- Keep the primary action prominent.

### Mobile

- Stack content logically.
- Keep navigation usable.
- Ensure the headline does not overflow.
- Scale the product preview or provide a readable, appropriately simplified presentation.
- Prevent the entire page from scrolling horizontally.
- Ensure the launch CTA remains accessible.

Long JSON may scroll inside its own preview panel, not across the entire page.

## 9. Interaction and accessibility

- The primary CTA opens the actual working Evidence Lab.
- The GitHub CTA uses the real repository URL if configured.
- Every navigation link has a real destination.
- All interactive elements have accessible names.
- Keyboard focus is visible.
- Color is not the sole indicator of status.
- Reduced-motion preferences are respected.
- Loading or failure states do not leave misleading success indicators.
- The page remains usable without remote fonts or external animation services.

## 10. Technical boundaries

The landing-page implementation must preserve the existing core.

Do not redesign or rewrite:

- The comparison engine.
- The shrinker.
- Fixture services.
- CLI behavior.
- Existing API contracts.
- Evidence schemas.
- Backend security protections.

Do not add a new framework or unnecessary runtime dependencies.

Preserve offline compatibility where currently supported.

Do not commit or push.

## 11. Acceptance criteria

The landing page is complete when:

- The design is clearly and substantially different from the current unsatisfactory hero.
- The product preview is the visual centerpiece.
- The value proposition is immediately understandable.
- The mismatch and reduction are easy to identify.
- The actual Evidence Lab is one click away.
- The visual design is cohesive with the forensic instrument identity.
- The layout works at desktop and mobile widths.
- No dead navigation links, horizontal overflow, or misleading execution states remain.
- Existing product behavior is unchanged.

Run the existing test suite and demo, and perform browser verification if a browser is available. Report actual outcomes and any checks blocked by the environment.

## 12. Source of truth

This document defines the intended visual direction and landing-page behavior.

The implementation prompt defines the work to execute. Existing code and tests define the actual product contracts.

When these appear to conflict, preserve working functionality and security, explain the conflict, and make the smallest justified decision.

**Design principle: show the real engineering value of BehaviorDiff, beautifully presented, with no visual theater that undermines trust.**