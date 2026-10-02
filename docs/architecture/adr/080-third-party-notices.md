# ADR-080 — Third-party notices: generated from disk, never written

**Status:** accepted (2026-08-01, `29bb6c7`) · **Owner:** supervisor ·
**Closes:** [ADR-079](079-canvas-engine.md) condition 8, which was the last
release blocker the canvas engine left open ·
**§1 SUPERSEDED by [ADR-087](087-apache-2.0-open-source.md)** (2026-10-02)

> Only the premise changed. §1 called Nexus a commercial, closed-source product;
> it is now Apache-2.0, and the repository becomes public at the first release
> (step 12 of `docs/OPEN-SOURCE-READINESS.md`). **The obligation this ADR
> describes is untouched** — MIT, BSD, Apache-2.0 and the OFL require the notice
> to travel with the distribution whatever the distributor's own licence is — so
> the generator, the scoping rules, the font invariant and the „Licence" screen
> all stand exactly as decided below. The wording inside §1 is left as written,
> because an accepted ADR is not rewritten; ADR-087 records the change.

## 1. Why this exists at all

Nexus is a **commercial, closed-source** product that ships other people's code:
React, TipTap/Yjs, `better-sqlite3-multiple-ciphers`, Electron, Excalidraw — and,
since CANV, a set of **font files copied into the installer**.

MIT, BSD, Apache-2.0 and the OFL are all permissive: no copyleft, no source
disclosure, no badge. They impose exactly one obligation that actually binds a
product like this — **reproduce the notice, and let it travel with the
distribution.** Until now the product reproduced nothing, and one part of it was
worse than unpaid: the eight bundled Excalidraw fonts were *assumed* to be
OFL-family and never checked. „Assumed" is the exact shape of claim this project
does not ship.

## 2. The decision: a generator, not a document

`apps/desktop/scripts/generate-licences.mjs` reads every notice off disk and
writes `src/renderer/src/data/licences.json` wholesale. **No character of a
licence is ever typed.**

The reason is not tidiness. A hand-written notices page pays the obligation once
and then rots at the next `pnpm update`, and a retyped notice can be subtly
wrong — which is worse than a missing one, because it *looks* paid. Reading is
also the only way the claim can be re-checked by anybody later.

**Scoping rule — what a user receives, and nothing else:**

1. Every transitive **production** dependency of `@nexus/desktop` as
   `pnpm licenses list --prod --json` reports it. That app is the only one
   packaged; `@nexus/gallery` never ships. Deliberately over-inclusive: a module
   Vite tree-shakes out still gets its notice, because proving per-module absence
   is not something a build can honestly assert.
2. **Minus** `@types/*` — declarations are erased by the compiler and reach no
   artifact. The one exclusion where absence is provable.
3. **Minus** the `@nexus/*` workspace packages, which are ours.
4. **Plus** the Electron runtime. It is a devDependency, so rule 1 misses it, yet
   electron-builder copies the whole runtime into the installer: it demonstrably
   ships, so it demonstrably owes a notice.
5. **Plus** the font families `electron.vite.config.ts` copies. They are files in
   an installer, not npm packages, and nothing in the dependency graph knows they
   exist.

Build and test tooling is excluded: it never reaches a user. **320 packages.**

`pnpm licenses` is used because it is already there — no licence-scanning
dependency was added to write a page about dependencies.

## 3. Where a font's notice comes from

**Excalidraw ships no licence file** — not for itself and not for any of its
fonts — and neither does its upstream repository at `v0.18.1`. So the notices are
read out of the shipped `.woff2` binaries themselves: WOFF2 header → table
directory → brotli blob → the OpenType `name` table, where ID 0 is the
copyright, ID 5 the version, ID 13 the licence text and ID 14 the licence URL.

That is the strongest source available: the notice is **inside the file that
ships**. Where a family declares the OFL but carries no copy of it, the text is
taken from `Virgil-Regular.woff2`'s own name table — verified byte-identical to
the copy embedded in `fonts/Excalifont/index.ts`. Two independent copies inside
the same package agreeing is evidence; boilerplate from memory is not.

Every entry records the exact file every character was read from.

## 4. Liberation Sans is DROPPED — the finding this work existed to make

Of the eight families, seven resolve cleanly. The eighth does not:

- ID 0 is `Digitized data \`2007 Ascender Corporation. All rights reserved.`
- ID 13 is only a **pointer**: *„subject to the license agreement under which you
  accepted the Liberation font software"*
