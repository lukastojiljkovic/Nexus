# CLAUDE.md — Nexus project working agreement

Project-specific rules for Claude on **Nexus**. These sit on top of the global
`~/.claude/CLAUDE.md` (user identity, communication style, general git rules) and
add what is specific to this repository. When the two agree, follow both; when
this file is more specific, it wins.

Nexus is Luka's offline-first, all-in-one life-management platform, licensed
under Apache-2.0.

## Read these before touching anything

| | |
| --- | --- |
| Where the project is, and what is left | [docs/STATUS.md](docs/STATUS.md) — §1 for state, §4 for the queue |
| What Nexus is, in everyday language | [docs/OVERVIEW.md](docs/OVERVIEW.md) |
| What Nexus will be | [docs/SPECIFICATION.md](docs/SPECIFICATION.md) and [docs/VISION.md](docs/VISION.md) |
| In what order | [docs/roadmap.md](docs/roadmap.md) |
| Every other document, and which are live | [docs/README.md](docs/README.md) |

**The docs are version-controlled with the code, in public.** They entered git
on 2026-09-26, reversing the 2026-07-04 decision that kept them local-only.
Seven working documents that described security posture or unreleased product
were moved out on 2026-10-02, before the repository was published;
[docs/README.md](docs/README.md) says which and why. What remains is written to
be read by anyone, and a dated record that no longer describes the present is
kept as evidence rather than deleted.

## Current focus (2026-08-31 — the founder changed it; supersedes 2026-08-08)

*„web/sync je za sada trajno na hold-u, dok ne završimo sve feature za desktop,
lako ćemo ih posle portovati na sajt jer je electron osnova."*

**Every remaining DESKTOP feature comes first.** The web app, the Supabase
backend and pairing are **on hold** — not cancelled, and not to be treated as
dead code: everything already built for them (`sync-crypto`, `sync-transport`,
`sync-engine`, `sync-port`, the 14 server migrations, the desktop sync round and
scheduler) stays built, stays tested, stays green in CI, and stays OFF by
default. Nothing new is added to it until the desktop is complete.

The founder's reasoning is worth keeping because it is the load-bearing part:
the renderer is one React codebase and Electron is only its shell, so a feature
finished on the desktop is a feature the web app inherits. Building the web
surface first would mean building each feature twice.

The section below is the 2026-08-08 phase, kept because the *architecture* it
fixes — the three keys, the ciphertext-only server, cloud off by default, the
pairing exchange — is still the plan of record for when web resumes. What has
changed is only its **place in the queue**.

---

The desktop app reached **1.0.0**. The founder had opened the phase:
*„resi sve sto je ostalo… da bude clean slate potpuno, i onda da pripremis back
i front za sajt… supabase za backend… da se pripremi sync desktop app i webapp,
da bude ful usluga."*

1. **Clean slate first.** Everything recorded as unfinished gets finished, and
   any defect met on the way gets fixed, before web work is called done.
2. **Web app + backend** — *on hold since 2026-08-31, see above.* Frontend from
   the *same* React codebase on **Cloudflare Workers with static assets**
   — deliberately **not**
   GitHub Pages, which cannot set HTTP response headers and therefore cannot
   send a CSP or `frame-ancestors`; a page that decrypts user data in a browser
   without a CSP has had its primary defence removed. Workers rather than
   Cloudflare Pages because Cloudflare's own docs now say new projects should
   start on Workers — Pages stays supported but gets no further investment —
   and `_headers`/`_redirects` work identically on both. Backend is **Supabase**.
3. **Sync, end-to-end encrypted.** The server holds ciphertext. Metadata in the
   clear is accepted; content never is.
4. **On the desktop, cloud is OFF BY DEFAULT and switchable off entirely.** A
   user who never turns it on must be in exactly the product 1.0.0 is: no
   network calls at all. This is a structural guarantee, not a promise — the
   local-only path must not be *able* to reach the network.
5. **Pairing is by code.** The web account issues a code, the user types it into
   the desktop, and the two link. **The code must never be a bearer token for
   the data key** — it authorises one run of a key-confirmed exchange, inside
   which an ephemeral X25519 handshake carries the wrapped key, and both screens
   show a short confirmation number the user compares.

