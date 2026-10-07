---
name: Nexus Design System
description: Dan and Noc, the light and dark themes of the Nexus desktop workspace, built from one token set in packages/tokens.
colors:
  paper-50: "#fffdf9"
  paper-100: "#f7f4ee"
  paper-200: "#efeadd"
  paper-250: "#e9e2d1"
  paper-300: "#e2dbc9"
  paper-350: "#d5cbb2"
  paper-400: "#cdc3a9"
  paper-500: "#8a8170"
  paper-550: "#5a5343"
  paper-600: "#6d6452"
  paper-900: "#221e18"
  night-50: "#e8e9f0"
  night-200: "#c3c7d8"
  night-300: "#8d91ab"
  night-400: "#6f7490"
  night-550: "#2c3358"
  night-600: "#232847"
  night-650: "#1f2542"
  night-700: "#191d36"
  night-750: "#171c33"
  night-800: "#12152a"
  night-850: "#101426"
  night-900: "#0c0e17"
  night-950: "#070911"
  gold-300: "#eecb74"
  gold-400: "#e5bf62"
  gold-600: "#8a6410"
  gold-700: "#7c5a0d"
  gold-tint-dan: "#f3ead1"
  gold-tint-noc: "#2b2637"
  jade-200: "#6cc9a0"
  jade-300: "#45b784"
  jade-600: "#1e7a4f"
  jade-700: "#166343"
  jade-tint-dan: "#e1f0e7"
  jade-tint-noc: "#14312a"
  garnet-300: "#e07a70"
  garnet-400: "#c5695c"
  garnet-600: "#8c3b34"
  garnet-700: "#b3423a"
  garnet-tint-dan: "#f4e4e0"
  garnet-tint-noc: "#3a2426"
  bronza-300: "#e6c9a1"
  bronza-400: "#d9b586"
  bronza-600: "#7d5426"
  bronza-700: "#6d4820"
  maslina-300: "#d4cf85"
  maslina-400: "#c6c06a"
  maslina-600: "#67621a"
  maslina-700: "#585414"
  suma-300: "#9ad6b0"
  suma-400: "#7cc79a"
  suma-600: "#2b6b46"
  suma-700: "#235c3b"
  ruza-300: "#edaebc"
  ruza-400: "#e295a7"
  ruza-600: "#9c4257"
  ruza-700: "#883849"
  bordo-300: "#dd93a0"
  bordo-400: "#d07f8e"
  bordo-600: "#7c2f40"
  bordo-700: "#6b2837"
  grafit-300: "#d4d0c6"
  grafit-400: "#c4c0b4"
  grafit-600: "#4d4a41"
  grafit-700: "#403d35"
  wire-red: "#f0705f"
  wire-black: "#6e7285"
  wire-yellow: "#e8c65a"
  wire-green: "#4fc98a"
  wire-blue: "#7ba6f5"
  wire-white: "#f2f3f7"
  wire-orange: "#f0a05a"
  wire-brown: "#c08a63"
  wire-grey: "#b9bdcb"
  bench-dan-mat: "#23201c"
  bench-dan-grid: "#3a352d"
  bench-dan-body: "#35302a"
  bench-dan-edge: "#a89c85"
  bench-noc-mat: "#0a0d1a"
  bench-noc-grid: "#1c2340"
  bench-noc-body: "#141a30"
  bench-noc-edge: "#8f96b3"
typography:
  family-ui: '"Segoe UI Variable Text", "Segoe UI", Inter, -apple-system, BlinkMacSystemFont, system-ui, "Noto Sans", sans-serif'
  family-display: '"Segoe UI Variable Display", "Segoe UI", Inter, -apple-system, BlinkMacSystemFont, system-ui, "Noto Sans", sans-serif'
  family-mono: '"JetBrains Mono", "Cascadia Mono", Consolas, "SF Mono", "Courier New", monospace'
  caption: "11px"
  label: "11px"
  bodySm: "13px"
  body: "15px"
  prose: "16px"
  title: "18px"
  h2: "20px"
  h1: "24px"
  display: "32px"
  leading-tight: "1.15"
  leading-snug: "1.35"
  leading-normal: "1.55"
  leading-loose: "1.7"
  weight-regular: "400"
  weight-medium: "500"
  weight-semibold: "600"
  weight-bold: "700"
  tracking-tight: "-0.012em"
  tracking-normal: "0.01em"
  tracking-label: "0.12em"
  tracking-wide: "0.2em"
  tracking-body: "-0.008em"
  tracking-h1: "-0.018em"
  tracking-display: "-0.022em"
