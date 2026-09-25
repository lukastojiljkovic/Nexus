# ADR-079 — CANV's engine: Excalidraw as a canvas, not as a UI

**Status:** accepted (2026-08-01) · **Owner:** supervisor · **Implements:** the
PRD's „Infinite Canvas (CANV) — Should": *a Milanote-style boundless board where
notes become cards you arrange spatially, with links drawn as arrows — and it
works offline (the market gap). Engine chosen via scored spikes (tldraw vs
Excalidraw vs custom).* **Founder decision (2026-08-01):** *„Excalidraw ako je
moguće"* — an explicit, scoped exception to the repo's no-new-dependency rule,
for this one library and this one module, conditional on a spike.

## 1. Verdict: GO WITH CONDITIONS

The spike (2026-08-01) read the published `@excalidraw/excalidraw@0.18.1`
tarball — the shipped `dist/prod` bundle, CSS and type declarations — rather
than the documentation, which is thin and partly stale. Nothing was installed.

Against the four conditions the founder's answer was made conditional on:

| Condition | Result |
|---|---|
| React 19 | **Pass.** Peers are `^17.0.2 \|\| ^18.2.0 \|\| ^19.0.0` — not a peer-range lag. Uses only `flushSync`, `createPortal`, `unstable_batchedUpdates`, all present in our `react-dom@19.2.8`. No `findDOMNode`, `defaultProps`, `propTypes`. |
| Zero network | **Pass, by CSP rather than by config** — see §2. |
| Licence | **Pass.** MIT, © 2020 Excalidraw. One obligation: reproduce the notice. No copyleft, no badge, no UI attribution. |
| No `unsafe-eval`, no raw hex in our `src` | **Pass on both** — see §3, §5. |

So it is possible, and we take it. But the spike found two things that are not
bugs and not negotiable, and they reshape *how* we take it.

## 2. Offline is guaranteed by the CSP, not by the setting

`EXCALIDRAW_ASSET_PATH` does **not** remove the CDN. `createUrls`
unconditionally appends `https://esm.sh/@excalidraw/excalidraw@0.18.1/dist/prod/`
to every font path; the setting only *prepends* a local source. Because these
are `FontFace` source lists, the remote source is tried whenever the local one
fails.

That is exactly why the guarantee must live somewhere else: our `font-src
'self' data:` makes the fallback **unreachable by construction**. The
configuration is an optimisation; the CSP is the promise. `font-src` is
therefore never widened beyond `'self' data: nx-asset:`, and that line is the
one to defend in review.

**One real leak, closed explicitly:** the SVG export path fetches fonts with its
own fallback loop and, when both sources fail, *writes the esm.sh URL into the
exported file as a live `@font-face`*. A user's exported drawing would phone a
CDN on every open, on someone else's machine, forever. Every export passes
`skipInliningFonts: true`.

Fonts are 14 MB in total but **~500 KB excluding the CJK Xiaolai family**, and
they register eagerly while fetching lazily per family.

## 3. The CSP survives intact

`eval`: **zero occurrences**. `new Function` (×2) and `WebAssembly.instantiate`
(×4) exist only in a chunk imported solely by the two dynamically-imported font-
subsetting chunks — never on the render path. **Nothing forces `unsafe-eval` or
`wasm-unsafe-eval`,** and `script-src` stays `'self'`. Workers are same-origin
module workers with a caught main-thread fallback, not `blob:`;
`URL.createObjectURL` is never called. The only widening is `nx-asset:` on
`font-src`.

## 4. Ruling D-1 — the canvas ships with **our** chrome, in Serbian

**The finding:** Excalidraw ships 54 locales and **none is Serbian**, and we
cannot add one. The loader is a closed, hard-coded import map baked into the
bundle, and the package exports only `defaultLang`, `languages`, `useI18n` —
`setLanguage` is not even re-exported, so pushing onto `languages` yields a
language code with no map entry that silently falls back to English.

Every toolbar tooltip, context menu, dialog and error message inside the canvas
would be **English inside an otherwise entirely Serbian app**.

**The ruling:** this needs no founder decision, because two binding rules
already decide it — *„all user-facing copy is Serbian"* and *„the app must never
read as AI slop"*. An English toolbar dropped into a Serbian product is the
precise seam that second rule exists to prevent, and the founder's standing
instruction for this run was *„sve mora da biti maksimalno ispolirano"*.

