# Research: Design System & Visual Language (anti-generic mandate)

**Domain:** what makes product UIs distinctive vs generic; multi-view data
patterns (kanban/cards/charts); design-token theming; dataviz consistency.
**Session:** 2026-07-05 (research phase 1, session 5).
**Nexus context:** founder requirement (2026-07-05): kanban, cards, and charts
as the app's visual layer, and a distinctive design system — explicitly not
"generic AI slop." Settings must offer system/dark/light + accent colors.
Cross-cutting concern in `docs/prd/00-overview.md`.

## 1. Conclusions

1. **"AI slop" has a technical definition — and therefore a technical
   antidote.** Generated UIs converge on the statistical center of training
   data: Inter font, indigo/purple accents, stock shadcn/Tailwind component
   defaults — the "shadcn-ification of the web"
   ([why AI design looks generic](https://superdesign.dev/blog/why-ai-design-looks-generic),
   [designer's view of Tailwind/shadcn in the AI era](https://annaarteeva.medium.com/why-designers-should-care-about-tailwind-and-shadcn-especially-in-the-ai-era-55b744c42603)).
   The antidote: make deliberate decisions at the *token* level (own type
   choice, own hue system, own spacing/density/motion) and encode them as a
   design-system file that every implementation agent must consume — never
   let a component kit's defaults leak through. Component kits are fine as
   *behavior* scaffolding (accessibility, focus management); their *look*
   must be 100% overridden by our tokens.
2. **Copy Linear's discipline, not its aesthetic.** Linear is the reference
   for craft: ruthless visual-noise reduction, alignment, density and
   hierarchy in navigation, a large set of modular components each tuned to
   its content, and speed treated as a design feature (their ⌘K palette is
   instant because it searches local data — which Nexus gets for free from
   local-first)
   ([Linear UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui),
   [performance breakdown](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown)).
   But the "Linear look" is itself now a SaaS trend — i.e., the next generic
   ([LogRocket on the Linear design trend](https://blog.logrocket.com/ux-design/linear-design/)).
   Nexus borrows the discipline (density, speed, reduction) and builds its
   own visual identity on top.
3. **The founder's kanban/cards/charts idea formalizes as a shared "views
   engine" — the Notion database-views pattern.** One dataset, many layouts:
   table, list, board, gallery/cards, calendar, timeline, each view with its
   own filters/sort/hidden fields
   ([Notion: when to use each view](https://www.notion.com/help/guides/when-to-use-each-type-of-database-view),
   [view formats compared](https://www.notion.vip/insights/compare-and-configure-notion-s-database-formats-tables-lists-galleries-boards-and-timelines)).
   Nexus builds this **once** as a core component: TASK gets list/kanban/
   calendar, NOTE gets list/cards, recipes and inventory get galleries,
   anything dated gets calendar — consistent interaction everywhere, huge
   leverage from one engine. v1 scope: list + kanban + cards + calendar;
   timeline later.
4. **Design tokens are the architecture of the theming requirement.**
   Three-tier tokens (global values → semantic aliases → component tokens);
   a theme is just a different resolution of semantic tokens; accents need
   per-theme perceptual variants (a saturated accent that works on light
   washes out on dark); dark mode is a first-class context with its own
   elevation logic, not inverted colors
   ([dark-mode token guide](https://muz.li/blog/dark-mode-design-systems-a-complete-guide-to-patterns-tokens-and-hierarchy/),
   [color tokens for light/dark](https://medium.com/design-bootcamp/color-tokens-guide-to-light-and-dark-modes-in-design-systems-146ab33023ac)).
   Tokens live as platform-agnostic JSON transformed per platform
   (Style-Dictionary-class tooling → CSS vars for Electron/web, XML for
   Android) — one source of truth across all surfaces
   ([design tokens guide](https://www.uxpin.com/studio/blog/what-are-design-tokens/)).
   This directly implements Settings: theme = system/dark/light, accent =
   semantic-token swap, with contrast auto-checked (see pitfalls).
5. **Charts get their own mini design system, used by every module.** One
   chart component library, skinned by our tokens; consistent colors per
   data category across the whole app; semantic palette (positive/negative/
   neutral) distinct from categorical and sequential palettes; consistent
   tooltips, legends, and empty states
   ([Atlassian dataviz color](https://atlassian.design/foundations/color-new/data-visualization-color),
   [Carbon dashboards](https://carbondesignsystem.com/data-visualization/dashboards/),
   [leading design systems' dataviz](https://www.supernova.io/blog/the-best-examples-of-data-visualization-in-11-leading-design-systems)).
   Also *semantic* consistency: a metric (e.g., "study hours") is defined
   once and means the same thing in STUDY, DASH, and STATS.
6. **Distinctiveness is a small set of signature decisions, applied
   everywhere.** Synthesis of the above: Nexus needs 4–6 signature elements
   chosen deliberately — typography (not Inter), a non-default hue family,
   a motion language (fast, subtle, consistent easings), density personality,
   one or two signature components (e.g., the countdown widget, kanban card
   anatomy), and a consistent microcopy voice in both launch languages.
   These get chosen with the founder in a **design-direction session with
   visual mockups** (taste is his call), then frozen as tokens + a component
   gallery before any feature UI is built.

## 2. Landscape

| Reference | What it proves | What Nexus takes |
| --- | --- | --- |
| Linear | Craft, density, speed-as-design; own system (Orbiter) | The discipline, not the look |
| Things 3 | Calm, personality-rich productivity UI, nothing generic | Personality without noise |
| Notion | Views engine over one dataset | The multi-view pattern (founder's kanban/cards idea) |
| Atlassian / Carbon / IBM | Token-driven dataviz systems at scale | Chart color semantics, dashboard patterns |
| Default shadcn/Tailwind output | The statistical-center look | The anti-pattern to design away from |

## 3. Process implication (new)

The roadmap gains an explicit **design-system milestone** between architecture
and feature implementation: (1) design-direction session with founder →
(2) tokens + typography + color system + motion spec → (3) core component
gallery (buttons, inputs, cards, kanban, views engine shell, chart kit,
empty/loading/error states) → (4) only then feature UIs. Implementation agents
receive the design system as a binding input, same status as the security
baseline — that is what structurally prevents slop.

## 4. Pitfalls

- **Component-kit default leakage** — one unthemed dropdown betrays the whole
  app. Tokens must cover 100% of visible surface; CI-able lint for raw hex
  values in UI code.
- **Becoming a Linear clone** — the trend is saturated; discipline yes,
  cosplay no.
- **User accents breaking accessibility:** every accent × theme combination
  must pass WCAG contrast automatically (compute, don't hope) — ties into
  the accessibility cross-cutting concern.
- **Rainbow charts:** category colors must be assigned by the system, stable
  per entity, and limited in count; sequential data gets sequential palettes.
- **Views-engine scope creep:** timeline/gallery variants can wait; a solid
  list+kanban+cards+calendar quartet beats six half-views.
- **Cross-platform drift:** without the token pipeline, Android slowly stops
  matching desktop — the pipeline is not optional tooling, it's the guarantee.

## 5. Open questions → design-direction session (founder + mockups)

1. Typography direction: humanist vs geometric vs slightly-condensed — 2–3
   candidates rendered in real screens.
2. Hue family for the brand-neutral base + default accent (and the accent
   palette users pick from).
3. Density personality: airy (Things) vs dense (Linear) vs adaptive
   (compact/comfortable setting).
4. Motion budget: where animation lives (view transitions, checkbox
   satisfaction, chart entrances) and where it never does.
5. Chart library choice — architecture phase, evaluated against themeability
   by tokens.