**The three keys, so nobody re-derives this later.** The local data key `DK`
(exists, unchanged — SQLCipher, wrapped by passcode+DPAPI and by the Recovery
Kit) stays exactly as it is. A **new** master sync key `MK` is minted when sync
is first enabled and is wrapped *twice*: under the local `DK` on the desktop,
and under a key derived from the web password on the server. Per-profile content
keys hang off `MK`. Nothing about local at-rest protection changes, and the web
password never becomes the root of the local file.

The pre-existing cloud/sync ADRs in [docs/architecture/](docs/architecture/)
describe a different backend (Go/PowerSync) and are now **superseded on the
choice of backend**; whatever in them is about the data model still applies.

## How we work together

- **Finish things completely.** Do one thing at a time, but each thing **fully and
  properly** — no half-done features, no niche bits left "for later," no scattered
  TODOs. If we know what a feature needs, we build all of it.
- **Blocking vs non-blocking.** If something is genuinely blocked (a decision only
  the founder can make, a missing asset, an external dependency) — **stop and ask
  him**. If it is not blocking, keep going and **collect every open question for
  one batch at the end**. Do not interrupt the flow for non-blocking questions.
- **No "scope/version/it's-a-lot-for-one-day" talk.** Don't narrate limitations or
  defer work in conversation. Anything genuinely not-yet-built is recorded — with
  full context — in [docs/STATUS.md](docs/STATUS.md), so it is never lost and never
  scattered.
- **Keep [docs/STATUS.md](docs/STATUS.md) current, and keep it a STATUS.** It is
  the living record of what exists, what's in progress, current problems, and what
  remains — **not a journal**. When a piece of work finishes, its narrative moves
  to [docs/log/](docs/log/) in the same pass and `STATUS.md` keeps only what is
  still true; a status document that grows monotonically stops being read, and
  then stops being true. Update it as
  part of finishing each piece of work — that is how the founder (and a non-technical
  PM) can understand the project at any moment without reading code.
- **Who does what** (founder, 2026-08-06 — supersedes the 2026-07-08 rule that
  everything went to Sonnet):
  - **Opus does the hard part itself.** Design, diagnosis, anything with a trap
    in it, anything touching security, IPC, crypto, migrations or money, and
    every judgement call. Not delegated.
  - **Sonnet subagents do the routine typing** — mechanical implementation,
    repetitive edits, scaffolding from a spec that is already decided. One at a
    time, with a precise self-contained prompt. This is what saves usage.
  - **Fable is the adviser on the genuinely nasty questions and on
    cybersecurity.** Asked for a plan or a second opinion *before* work starts,
    not to write the code. Its answer is advice — Opus still decides and still
    verifies.
- **Verification is not a skim** (founder, 2026-08-06, restating 2026-07-08
  more strongly). Whatever produced the change, before it is committed: read
  **every changed file in full**, re-derive the arithmetic by hand rather than
  trusting a test that may have been written to match the code, run the full
  gate set, and review UI work by eye against the design rules (tokens, banned
  hues, patterns matching existing pages). A subagent's report is a claim, not
  evidence.
- **Git is governed by the Git section below.** Commits are allowed for work
  that is finished and verified; push, pull requests and merges need an explicit,
  one-time authorization from the founder.
- **A reported bug is a sample, never an incident** (founder, 2026-08-06).
  *„necu samo da se otkloni taj bug, nego i da se proveri uzrok i sta je sve
  potencijalno zahvaceno."* Every defect — his or mine — is worked in this
  order, and the fix is not finished until all four are done:
  1. **Root cause**, not the symptom. Name the actual rule that is wrong.
  2. **Blast radius.** Find every other place that rule reaches — grep for the
     construct, not for the file. A defect in a shared component is a defect at
     every call site; a defect copied by hand is a defect wherever it was
     copied to.
  3. **Fix it once, where it belongs.** If four surfaces had four copies of the
     arithmetic, the outcome is one helper and four adoptions, never four
     patches. Prefer a fix that makes the class *unrepresentable* over one that
     makes this instance correct.
  4. **Ask whether the subsystem is sound.** If the answer to „why did this
     ship" is „nothing in this area was ever designed", say so and put the
     subsystem in `docs/STATUS.md` — the report was the symptom, the subsystem
     is the finding. One overflow bug can legitimately mean the whole layout
     layer is unfinished, and that is the more useful answer.
  Record the class in [docs/defect-classes.md](docs/defect-classes.md) so the
  same shape is recognised the next time it appears somewhere else. **A class
  that can be turned into a gate should be** — a rule nobody can forget beats a
  rule everybody has read. **Do not write the count here.** This line has been
  wrong three times by copying: „eighteen of the hundred-odd", then
  „twenty-two" when the ledger said twenty-seven and twenty-two was the count of
  GATES, then „twenty-seven of the hundred and thirty-one" for a ledger that had
  reached a hundred and thirty-five classes and twenty-five gates.
  `docs/defect-classes.md`
  states the two numbers it can count directly, and says how it counts them;
  this file names that file and no figure at all.