So: **`zenModeEnabled`, and we build the toolbar ourselves** on the imperative
API. Excalidraw becomes a canvas engine, not a user interface.

This is the cheap direction, not the expensive one. The hard part of a canvas is
the engine — freedraw smoothing, arrow binding and reflow, selection and
transform handles, text editing, undo/redo, hit-testing, export — and that is
exactly the part we keep. A toolbar is buttons we already know how to build with
our own tokens, our own strings and our own keyboard conventions. It also
resolves two further problems for free: the banned-hue palette (§5) and the
default Help dialog's links to `plus.excalidraw.com`, which is third-party
chrome inside a commercial product and has no trademark grant behind it.

## 5. Ruling D-2 — the built-in colour picker never ships

`DEFAULT_ELEMENT_STROKE_COLOR_PALETTE` and its background twin include
**`violet`, `blue` and `orange`** as user-facing swatches — three banned hues,
in the one place a user picks colours. There is no palette prop: the entire
`UIOptions` surface is `{dockedSidebarBreakpoint, canvasActions, tools:{image}}`,
and the constants are not runtime-importable because the `exports` map exposes
those subpaths as types only.

With §4's ruling the picker is already gone, and ours offers the eight-accent
Nexus palette instead. Nothing about this needs a deviation record.

**The one that would have slipped through:** `--color-primary` defaults to
`#6965db` — Excalidraw violet — and paints **every selection ring and focus
ring** on the canvas. All 209 of its CSS variables are scoped to `.excalidraw`
rather than `:root`, so a single `.excalidraw { … }` block restates them from
`--nx-*` tokens, and element defaults are read with
`getComputedStyle(…).getPropertyValue("--nx-ink")`. No hex enters our source.

**A letter-versus-spirit gap worth recording:** the raw-colour grep is scoped to
`apps/*/src` and `packages/*/src`, so the bundled CSS's 210 hex, 35 `rgb()` and
6 `hsl()` literals in `node_modules` do not trip it. The gate stays green
honestly — our source really will contain no colour — but the gate is not what
is keeping the banned hues off screen here. The `.excalidraw` override block is,
and it deserves review attention accordingly.

## 6. Nexus objects on the board — better than expected

`customData?: Record<string, any>` sits on the element base, so **every**
element can carry a Nexus reference and it survives the JSON round-trip.
`renderEmbeddable` **fully replaces** the iframe, and arrows bind to embeddables
so they reflow when a card moves — which is precisely the „notes become cards,
links become arrows" the PRD asks for.

**A trap to encode as a rule:** the call site is
`(isEmbeddable(el) ? renderEmbeddable?.(el, state) : null) ?? <iframe …>`. A
nullish return **falls through to a real iframe**. `renderEmbeddable` must
therefore *always* return an element — never `null`, never `undefined` — and
`validateEmbeddable` is restricted to the Nexus scheme. Rendering a live iframe
inside a sandboxed renderer is not a cosmetic failure.

Known limits, accepted: cards are DOM overlays and will not export sensibly to
PNG/SVG; performance scales with card count; rectangles only; card text is
invisible to Excalidraw's own search; and pruning a dangling
`customData.nexusRef` when its note is deleted is our problem, not the library's.

## 7. Persistence — fully controlled

`serializeAsJSON` / `restore` / `restoreElements` / `restoreAppState` /
`convertToExcalidrawElements` are all exported, and `initialData` accepts a
promise, so a scene can await IPC. It writes **two localStorage keys only**
(`publish-library-data`, `mermaid-to-excalidraw`), both inside optional dialogs
we make unreachable, both `try`/`catch`-wrapped. `indexedDB`, `sessionStorage`
and `serviceWorker`: **zero occurrences each**. The scene is a value we hand in
and get back, exactly as the encrypted-SQLite-in-main architecture requires.

`onChange` fires per pointer-move — debounce against `getSceneVersion()` or the
write path will melt.

## 8. Conditions of the GO

1. `font-src` never widened beyond `'self' data: nx-asset:`.
2. `EXCALIDRAW_ASSET_PATH` set to an absolute scheme URL before first import,
   with a smoke assertion that fonts resolve locally.
3. Every export passes `skipInliningFonts: true`.
4. `script-src` stays `'self'`.
5. `renderEmbeddable` always returns an element; `validateEmbeddable` restricted
   to the Nexus scheme; `aiEnabled: false`; Publish-library and Mermaid dialogs
   unreachable.