rounded:
  xs: "4px"
  sm: "5px"
  md: "7px"
  lg: "9px"
  xl: "12px"
  round: "999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
components:
  button-primary:
    backgroundColor: "{colors.gold-600}"
    textColor: "{colors.paper-100}"
    rounded: "{rounded.md}"
    padding: "7px 14px"
    height: "30px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.paper-900}"
    rounded: "{rounded.md}"
    padding: "7px 14px"
    height: "30px"
  card:
    backgroundColor: "{colors.paper-50}"
    rounded: "{rounded.lg}"
    padding: "{spacing.4}"
  chip:
    backgroundColor: "{colors.paper-200}"
    textColor: "{colors.paper-600}"
    rounded: "{rounded.md}"
    padding: "2px 9px"
  text-field:
    backgroundColor: "{colors.paper-50}"
    textColor: "{colors.paper-900}"
    rounded: "{rounded.md}"
  list-row:
    height: "36px"
    padding: "6px 0"
  kanban-card:
    backgroundColor: "{colors.paper-50}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
  page-header:
    height: "72px"
    padding: "{spacing.4}"
---

# Design System: Nexus

## Overview

**Creative North Star: "Dan and Noc"**

One token system, two moods. The light theme, Dan, is a warm paper workspace:
paper neutrals with a bronze-gold accent. The dark theme, Noc, is a deep
blue-black evening sky with a star-gold accent, where the sidebar and the lock
screen carry a generated star field. Both are produced from the same semantic
token names, so a component written once resolves to the correct values in
either theme.

The system was chosen in the design-direction session recorded in
[docs/design/direction-brief.md](docs/design/direction-brief.md), and the
reasoning behind it, including the anti-generic mandate, is in
[docs/research/design-system.md](docs/research/design-system.md). Those two
documents stay the long-form record; this file summarises what is implemented
today. The values live in `packages/tokens/tokens/global.json`,
`packages/tokens/tokens/themes/dan.json` and
`packages/tokens/tokens/themes/noc.json`, and the component rules in
`packages/ui/src/styles.css`.

**The Two Moods Rule.** A value is written once as a semantic token, and Dan and
Noc resolve that same name to their own primitives, so nothing in a component
names a hue.

**The Token-Only Rule.** Raw `#hex`, `rgb()` and `hsl()` are forbidden outside
`packages/tokens`, and `pnpm check:colours` fails CI on a violation.

**The Banned Hues Rule.** System hues avoid purple, blue and orange; the data
role is jade green, chosen so it never reads as blue beside the gold accent.

## Colors

The palette is defined in `packages/tokens/tokens/global.json`. Neutrals are
`paper` (Dan) and `night` (Noc); the default accent is `gold`, and the data role
is `jade`.

| Role | Dan | Noc | Source token |
| --- | --- | --- | --- |
| Background | `#f7f4ee` | `#070911` | `paper.100` / `night.950` |
| Surface | `#fffdf9` | `#101426` | `paper.50` / `night.850` |
| Surface alt | `#efeadd` | `#171c33` | `paper.200` / `night.750` |
| Border | `#d5cbb2` | `#232847` | `paper.350` / `night.600` |
| Text | `#221e18` | `#e8e9f0` | `paper.900` / `night.50` |
| Muted text | `#5a5343` | `#c3c7d8` | `paper.550` / `night.200` |
| Accent | `#8a6410` | `#e5bf62` | `gold.600` / `gold.400` |
| Accent soft | `#f3ead1` | `#2b2637` | `gold.tintDan` / `gold.tintNoc` |
| Data | `#1e7a4f` | `#45b784` | `jade.600` / `jade.300` |
| Danger | `#b3423a` | `#e07a70` | `garnet.700` / `garnet.300` |

The user-selectable accents are `zlato` (`gold`), `bronza`, `maslina`, `suma`,
`zad` (`jade`), `ruza`, `bordo` and `grafit`. Each carries an `accent`,
`accentSoft` and `accentStrong` slot per theme. `zlato` is the default and is
required by the build to stay identical to the theme's own accent tokens
(`packages/tokens/build.mjs`).