- **Concise Serbian status updates** to the founder; the code, comments, and docs
  are in **English**.

## Git (project rules; global rules also apply)

- Commits are **allowed without asking** for work that is **100% finished and
  verified** (green typecheck + tests + build + smoke, reviewed). **Never push,
  open PRs, or merge** without an explicit, one-time authorization.
- Always Luka's identity (`Luka Stojiljkovic` / `luka.d.stojiljkovic@gmail.com`),
  plain `git commit -m` — never `-c user.email`/`--author` overrides. **Never** add
  `Co-Authored-By` trailers or "Generated with Claude Code" footers.
- **Stage explicit paths only** — never `git add .`. English conventional-commit
  messages, one scoped concern per commit (e.g. `feat(db): …`, `feat(desktop): …`).
- **`docs/` is version-controlled** since 2026-09-26, and is covered by the
  repository's secret scan. Update it in the same pass as the work it describes:
  a document that has stopped being true is a defect, not a stale note.
  `CLAUDE.md` lives at the repo root.

## Design rules (binding — the app must never read as "AI slop")

- **Tokens only.** Every colour/space/radius/type value comes from
  `packages/tokens` as a `--nx-*` CSS variable. **Zero raw hex/rgb/hsl** anywhere
  outside `packages/tokens` (there is a grep gate: `#hex|rgb(|hsl(` over
  `apps/*/src` and package `src` must be empty).
- **Banned system hues:** no purple/violet, no blue, no orange (especially not
  "Claude orange"). Data/chart secondary is jade green. The 8-accent palette must
  respect these bans (re-check with the founder before finalizing accents).
- **No AI-slop selection.** No inset side-bar highlight, no glows. Active nav =
  typographic (gold text + weight) + the ✦ brand glyph. Drop targets = accent
  border + soft background, never a glow.
- Two themes: **Dan** (light, warm paper + bronze) and **Noć** (dark, vesper
  blue-black + star-gold). Discipline of Linear, not its aesthetic.
- **Type is the system stack** — Segoe UI Variable on Windows, through the
  `--nx-font-family-*` tokens. This line used to name Space Grotesk as Noć's
  display face; nothing ever shipped it, so the rule was describing a font the
  app did not have. Founder, 2026-08-08: „ma ok je font" — no webfont, and no
  claim of one.
- All user-facing copy is **Serbian**, centralized in `strings.ts` (i18n comes
  later as a mechanical extraction). Never fabricate data, stats, or copy.

## Security (binding — the app must be airtight)

- [docs/security/baseline.md](docs/security/baseline.md) (`SEC-*` rules) is binding
  for all code. Deviations need founder sign-off in
  [docs/deviations.md](docs/deviations.md).
- **Electron IPC (SEC-EL):** the renderer is untrusted. Channel constants in
  `shared/ipc.ts`; in main, `assertTrustedSender` + `asRecord` + per-field
  validators on every payload; a frozen, one-method-per-channel preload bridge with
  no generic passthrough; the store re-validates semantics. `contextIsolation` +
  `sandbox` on, `nodeIntegration` off, navigation/window-open locked.
- The database lives **only** in the main process; the renderer reaches it solely
  through the typed IPC allowlist. Every SQL value is bound, never interpolated;
  every store statement is scoped by `profile_id`.

## Tech / build essentials