6. UI colours restated from `--nx-*` in a `.excalidraw`-scoped block, including
   `--color-primary`.
7. `zenModeEnabled` with our own Serbian toolbar (§4).
8. The eight bundled font licences reviewed and their notices added to the
   licence screen — the spike did **not** verify them and assumed OFL-family.
9. Transitive dependency count and `pnpm audit --prod --audit-level low` checked
   **before the lockfile is committed** — see §9.

## 9. The two open risks, not rounded to confidence

- **`security.yml` runs `pnpm audit --prod --audit-level low`, which blocks on
  every severity with no ignores permitted.** Excalidraw has 31 direct runtime
  dependencies (27 actually imported). The spike could not count transitives
  without installing, so „60+" is an estimate, not a measurement. If any
  transitive carries even a low advisory, CI blocks and the founder gets a
  decision he has not yet been asked for. This is discovered at install time and
  must be the *first* thing the CANV lane reports.
- **The `file://` plus custom-scheme font load is reasoned from code, not
  observed.** It mirrors what `nx-blob` already does for images, so it should
  hold, but it is the highest-risk assumption in the plan and gets smoke-tested
  before anything is built on it.

Lesser unknowns, recorded honestly: module workers may not construct under
`file://` (non-fatal — there is a caught fallback), and how `renderEmbeddable`
cards degrade in image export was read at the call site, not run.

**One incidental finding worth knowing:** `@excalidraw/mermaid-to-excalidraw` is
loaded by a dynamic bare import from the **paste handler**, not only from the
Mermaid dialog — so it ships in our build and loads on a paste we never
initiated. Local code, no network, harmless; but „a paste triggers a chunk load"
is the kind of thing that should not be discovered during a bug hunt.

## 10. Weight

No bundled React, and its dependencies are external — Vite resolves `clsx`,
`roughjs`, two `@radix-ui/*`, `jotai`, `open-color` and the rest. Eager JS is
**967 KB raw / ~316 KB gzip** plus 145 KB CSS; the 1.8 MB WASM chunk is lazy and
never loads on our path. No native modules, no postinstall, plain ESM, and
**zero `process.env` / `import.meta.env` references** — no shim needed.

---

## 11. What slice a OBSERVED (2026-08-01, `8993fce`) — where reality differed

Everything above §10 is the spike: read from a tarball, reasoned, not run.
Slice a installed it and measured. Four things came out differently, and one of
them is the difference between a rule and a habit.

### 11.1 The CSP was never touched — condition 1 is superseded

Fonts resolve from the built page's **own directory**
(`new URL("./excalidraw-assets/", location.href)`). `script-src` stays `'self'`,
`font-src` stays `'self' data:`, and the configuration array is **byte-identical
to before this module existed.** The `nx-asset:` widening conditions 1 and 2
were written around is not needed and is not taken.

**And the `nx-blob` precedent would not have worked.** The spike assumed the
image pattern transfers. It does not: a CSS font fetch is always CORS-mode, and
Chromium refuses a custom scheme outright — so `font-src nx-asset:` would have
been a widened policy that still failed. The route that works is the one that
needs no policy at all. Risk §9's second bullet is closed: it was observed, and
the reasoning it replaced was wrong in a way that mattered.

The esm.sh fallback still gets appended to every `FontFace` src list and **never
becomes a request** — the CSP filters the candidate list at activation time,
observed even for fonts that loaded successfully. The cost is ~230 console
violations a session naming esm.sh: noise, not failure, unremovable short of
patching upstream, and commented so nobody goes hunting.

### 11.2 The audit risk materialised, and the rule it hit was misquoted — by me

§9's first bullet was right: `pnpm audit --prod --audit-level low` blocked, on
five advisories out of Excalidraw's tree, and so did `audit-toolchain.mjs`.

