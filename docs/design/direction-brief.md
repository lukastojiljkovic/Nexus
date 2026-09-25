# Design Direction Session — Brief

**Status:** prepared 2026-07-05. This is the M0 gate from `docs/roadmap.md`:
no feature UI is built before the founder picks a direction here and the
token set + component gallery derive from it. Grounding:
`docs/research/design-system.md` (anti-slop mandate: not Inter, not indigo,
no stock-kit look; copy Linear's *discipline*, not its aesthetic).

## How to run this session

Open the three mockups in a browser (they are plain local HTML, fully
offline, nothing leaves the machine):

- `mockups/a-instrument.html` — Direction A
- `mockups/b-atelier.html` — Direction B
- `mockups/c-vesper.html` — Direction C

Each shows the same dashboard (sidebar with category separators per
decision #11, widgets, mini-kanban, chart, habit streaks) with that
direction's typography, hue, density, and mood — in dark and light (toggle
top-right). Content is placeholder built from the founder's real v0 use
case (exam prep), not product data.

**You are not choosing a final design — you are choosing a direction.**
Mix-and-match verdicts are valid ("A's density + C's dark palette").

## The three candidates

| | A — Instrument | B — Atelier | C — Vesper |
| --- | --- | --- | --- |
| One-liner | Precise, calm tool | Warm paper workspace | Evening-star command deck |
| Feels like | An instrument you trust | A well-kept notebook | A private mission console |
| Typography (intended licensed font) | IBM Plex Sans (+ Plex Mono for numbers) | Fraunces display + source-serif body pairing | Space Grotesk (+ tabular mono) |
| Hue | Cool neutral grays, petrol/teal accent | Warm paper, ink text, burgundy + amber accents | Deep blue-black, star-gold accent, violet secondary |
| Density | Compact, 1px borders, small radius | Comfortable, generous whitespace, soft shadows | Medium, luminous edges, dark-first |
| Default theme | Light | Light | Dark |
| Risk | Too austere → "developer tool" | Too soft → weak for dense data (finance tables) | Glow kitsch if overdone; light theme is the harder derivative |

Note: mockups approximate the intended fonts with system stacks
(Segoe UI / Georgia / Bahnschrift on Windows); the real fonts get licensed
and self-hosted after the pick. All three intended fonts cover Serbian
Latin diacritics (š č ć ž đ) — verified requirement before licensing
(decision #2, i18n).

## Founder feedback (2026-07-05) → Direction D

Founder verdict on A/B/C: *"sva tri podjednako — čistoća prvog, toplina
drugog, čitljivost trećeg."* Synthesis prepared as
`mockups/d-sinteza.html`:

- **Component discipline from A** — compact density, 1px borders, small
  radius, no decorative shadows, minimal motion.
- **Warmth from B, carried by the light theme** — "Dan": warm paper
  neutrals, bronze accent. Light theme is where warmth lives.
- **Readability and depth from C, carried by the dark theme** — "Noć":
  vesper blue-black, star-gold accent, geometric sans (Space Grotesk
  class), tabular numerals, strong label hierarchy.
- One token system, two moods: **Dan/Noć** becomes the product's theme
  identity (and rhymes with the Vesper name candidate). Burgundy (from B)
  is reserved as the business-profile default accent (decision #11).

**Founder color constraints (2026-07-05, binding for tokens):** no purple/
violet, no blue, no orange (explicitly not "Claude orange") as system
hues. Data/chart secondary revised in D v2 to **jade green** (`#1e7a4f`
light / `#45b784` dark) — clearly green, not teal, so it never reads as
blue; pairs with the gold accent in both themes (green–gold, not
blue–orange). The curated 8-accent user palette (decision #11) will be
drafted within these constraints and re-checked with the founder at token
time.

**Founder anti-slop call (2026-07-05):** the left inset-bar active-nav
highlight "vrišti AI slop" — replaced in D v2. **Active navigation state =
typographic**: no background, no side bar; the active item turns
accent-gold, slightly heavier, with a small right-aligned **✦ marker**
(the brand glyph doubles as the "you are here" mark). This becomes the
component-gallery rule for selected states in navigation; fallback option
if it wears thin: inverted full-accent block. Side-bars and glow borders
stay banned as selection indicators.

**CONFIRMED by founder 2026-07-05** ("svidja mi se") — Direction D v2 is
the design direction. Decision #1 below is resolved; tokens derive from
D v2 (Dan/Noć, gold accent, jade data color, typographic+✦ selection,
color bans in force).

## Decisions to capture in the session (write answers into this file)

1. **Direction**: A / B / C / mix (specify what from where).
2. **Typography**: display+body pairing confirmed; tabular numerals for
   all data surfaces (charts, finance, timers) — yes by default.
3. **Hue & accent**: base neutrals temperature + the default accent from
   which the 8-accent palette (decision #11) is derived; business-profile
   default accent (distinct per decision #11) — which one.
4. **Density**: compact / comfortable default (SET offers both; pick the
   default).
5. **Motion**: minimal (fades, ~100–150 ms) vs expressive (spring
   transitions on kanban/board interactions). Recommendation: minimal
   globally, expressive reserved for canvas and drag interactions.
6. **Dark/light priority**: which theme is design-led (the other is
   derived and checked, both ship per SET-004).

### Parked PRD questions this session also closes

- DASH OQ#1: widget sizes — fixed presets (S/M/L) vs free grid resize
  (presets recommended for visual rhythm).
- TASK OQ#2: priority levels — 4 (none/low/med/high) vs 3.
- NOTE OQ#3: block-based editor feel — confirm against the mockup typing
  mood (research says yes).
- SET decision #11 follow-up: the curated 8-accent palette gets drafted
  from the chosen accent family at token time, WCAG AA auto-checked per
  theme (SET-005).
- SHARE OQ#2 + STATS OQ#2 (public-link viewer + Wrapped share-image
  branding): direction chosen here propagates; final art at
  implementation.

## What happens after the pick

1. Token set (`packages/tokens`) built from the chosen direction —
   3-tier (global → semantic → component), Style Dictionary multi-target.
2. Component gallery (buttons, inputs, cards, list rows, kanban card,
   chart kit, empty states) — reviewed against the "would a generic AI
   tool produce this?" test; binding for agents like the security
   baseline.
3. Only then: feature UI (roadmap M0 exit criterion).