- Monorepo: pnpm 11 + Turborepo, TS 5.9 strict (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`), React 19, Vite 7, electron-vite, Vitest.
  Packages: `tokens`, `core` (registry, contracts, headless views engine), `db`
  (encrypted SQLite), `ui`. Apps: `desktop`, `gallery`.
- **Electron is pinned to ^44** (ABI 149) since 2026-09-06; it was ^42 (ABI 146)
  for four months. Dependabot still ignores electron majors, but for the true
  reason rather than the old one: an Electron major is two Chromium majors of
  layout and font behaviour landing in an app that is audited by PHOTOGRAPH, and
  CI cannot run `shots`, so a green Dependabot check would be green on the half
  of the verification that does not decide anything here. The reason written in
  this file for four months — „43/ABI 148 has no prebuild for
  `better-sqlite3-multiple-ciphers`“ — stopped being true on 2026-09-04, and the
  bump was measured rather than assumed twice over: first the same
  `prebuilds/win32-x64.node` file, byte-identical, loaded under Node 24 (ABI 137),
  Electron 43 (148) and Electron 44 (149) and in all three opened a database
  written by 12.11.1; then 44 itself took the full gate set, `smoke`, `dist` and a
  2712-frame sweep. **Do not bump the major without asking the founder** — and
  when he says yes, the sweep is part of the bump, not a follow-up. Electron
  supports a major until N+3 ships, on an 8-week cadence, so 42's 2026-10-20 was
  v45's release date and 44 lives until v47 — two cycles later, **around
  2027-02**. That is a derivation from the published cadence, not a date Electron
  has announced.
- **Shell quirk (Windows):** pnpm is under `%APPDATA%\npm` and not on the tool PATH.
  Prefix every command: `$env:Path += ";$env:APPDATA\npm"; pnpm …`.
- **The native ABI dance is GONE** (2026-09-04). `better-sqlite3-multiple-ciphers`
  13.0.3 is a Node-API addon: eight prebuilds keyed by platform and arch, no ABI
  in the key, one loader picking at runtime. One file serves Vitest and the app,
  so `rebuild-native.mjs`, `rebuild:electron`, `rebuild:node` and the flip inside
  `launch.mjs` are all deleted, and **`smoke`, `shots` and `demo` may now run
  while tests do**. Nothing compiles the module — `pnpm-workspace.yaml` denies it
  a build script, because the `binding.gyp` it still ships would otherwise make
  pnpm run `node-gyp rebuild` and fail the install on a machine with no C++
  toolchain, for a binary the package already carries. One `patches/` entry adds
  the `types` condition its `exports` map omits; without it the 75 files that
  import it raise TS7016.
- **Verification gates before any commit:** `pnpm typecheck` (13/13), `pnpm lint`
  (14/14 — `@nexus/supabase` joined on 2026-09-09; it has no TS, so typecheck
  stays 13), `pnpm test` (all green), `pnpm build` (4/4),
  `pnpm --filter @nexus/desktop smoke` prints `SMOKE OK`, and **all twenty-six
  static gates** pass. **`pnpm lint` used to be missing from this line** even
  though CI has always run it, and on 2026-08-14 six real errors shipped red
  because of that — two of them display bugs the linter had named (DC-49,
  DC-50). Treat an unused import as a question, not a nit: it is usually half a
  feature.
  The static gates are cheap, they need no build output, and CI runs each as its
  own step so a red check names the rule:
  `check:colours` (no raw hex/rgb/hsl outside `packages/tokens`),
  `check:contrast` (every token pair clears WCAG AA, marks clear 3:1, hairlines
  sit inside the 1.2–2.4:1 band), `check:css`, `check:strings` (no module-scope
  reads of the strings table), `check:tokens` (every `var(--nx-*)` resolves to a
  real token or a declaration in source — CSS drops an undefined custom property
  silently, so „uses a token" and „uses nothing" are otherwise
  indistinguishable), **`check:elec`** (DEV-006 lets the Elektronika workbench
  carry the trade's blue and orange, because inside a wiring diagram a colour is
  data — and says the exemption reaches the canvas and its legend and nothing
  else; that is a rule over a reachability set, so it is enforced rather than
  remembered: a `--nx-elec-*` token may be read or declared only in
  `styles/electronics.css`), **`check:controls`** (a native `<input type="radio">`
  or `type="checkbox"` must carry the shared `.nx-radio`/`.nx-checkbox` class:
  the OS widget is 13x13, grey in both themes and eleven pixels under the
  pointer floor, and nothing else here can see it — it uses no colour, declares
  no token and typechecks, so the only check that ever caught one was the
  screenshot sweep, which does not reach a form three modal steps deep),
  **`check:fields`** (the last step of [[DC-120]], and the only one that is a
  rule rather than a repair: a surface may not draw its own text field. Seven
  hand-rolled `<input>` elements sat outside `TextField` — so outside the name
  contract, the hint beside the control, and the shared box — and the thing that
  hid them was a CENSUS: the gate that came before asked whether an input wore
  the shared class, and these had a local one. This one asks what the element
  IS, `type` and nothing else, which is why the two search fields and the two
  date fields it converted were invisible to the previous rule and are a finding
  here. `type="radio"`, `"checkbox"`, `"range"` and `"file"` are somebody
  else's subject and are excluded by TYPE, so the primitive is the only file
  exempted and it needs no exemption list),
  **`check:tiers`** (a shared typographic tier, retyped. `.nx-hint` is muted
  13px prose at the app's leading with a 68ch measure; before it existed, 33
  classes across 15 stylesheets wrote those five declarations out by hand and
  had already drifted to four leadings, three measures — one of them a raw
  `64ch` where a token exists — and 48 paragraphs still carrying the UA's `<p>`
  margin. Every copy is token-only and locally correct, so nothing else in the
  tree can see it: only counting them shows anything. The gate reads the MARKUP
  as well as the CSS, because the discriminator is not in the stylesheet — ink
  and size alone also describe `.nx-disclosure`, which is a disclosure BUTTON,
  and a rule that fired on it would have an allowlist within a month.
  A class whose every call site is a `<p>` is a paragraph tier, and that pairing
  needs no allowlist at all. A block that declares its own `font-family` has
  said out loud that it is a different tier — `.elec-sim__readout` is a mono
  tick counter — and is not this one),
  **`check:rows`** (a field row that mixes shapes aligns its CONTROLS, because
  it cannot align its boxes. A form row here is a wrapping flex row, and where
  one child is a stacked field — label above input — and its neighbour is a
  bare input or a button, `align-items: center` centres the tall box against
  the short one and leaves the input sitting BELOW the control next to it: the
  two things the user actually touches are the only two not lined up. `end`
  lines them up, because the control is the last thing inside a stacked box.
  Four rows shipped centred — the calendar's, DOKUMENTI's and both of
  STUDIJE's — and nothing else in the tree can see that: `center` is a valid
  value, every length is a token, and the sweep photographs a centred row and
  an aligned one as two rows of correct-looking boxes. The gate reads the
  MARKUP to decide which rows are mixed at all, because a row of all-stacked
  fields is correct at any alignment and so is a row of all-bare controls; a
  fragment is transparent, its children being the row's. Its own trap is worth
  keeping: `\blabel=` also matches `aria-label=` — `\b` sits between the `-`
  and the `l` — which was five phantom findings before a test owned the case.
  It also cost the shared JSX lexer a bug, which is the more useful half:
  `ChangeEvent<HTMLInputElement>` was read as a tag, never self-closed and
  never closed, so it stayed on the nesting stack and swallowed every following
  sibling as its child. Gates that ask for one tag name never met it; the first
  one to walk EVERY tag reported nothing on the form it was written to catch),
  **`check:layers`** (a stacking order is a property of the whole app, and this
  one existed nowhere: 22 `z-index` values over 11 files, each picked at its own
  call site, so `1` meant „pinned over my rows" seven times and „the lower of
  two pinned ranks" an eighth, while `2` meant „the ghost being dragged" twice
  and „a pinned header" twice more. The only statement of the ladder was PROSE
  — five comments in `notes.css` re-listed it by hand, one naming a layer 40
  nothing had carried for months and one recording a hazard that was NEVER
  real: written from the JSX tree the day after the dialogs it named adopted a
  component that portals to `document.body`, which is the one construct that
  makes the React tree and the DOM disagree about who contains whom.
  Nothing else can see this: every value is a valid integer, and the sweep
  photographs a correct order and an accidental one identically, because two
  layers differ only where two boxes meet. Every `z-index` is now `auto` or one
  `var(--nx-layer-*)`, **and the rule needs no exemption list** — `under` (-1)
  and `ground` (0) name the two cases that are not ladder positions, so nothing
  is left over. It reads TS as well as CSS, because `useAnchoredPosition` sets
  inline styles on exactly the boxes at the top of the ladder; an AST pass, so
  READING `style.zIndex` — which `shots/audit.ts` does on purpose — is a
  different node and not a finding. It also checks that the scale is still
  strictly increasing, which is the half a spelling rule misses: all 22 call
  sites would go on passing if `dialog` were edited under `drawer`),
  **`check:names`** (a field's accessible name is its NAME, never its name and
  its explanation. A `<label>` that WRAPS its control takes the element's entire
  text content as the name — that is the feature, and it is why `<label>Email
  <input></label>` needs no `for` — so a hint inside one is read out as part of
  it: UČENJE's two daily caps announced themselves as „Novih kartica dnevno
  Najviše 200 novih kartica dnevno", and PRIVATNO's four credential choices did
  the same to their radios at the foot of a form where the reader hears „Zasebna
  šifra za Privatno Zasebna šifra ostaje na ovom uređaju…" as one utterance. The
  arrangement is exactly what the design asks for — name above, control, hint
  below — so it renders correctly, uses only tokens, typechecks, lints, and
  **photographs as the same PNG, because an accessible name is not in the
  picture**; the failure exists only for a reader who cannot see the screen, and
  nothing in this repository is that reader. It needs no exemption list, because
  „a wrapping label holding a control and an explanation" is a statement about
  what the label CONTAINS. It reads `nx-hint` and the `__error` family as a
  PATTERN rather than as the thirteen classes it currently matches, for
  DC-109's reason — a hand-kept list beside a generated one fails by omission,
  and the fourteenth joins the rule by being written. There are two ways out and
  it accepts both, because both are correct: the explanation moves out beside
  the control (what `TextField`, `Select`, `TextArea` and `Checkbox` do by
  construction, each drawing a `<label for>` BESIDE its input) or the control is
  named by reference, `aria-labelledby` at the span the user reads — which is
  what PRIVATNO takes, because the row must stay a `<label>` for the whole box
  to stay clickable. The census is exported beside the verdict, so a later run
  can tell „found nothing" from „looked at nothing"),
  `check:invisibles` (no character that renders as nothing, or as a character it
  is not — the defence review itself cannot make),
  **`check:zeroize`** (no key erased in the middle of the call using it: a
  `finally` runs at the RETURN STATEMENT, not when the returned promise settles,
  so `try { return openAll(mk) } finally { zeroize(mk) }` decrypts under 32 zero
  bytes and reports it as `wrap/commitment-mismatch` — a message that accuses the
  server),
  **`check:risk`** (the professional drawer's notice wiring is intact, and no
  tool forbidden a verdict has grown one in its copy or in its arithmetic),
  **`check:pro-math`** (the other half of the same drawer: no pack module
  declares its own copy of a helper `pro/result.ts` already owns, no absolute
  epsilon hides inside a rounding call, and no tool divides by an input field it
  never guarded), **`check:pro-flags`** (the third of the same drawer: every
  boolean on an exported result type is named by its pack's surface — a flag the
  screen never reads is a caveat the user never reads, and the misreading it was
  written to prevent is what ships; nothing else can see this, because skipping
  one field of a result is well-typed and an unused *property* is not an unused
  variable), **`check:licences`** (the committed third-party notices are what
  this dependency tree actually produces — a generated file that is committed
  goes stale silently, and `licences.test.ts` can only ask whether the file is
  fit to ship, never whether it still describes the tree), `check:egress` (no
  new network construct in a build that must be able to make none),
  `check:rls` (the migration SQL states every policy the wall needs) and
  **`check:address`** (Serbian has no genderless past tense, so „šta si uneo"
  has chosen the reader's gender — and the only one it ever chose was
  masculine; forty lines shipped that way and six file headers taught
  the next author to copy the phrasing, because it is valid Serbian, valid
  TypeScript and photographs correctly, so nothing else in the tree can see
  it. Write the possessive („tvoja granica"), the present („koje uneseš"), the
  impersonal or the passive. It watches **predicative adjectives too** —
  „ako nisi siguran" picks a gender exactly as „uneo" does — and reads a
  `"…" + "…"` chain as ONE sentence, because the copy is hand-wrapped near 100
  columns and both live instances of those two holes had the trigger and the
  word it governs on opposite sides of the split) and **`check:quotes`** (the
  same copy, one layer down: Serbian closes a quotation with „ … “, and nothing
  on a keyboard produces the pair, so the opening mark was pasted and the
  closing one typed as an ASCII `"` — which inside a double-quoted literal has
  to be escaped, and the backslash made it read as deliberate. 172 of roughly
  375 quoted phrases shipped that way, over 29 files, sometimes both forms in
  one sentence; it typechecks, it lints, `check:address` passes it, and it
  photographs as a quotation mark of some kind. The rule is a PAIRING rule and
  therefore needs no exemption list: a lone `"` or `”` is never a finding, which
  is what lets `pro/tekst.ts` keep its table of quote pairs. An UNCLOSED „ is
  not a finding either — the copy is hand-wrapped near 100 columns, so a
  quotation routinely opens in one literal and closes in the next, and the gate
  carries the open state across a `+` and a `${…}` instead. `migrations/` is
  outside the walk: a migration's SQL is a template literal, so its `--`
  comments are literal text to a parser, and a comment is shown to nobody) and
  **`check:ids`** (an identifier validated for EXISTENCE and nothing else. Both
  trust boundaries did it — `nonEmptyStr(raw.profileId, …)` in the archive
  reader, `asNonEmptyString(payload.id, …)` on the IPC wire, 784 call sites
  between them — and nothing downstream bounds an id: `RestoreStore` and every
  store write through prepared statements rather than through each module's
  validators, and no migration CHECKs an id column past `NOT NULL`. So a
  ten-megabyte `profileId` was a row that landed and that every later query
  carried. It is invisible to the rest of the tree because the call LOOKS
  validated: `string` is `string`, it lints, and it names the field it refuses.
  The gate reads the AST rather than the text — 69 of the 784 had a nested first
  argument that no regex can split, and a text rule would also fire on the
  documentation of the defect in `core/src/ids.ts`. `packages/db` is out of
  scope on purpose: a store's validator reads an argument from MAIN, which is
  not this boundary), and **`check:migrations`** (a citation that names its
  evidence by a number the evidence does not carry. This repository has TWO
  migration series and **both number from 001**: the local SQLite schema in
  `packages/db/src/migrations/` is at 069 and the server's in
  `supabase/migrations/` at 014, so a bare „migration 006" resolves to whichever
  one the author had in mind and to nothing at all if they had neither.
  `packages/sync-transport/src/signal.ts` cited „migration 006's policies" for
  the realtime topic namespace, and the realtime policies are in the server's
  004 — a reader grepping it landed on a table of Anki decks. Where the two
  series could be confused the fix is to cite the FILE, which is unambiguous
  because only one series has timestamps for names. Scope is the `supabase/`
  tree alone and says so in its own header, because which series a citation
  means is a property of what the citing file is ABOUT — `packages/sync/push.ts`
  cites the server while its sibling `collections.ts` cites the local schema, in
  one directory and one idiom — so a wider rule would need an exemption list
  within a month. It also refuses a file that declares no number, two files
  declaring the same one, numbers that run backwards against the filenames, and
  a migration missing from the tree listing in `supabase/README.md`, which is
  hand-kept beside a directory that is not and had already lost four), and
  **`check:copy`** (every leaf of the user-facing copy table is read by
  something — and no other instrument can see one that is not: an unread leaf
  typechecks, lints, passes `check:strings`, carries no colour, declares no token
  and **photographs as NOTHING AT ALL, because it is not on screen**;
  `waveValuesHint` is what the class costs, the only sentence anywhere saying
  that a list of readings is separated by semicolons, in a dialog that never drew
  it, so `0, 1,5` was one reading and no error. A leaf is read when something
  NAMES its path, when a key is computed against an INDEXED subtree, when a
  member resolves through a dotted literal a registry carries, or when a subtree
  is HANDED to a call the walk cannot follow — and the last is NOT JUDGED, printed
  as such on the same run, because „handed to `formatStructuredError`, which
  indexes whatever table it is given" is a leaf that is read and „handed to a
  component that ignores the prop" is one that is not, and there is nothing in
  the file to tell them apart. The census prints beside the verdict so that „found
  nothing" and „looked at nothing" are not the same green line. It found 24 the
  day it was written — four wanted rendering and twenty wanted deleting — and it
  is allowlist-free, because the rule is a statement about what a leaf is REACHED
  BY and not a list of exceptions), and **`check:runner`** (DEV-007's first
  mitigation, enforced rather than promised: **the command line is never data**.
  Until the Elektronika runner landed the shipped app had exactly one capability
  boundary — the network, off by default, guarded by `check:egress` — and this is
  the second, and the sharper: a network call leaves the machine and a process
  runs ON it. Five rules. `child-process` is two files and their tests: the runner,
  and `update/launch.ts`, which starts only the installer the update service
  verified, with a literal argv (DEV-007's 2026-10-09 amendment); `shell`,
  `exec-family` and `spawn-literal` are exempted for NOBODY, asserted at import
  by `assertNoSecurityExemptions()` because the shortest path from a red gate to
  a green one is to add a rule id to the map, and that path in this gate would
  paper over the deviation itself. The `exec-family` rule needs a negative
  lookbehind — `re.exec(text)` is a regular expression, `runner.ts` alone calls
  it twice, and the repair a reader reaches for when a gate cries wolf is not a
  narrower gate but an exemption, and then a second one. **The interaction
  between two rules is what does the work, and it reads like a coincidence and is
  not one: the runner, allowed to import `child_process`, is NOT allowed to contain a
  toolchain word, so the program it spawns cannot be a literal it wrote — it can
  only be `argv[0]` of a plan that came out of the table.** The runner
  may spawn a tool and may not know which tool it is spawning. The
  fifth rule, `toolchain-name` (`colcon|ros2|gazebo|docker|wsl\.exe`), is
  vocabulary and not security — a file that NAMES a tool is not a file that runs
  one — so it has many allowlist entries, each with its reason beside it in the
  gate rather than in a comment at the site. Its word boundaries are load-bearing
  and cost something: case-insensitive, because a capital letter must not defeat
  a rule and the copy says „Docker" while the table says `docker`; but `colcon`
  under that match is also the first six characters of `colConcentration` and
  `colContribution`, two Serbian column keys, and a boundary-free version reports
  those four lines and nothing else. Four findings no honest exemption covers, in
  a gate whose output is then a fifth noise — worse than not having it, because
  it also carries the authority of having run. The price is the welded
  identifiers (`gazebo_ros`, `colcon_ws`), which is near zero: an invocation is a
  program followed by a space. Comments are stripped before matching, for
  `check:egress`'s reason — `core/src/index.ts` re-states the boundary in prose,
  `main/index.ts` explains twice why a package is a directory, and a gate that
  fires on its own documentation teaches people to stop writing the
  documentation. **What it is not:** a proof. It reads source text and cannot see
  a command line assembled at runtime, because such a line looks like an
  ordinary string to any reader. It is for the hurried edit that imports
  `child_process` into a module with no business starting anything, and the
  literal that puts a program name at a call site.)
- **Looking at the app is a command, not a chore.**
  `pnpm --filter @nexus/desktop shots` seeds a demo profile, drives the real
  renderer through every module and sub-view in both themes at three window
  sizes plus maximised, types into each create form, and writes ~2 800 PNGs to
  `apps/desktop/shots/` with `report.md` — a geometric audit of clipped text,
  boxes escaping their parent, overlapping text and sub-24px targets, grouped
  as classes. `pnpm --filter @nexus/desktop demo` adds a populated „Demo"
  account to this device (passcode `demo-nexus-2026`). Both run in Serbian on
  any machine, or in English with `--locale=en`. Neither flips anything any
  more — the line that stood here forbade running either beside a test suite,
  and that constraint retired with the ABI dance on 2026-09-04.
  **One run per verb at a time, and it is enforced.** `launch.mjs` now builds and
  then launches, holding a lock for the whole of it — so a second `shots` is
  refused by name rather than allowed to wipe the sandbox the first one is using.
  That is not politeness: two runs on one sandbox deleted each other's key chain
  and produced a sweep reporting an app that would not unlock, and the `EPERM`
  from the wipe went into a callback with no `.catch` and left a window at 0 % CPU
  (`docs/defect-classes.md`, DC-134 and DC-135). A run and the tests still
  coexist; two runs of the same verb never do.
  New store logic is **TDD** (tests
  red before green). Serbian sr-Latn sorting/formatting uses
  `Intl.Collator(["sr-Latn","sr"])` — plain `"sr"` mis-tailors Latin š/č/ć.