Both now exit **0**, and the reason is the whole point: **the vulnerable
versions are gone, not silenced.** Two `pnpm` overrides do it — `nanoid`
to `^3.3.16` (Excalidraw pins exactly `3.3.3`, so ordinary resolution could
never have fixed it) and `lodash-es` to `^4.18.1` (the advisory's "patched
4.17.24" **does not exist**; the registry goes 4.17.23 → 4.18.0 → 4.18.1).
`pnpm why` lists only the fixed versions.

**The correction.** I told the founder that `pnpm-workspace.yaml` forbids
growing the override list, and framed the decision as a rule to be weighed. It
forbids nothing. The "must never grow" sentence lives in
`.github/workflows/security.yml:44` and is about `pnpm audit --ignore` and
`auditConfig.ignoreGhsas` — about **silencing an advisory**, never about
overriding a version. So the option I argued against was the one no rule
touches, and the option I had been treating as available is precisely the one
the rule forbids.

The yaml header is rewritten around the distinction that was always intended:
**an override may REMOVE a vulnerable version and may never quiet a warning, and
the mechanical test is that `pnpm why` stops listing it.** `ignoreGhsas` is now
forbidden in writing rather than by folklore. Two stale claims in that header
went with it — that every path below runs through electron-builder, and that all
three entries are build-time only; neither survives two SHIPPED dependencies.

### 11.3 Fonts: 25 files, 0.44 MB

Xiaolai is dropped **at the copy step** rather than patched out of the package:
209 of 234 files and 12.67 MB of 13.11 MB, a CJK fallback a Serbian product has
no use for. Shipped fonts are **25 files / 0.44 MB**. (§2's "~500 KB excluding
CJK" was close. My own brief said ~0.13 MB — MB/MiB slippage on my part, and the
founder was given the wrong figure before this measurement corrected it.)

### 11.4 Mermaid stays — founder decision, and condition 5 is amended

Condition 5 said the Mermaid dialog is made unreachable. The founder overruled
that: *„šta gubimo ako izbaciš mermaid, jer mermaid nam treba i za dev tools,
ako neki dev hoće svoju bazu da napravi u dijagram"* — and he is right about the
use. It produces **editable** Excalidraw shapes, which is exactly the
diagram-then-tidy-by-hand case, and Nexus has no other mermaid anywhere.

What is suppressed is not the feature but its **trigger**. §10's incidental
finding was the real defect: pasting any text beginning `graph`, `pie`, `gantt`,
`journey`… dynamic-imported 3.35 MB and silently transformed the paste, so a
note starting with the word „graph" surprised the user while nobody ever
discovered the feature on purpose. `onPaste` now intercepts exactly those pastes
and drops the text in as text; the conversion is a deliberate action.
`MERMAID_KEYWORDS` is a copy (`isMermaidDefinition` is not exported) and a test
greps the **installed bundle** for the exact literal array, so an upstream
addition fails a test instead of quietly reopening the paste path.

The cost, stated plainly: ~9.9 MB of lazy mermaid chunks ship in the installer.
They load only when a diagram is actually converted, but they are on disk.

### 11.5 Three assumptions the lane refused to take on trust

- **The library sidebar cannot be replaced.** `DefaultSidebar` renders
  `LibraryMenu` unconditionally and only *appends* host children, so the panel
  cannot be removed from the tree. Publishing is made unreachable by redirecting
  the tab to canvas search, and the three sidebar name literals are asserted so
  an upstream rename fails loudly rather than silently reopening the dialog.
- **The storage surface is read out of the shipped bundle** and pinned at
  exactly two localStorage keys, with zero `indexedDB`, `sessionStorage` and
  `serviceWorker` — §7 verified against the artefact rather than the tarball.
- **`dist/prod` is named explicitly** everywhere the package is inspected,
  because `require.resolve` picks `dist/dev` under Vitest — a test that read the
  dev bundle would have been asserting about code we never ship.

### 11.6 Two autosave defects, found while writing it

`initialData={loadScene(id)}` fired an IPC read on **every re-render** — every
keystroke in the name field, every error banner — because `initialData` takes a
promise and a promise is a value the render creates. And the debounce dropped up
to 800 ms of drawing when switching boards or leaving the page. Both fixed, the
second by flushing synchronously on either exit.

### 11.7 Measured weight

Renderer **218 files / 18.16 MB**; eager chunk **5.97 MB** (Excalidraw is
+1.67 MB of it — it is in the eager chunk, and `React.lazy` would defer it);
largest lazy chunks `subset-shared` 1.84 MB, `cynefin` 1.30 MB, `cytoscape`
0.96 MB.

### 11.8 Still open at slice a

**Condition 8 — the eight bundled font licences — is NOT done.** The spike did
not verify them, slice a did not either, and "assumed OFL-family" is the exact
shape of claim this project does not ship. It is a release blocker, not a
nice-to-have: the product is commercial and closed-source, and a permissive
font licence's one real obligation is the notice.

**Closed 2026-08-01 by [ADR-080](080-third-party-notices.md)** (`29bb6c7`), and
the answer was not the one this section expected: seven families resolve from
their own files, and the eighth — **Liberation Sans** — cannot be established at
all, so it is **dropped** rather than documented. It costs nothing: the package
marks it `serverSide: true` and the font picker filters exactly those, so no
element could ever be set to it. Shipped fonts: **24 files / 0.35 MB.**

---

## 12. What slice b OBSERVED (2026-08-01, `3f12a03` + `278e6ad`)

§4 and §6 were rulings made from a tarball. Both survived contact; three details
did not.

### 12.1 §4 holds, and slice a's own hiding rule was wrong

The chrome comes off and our Serbian toolbar replaces it, exactly as ruled. But
slice a's temporary CSS named three selectors of which **two were redundant**
(`.App-toolbar-container` and `.App-menu` are already inside
`.layer-ui__wrapper`) while `MobileMenu` — `.App-top-bar` / `.App-bottom-bar` —
is a **sibling** of that wrapper and was not covered at all. Chromeless mode
would have shown Excalidraw's own toolbar at any width below its mobile
breakpoint. The rule is now the three that are actually load-bearing.

**Why the mermaid dialog survives is structural, not lucky.** Every dialog is
portalled onto `document.body` (`useCreatePortalContainer` with no
`parentSelector`), so a rule rooted at `.canv__surface` *cannot* reach one.
Three bundle-reading tests pin that, plus the `openDialog.name === "ttd"`
trigger our own button sets.

### 12.2 What the imperative API cannot drive — the list §4 did not have

§4 said a toolbar is "buttons we already know how to build". True, but not all
of them: `ExcalidrawImperativeAPI.history` exposes only `clear`, and
`registerAction` only *adds* an action — **there is no way to RUN a named one.**
So undo, redo, delete, duplicate, group and layer order have no button and
cannot have one. They stay on the keyboard and in the editor's own right-click
menu, which is therefore deliberately left standing.

`zoomCanvas` is likewise on the App class and not on the imperative API, so zoom
goes through `updateScene` with a restated centre-preserving `getStateForZoom` —
zoom without the scroll half pins the top-left corner and the drawing slides
away. Three upstream internals are restated for `MERMAID_KEYWORDS`' reason (the
values are not exported), each pinned by a bundle-reading test.