- ID 14 points at `ascendercorp.com/liberation.html`, which is dead
- The version is `Version 1.05` / `FontForge 2.0 : … : 12-1-2009` — the
  **Ascender-era 1.x line**, whose terms are *not* the SIL OFL that Liberation
  2.x carries

Applying today's `liberationfonts` licence to a 2009 binary would be a guess.
The lane refused to write it down, which was right.

**And the decision needs no founder call, because it costs nothing.** The
package's own metadata marks the family `serverSide: true`, and the font picker
filters exactly those (`!metadata.serverSide && !metadata.fallback`) — no element
can ever be set to it. It exists for Excalidraw's own server-side export
renderer, which an offline desktop product does not have. A font nobody can
select and no notice can be written for has no reason to be in an installer, and
the founder's standing condition for taking Excalidraw at all was *a licence with
no attribution obligation for a commercial closed-source product* — which an
**unestablished** licence cannot satisfy.

Dropped the same way Xiaolai is: in the copy step (`DROPPED_FAMILIES`), never by
patching the package. Shipped fonts are now **24 files / 0.35 MB, seven families,
every one established from a file.**

`generate-licences.mjs` and `excalidrawSurface.test.ts` both READ
`DROPPED_FAMILIES` out of `electron.vite.config.ts`, so neither the notice list
nor the file-count assertion can drift from what the build actually copied. That
mattered immediately: the surface test had excluded Xiaolai *by name*, so it
stayed green while describing a build that no longer existed.

## 5. A gap is recorded, never rounded away

`status` is the honest half of the data, and it has three values:

- **`file`** — the text was read from a file that exists.
- **`declared-only`** — the package states a licence id in its own manifest and
  ships no copy of it. **38 entries**: 35 `@radix-ui/*` (pulled in by
  Excalidraw), Excalidraw itself, `lazy-val`, `react-remove-scroll-bar`. The id
  is reproduced, because a manifest declaration is the copyright holder's own
  statement; the text is not invented; and the screen says which it is.
- **`unknown`** — nothing on disk establishes a licence. `khroma` is the mirror
  image and shows the rule works both ways: it declares no id but ships a real
  MIT file, so it lists as `UNKNOWN` with the full text.

**One invariant is a policy rather than a shape check, and it belongs to the
fonts alone:** a dependency arrives with whatever licence its author gave it, but
a bundled font is a file this build *chose* to copy. „We ship it and cannot say
under what terms" is a state this product may not reach. A future Excalidraw
upgrade that adds an unreadable family fails a test, and the fix is a decision —
establish the terms, or drop the family — never a regeneration.

## 6. Why the test is not a regeneration test

The stronger test — regenerate and diff — cannot run in Vitest: the generator
shells out to `pnpm licenses`, needs a full production store and about twenty
seconds, none of which a test run may assume. So the suite asserts the file's own
invariants instead, chosen to catch what a regeneration test would have: an entry
without a version or a licence id, a duplicate key, an unsorted file, an
un-normalised notice, an entry **claiming a notice it does not carry** (the
load-bearing one), and the exact font-family set. Run
`pnpm --filter @nexus/desktop licences` after any dependency change.

## 7. The screen, and the one thing it costs

„Licence", last on the Settings page after „O aplikaciji", registered in
`settingsSearch.ts` for SET-014. Two groups behind the page's own disclosure
idiom — Biblioteke (320, collapsed) and Fontovi (7, open) — each row `name ·
version · licence`, expanding to its notice inside a named, focusable scroll
region so nothing widens the page.

**The data is fetched, not imported.** 650 KB of licence text in the eager
renderer chunk would be paid at startup by every session to serve a screen most
people open once; `import()` gives it a chunk of its own that arrives when
Settings opens. Measured: the eager bundle stays at ~5.98 MB and the notices sit
in a 644 KB chunk beside it.

Electron's own caption states what the list cannot: Chromium and Node.js ride
*inside* the runtime and their notices ship as `LICENSES.chromium.html` beside
the executable. ~~**Unverified against a real installer.**~~ — **verified
2026-08-02** on the first real `pnpm --filter @nexus/desktop dist` run:
`release/win-unpacked/` contains `LICENSES.chromium.html` (19.4 MB) beside
`LICENSE.electron.txt` and `Nexus.exe`. The caption is a claim the product is
entitled to make.