The Electronics workbench has its own fixed hues in the same file: the nine
`wire` colours and the `bench` mat, grid, body and edge pairs, one set per theme.

**The Three Roles Rule.** Charts use exactly three colour roles - accent for what
the person did, jade data for the comparison, garnet danger for a bad state -
and a fourth series is a sign the chart is doing two jobs.

**The Intensity Rule.** A chart's intensity is one hue at four steps, never a
continuous ramp.

**The Redundancy Rule.** Colour never carries a state alone; it is always
repeated in position, shape or a label.

## Typography

The type ramp is defined in `packages/tokens/tokens/global.json`. The UI family
is a system stack led by Segoe UI Variable Text, the display family by Segoe UI
Variable Display, and the mono family by JetBrains Mono. The sizes are `caption`
and `label` at `11px`, `bodySm` at `13px`, `body` at `15px`, `prose` at `16px`,
`title` at `18px`, `h2` at `20px`, `h1` at `24px` and `display` at `32px`.

Leading is `tight` `1.15`, `snug` `1.35`, `normal` `1.55` and `loose` `1.7`.
Weights are `regular` `400`, `medium` `500`, `semibold` `600` and `bold` `700`.
Tracking is set by size: `tracking-body` `-0.008em`, `tracking-tight` `-0.012em`,
`tracking-h1` `-0.018em`, `tracking-display` `-0.022em` and `tracking-label`
`0.12em` for uppercase labels.

**The Base Leading Rule.** The application states its base leading once, as
`snug` on `.nx-app`, and prose overrides to `normal` while headings use `tight`.

**The Tabular Rule.** Every column of digits uses tabular figures and right
alignment, so amounts, counts and times line up.

**The Label Rule.** `caption` and `label` share `11px`; a label is separated from
a caption by uppercase treatment and `0.12em` tracking, not by size.

## Layout

Layout primitives are in `packages/tokens/tokens/global.json`. The sidebar rail
is `rail` `220px` (`railWide` `280px`), the column floor is `colMin` `260px`, a
field floor is `fieldMin` `176px`, the reading measure is `measure` `1180px`,
prose is capped at `prose` `68ch`, and the titlebar is `titlebar` `38px`.

Spacing is a seven-step scale: `4px`, `8px`, `12px`, `16px`, `20px`, `24px` and
`32px`. Radii are `xs` `4px`, `sm` `5px`, `md` `7px`, `lg` `9px`, `xl` `12px`
and `round` `999px`.

Stacking order is named rather than numbered, from `under` `-1` through
`ground` `0`, `figure` `1`, `raised` `2`, `docked` `3`, `drawerScrim` `4`,
`drawer` `5`, `panel` `20`, `overlay` `50`, `dialog` `60` to `menu` `70`.

**The Layer Rule.** No surface picks its own stacking order; every `z-index` is
`auto` or one `var(--nx-layer-*)`, and `pnpm check:layers` enforces it.

**The Measure Rule.** A page that reads as rows opts into `--nx-layout-measure`;
a page that reads as a field, such as the week grid or the canvas, does not.

**The Hairline Rule.** On high-density displays the structural edges are drawn
at `0.5px`, so a border is one device pixel rather than two.

## Elevation & Depth

Elevation is carried by tokens in `packages/tokens/tokens/themes/dan.json` and
`noc.json`. Dan is mostly flat at rest: `shadow` is `none`, `elevationRaised` is
`0 1px 2px rgba(34, 30, 24, 0.06), 0 1px 3px rgba(34, 30, 24, 0.05)` and
`elevationOverlay` is `0 24px 60px rgba(34, 30, 24, 0.20), 0 3px 10px rgba(34, 30, 24, 0.10)`.
Noc raises its surfaces: `elevationRaised` is `0 2px 8px rgba(0, 0, 0, 0.32)`
and `elevationOverlay` is `0 20px 56px rgba(0, 0, 0, 0.60), 0 2px 10px rgba(0, 0, 0, 0.40)`.
Noc also sets `materialHorizon` to a gradient between two adjacent night steps,
and both themes carry a `materialEdge` highlight on raised surfaces.