**The rule that came out of it:** where the API has no route, the control is
**absent**, never dead. A button that does nothing is worse than a missing one.

### 12.3 §6's `customData` is not where a card's identity lives

§6 read `customData` and concluded a card would ride there. The call site says
otherwise: an embeddable is handed to `renderEmbeddable` and validated by its
**`link`**, a plain string. So the reference is a `link` — `nexus://<kind>/<id>`
— and `canvasRef.ts` is the grammar that decides whether one is ours.

§6's trap is confirmed and is the load-bearing fact of the whole module:
`(isEmbeddable(el) ? renderEmbeddable?.(el, state) : null) ?? <iframe …>` means
a **nullish return draws a real iframe**. The predicate is therefore a security
boundary inside a sandboxed renderer, which is why the scheme is one this app
owns and deliberately does **not** register (`nx-blob` and `priv-blob` are the
two it grants) — even the fall-through can load nothing, because there is no
handler and `default-src 'self'` has no frame source for it.

### 12.4 The private-notes gate is the schema's, not a check we added

Resolving a reference to a title crosses into `notes`, `tasks` and `events`, so
it could have been a new way to read a **private** note. It cannot be: migration
045 keeps a private note in its own table — sealed bytes, no title column, no
FTS row, no search projection — and gives it no row in `notes` at all. There is
nothing to gate. A test seeds a real sealed row, asks for its id as all three
kinds, asserts three misses, and then asserts the sealed row is still there, so
the miss is the gate rather than an empty table.

### 12.5 Two defects the slice found in slice a

`onPaste` fed `getSceneElements()` back into `updateScene`, which **replaces**
the element list — so a mermaid-shaped paste silently dropped every tombstone
and broke undo of any prior deletion. And `changeViewBackgroundColor` was still
`true` while its only control lived in the now-hidden left island, advertising a
capability nothing could reach.

### 12.6 Conditions, restated after contact

Conditions 1 and 2 are **superseded** (§11.1: no CSP change at all, and the
`nx-asset:` route would not have worked). Condition 5's "Mermaid dialogs
unreachable" is **amended** by founder decision (§11.4). Condition 8 is **closed**
by ADR-080. Conditions 3, 4, 6 and 7 stand and are met.

---

## 13. What slice c OBSERVED (2026-08-01, `90d2695`) — cards on the board

§6 was read from a tarball and was right about the mechanism. Three of its
details were wrong, and each was corrected against the installed bundle rather
than argued about.

### 13.1 `link`, not `customData` — §6 named the wrong field

§6 read `customData` and concluded a card would ride there. It cannot, and the
reason is the same one that makes §6's trap load-bearing: **`validateEmbeddable`
is handed the LINK and nothing else.** A reference in `customData` would mean the
predicate deciding "will this app draw it itself, or does it become an iframe"
reads a different field from the one the card is built out of — and the security
argument collapses at exactly that seam. Two further facts settle it: the
editor's own hyperlink popup can rewrite an embeddable's link and re-runs
validation when it does, while never touching `customData`; and `restore`
normalises the link through `sanitizeUrl` on every board open, which
`nexus://note/<uuidv7>` survives byte-identical while `javascript:` becomes
`about:blank`.

`customData` is therefore **absent, not empty**. One field, one spelling, one
predicate.

### 13.2 The foreign case is NOT the iframe case

§6 implied a rejected link becomes an iframe. It does not:
`renderEmbeddables()` filters to elements whose `embedsValidationStatus` is
`true`, so a link `validateEmbeddable` rejected is never handed to
`renderEmbeddable` **and never becomes an iframe** — no overlay is mounted at
all. The refusal is structural.

The refusal card is still built, and now says honestly what it is for: validation
is computed **once per element id** and cached (`if (!embedsValidationStatus.has(id))`),
so an approved id whose link later changed is the one window the cache admits.
Defence in depth for a narrow case, stated rather than left as a `null`.

### 13.3 `convertToExcalidrawElements` will not build an embeddable

Its transform has a factory per element type — but its
`case "freedraw": case "iframe": case "embeddable"` arm is verbatim
pass-through, with only the id regenerated and the fractional index synced
afterwards; its skeleton type says the same by admitting the *whole* element for
those kinds. So the card element is built COMPLETE before that helper sees it. A
half-built skeleton would land in the scene without a `version` — the field
`getSceneVersion` sums, which is the autosave's entire guard.

### 13.4 The two-click gesture is the editor's

An embeddable's DOM is inert (`pointerEvents` off) until `appState.activeEmbeddable`
names it `"active"`, which a short click in its middle third does after hovering
marks it `"hover"`. So a card takes one click to arm and a second to press.
Fighting that would mean intercepting pointer events on the canvas, which is the
editor's own input pipeline. What IS replaced is the hint: upstream's
`buttons.embeddableInteractionButton` is English, so it is hidden and the card
draws the Serbian one off the same state — the trade the whole toolbar already
makes.

### 13.5 The picker inherits the module gate, which is why it reuses search

A `SearchResult` carries `kind`, `entityId`, `title` and `contextDate` — the
whole of a reference plus everything a card draws — so „Dodaj karticu" needed no
channel of its own. The consequence that matters is not convenience:
`searchGate.ts` filters every hit **in main**, on the one path all three search
channels take, so a profile with a module switched off cannot be offered one of
its objects here. A picker with its own read would have had to restate that rule,
or quietly not have it.

### 13.6 What the mechanism costs, recorded rather than discovered

A card is a DOM overlay positioned above the canvas, not something drawn into it.
So: it will not appear in a PNG/SVG export of the board; its text is invisible to
Excalidraw's own canvas search, which indexes text elements; and the cost scales
with the number of cards on screen, bounded by the store's existing
500-reference ceiling. `missing` cards are **never** pruned automatically — a
note being deleted is not a reason for Nexus to take something off somebody's
board — so a dangling reference is a card that says so and offers removal.

**No migration and no interchange bump**, and that is a decision: a scene is
stored verbatim as one JSON document, so a board with cards is the same column,
the same validator and the same archive entry as a board without. Slice c adds a
kind of element, not a kind of storage.

### 13.7 Known gaps, non-blocking

Card titles refresh when a board opens and when the set of references changes —
**not** when an object is renamed while the board stays open. Re-resolving on
window focus is the cheap fix. Card size is fixed at insert (260×132) and
user-resizable afterwards; there is no fit-to-content.