The two substrates are static. `StarField` is generated from a seeded integer
PRNG in `packages/ui/src/material.ts`, so the same sky is drawn on every run, and
neither the sky nor the horizon may sit under body text.

**The Static Material Rule.** The substrates carry no animation, parallax or
pointer response, and both are hidden when the operating system asks for more
contrast.

**The Ground-Not-Figure Rule.** A page header's module mark is a ground: it sits
at `--nx-layer-ground` in `--nx-text-faint` at `0.13` opacity and never competes
with the title.

**The Press Rule.** A button is the only place the product simulates force: on
`:active` it takes `--nx-material-bite` and a `0.97` scale for the duration of
`--nx-motion-fast` `100ms`.

## Shapes

Shapes come from the radius tokens in
`packages/tokens/tokens/global.json`: `xs` `4px`, `sm` `5px`, `md` `7px`,
`lg` `9px`, `xl` `12px` and `round` `999px`.

**The Small-Radius Rule.** Controls use `md` `7px`, cards use `lg` `9px`, and
only pills and scrollbar thumbs use `round` `999px`.

**The No-Glow Rule.** Selection is typographic: no fill, no border and no glow,
with a small brand glyph as the position marker.

**The Typographic Selection Rule.** A selected option is accent text plus
weight. It keys off `aria-pressed` on `.nx-segmented__option`, so the announced
state and the painted state cannot drift.

## Components

The component library lives in `packages/ui/src/components/` with its rules in
`packages/ui/src/styles.css`; the gallery in `apps/gallery` is the review
surface and is not shipped to users.

- **Button.** Uses `--nx-radius-md`, `--nx-space-2` gap, `--nx-font-size-body-sm`,
  `--nx-font-weight-medium`, `7px 14px` padding and a `30px` minimum height. The
  variants are primary (`--nx-accent` on `--nx-bg`), ghost (`--nx-border`),
  danger (`--nx-danger`) and quiet (no border or fill).
- **Card.** Uses `--nx-surface`, a `1px` `--nx-border`, `--nx-radius-lg`,
  `--nx-space-4` padding and `--nx-elevation-raised` with
  `inset 0 1px 0 var(--nx-material-edge)`.
- **Chip.** Uses `--nx-font-size-label`, `2px 9px` padding, `--nx-radius-md`,
  `--nx-surface-alt` and `--nx-text-subtle`, with data, accent and danger
  modifiers.
- **List row.** Uses `--nx-space-2` gap, a `36px` minimum height, `6px 0` padding
  and a `1px` `--nx-border-subtle` divider that the last row drops.
- **Kanban column and card.** A column recesses on `--nx-bg`; a card raises on
  `--nx-surface` with `--nx-radius-md`, `8px 10px` padding and
  `--nx-elevation-raised`.
- **Text field, text area and select.** Share `--nx-radius-md` and the
  `--nx-textfield__input`, `--nx-textarea__input` and `--nx-select__control`
  focus treatment.
- **Charts.** `ChartFrame`, `CellMatrix`, `ProportionBar`, `ColumnPlot`,
  `SeriesPlot`, `SpanLanes`, `RadialCycle` and `ChartLegend` are exported from
  `packages/ui/src/index.ts` and draw only through `--nx-tone`.

**The Shared-Control Rule.** A field goes through `TextField`, `Select` or
`TextArea`; a hand-rolled input is a defect the gates can name.

**The Column Floor Rule.** A board column never shrinks past
`--nx-layout-col-min` `260px`; below that the board scrolls sideways rather than
squeezing a card narrower than it can be read.

**The One Mark Rule.** A page header carries exactly one 72px module mark, at
the trailing corner, behind the title.

## Do's and Don'ts

- Do copy a value from `packages/tokens`; don't write a raw `#hex`, `rgb()` or
  `hsl()` outside it.
- Do name a stacking layer; don't pick a numeric `z-index`.
- Do let a chart carry three roles at most; don't add a fourth hue for a second
  series.
- Do keep the two themes as one token set; don't fork a component per theme.
- Do let a selection be typographic; don't mark it with a fill, a border or a
  glow.
- Do set numbers with tabular figures; don't let a column of digits wobble.
- Do honour reduced motion from the one product-wide rule; don't slow an
  animation instead of disabling it.
- Do keep texture off content; don't place the star field or the horizon under
  body text.
