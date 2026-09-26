# The defect-class ledger

**One hundred and forty-three recurring failure shapes, each recorded the first
time it was recognised.** Opened 2026-08-07 on the founder's rule that *a reported bug is a
sample and never an incident* — so the entry here is never the bug, it is the
**rule that was wrong**, written so the next instance is something we spot
rather than something we discover.

> **How a class earns a line.** Every defect is worked in four steps
> (`CLAUDE.md`): name the rule that is actually wrong, find every other place
> that rule reaches, fix it once where it belongs, then ask whether the
> subsystem is sound. A class is added when step 1 produces a sentence that
> would have caught the defect *somewhere else*. If the sentence only describes
> this one site, it was an incident after all and it does not belong here.
>
> **How many of them are executable is not the gate count, and the arithmetic is
> worth stating because it does not match — and is not meant to.** There are
> **twenty-six** `check:` scripts and **one hundred and forty-three** classes
> below, and neither number is the other's inverse. `check:contrast` answers no
> class at all, because it came from a design rule rather than from an observed
> failure; `check:controls` answers TWO, [[DC-98]]'s native control that skips
> the shared class and [[DC-121]]'s hand-written one that skips the shared
> component. And a class that can be made executable is not always made a GATE,
> because for some of them a gate is the wrong shape: [[DC-111]]'s needs a
> packaged artifact to read, so it lives at the end of the script that builds
> one; [[DC-112]]'s reads `turbo.json` beside its siblings in
> `scripts/root-config.test.mjs`, where `pnpm test` already runs it uncached;
> [[DC-114]]'s needs a RENDERED page and a window size, so it is a rule inside
> the screenshot sweep (`shots/audit.ts`, `below-fold`) rather than anything a
> static reader could answer; [[DC-118]]'s whole reachability set is one
> directory of two files, so it is a test inside that directory's own suite
> rather than a script plus a CI step to keep in step with it; [[DC-119]]'s
> oracle is a FORMATTER the same module already exports, so the test asks it
> instead of restating what it answers; [[DC-135]]'s is a pin in
> `scripts/run-lock.test.mjs`, because what it guards is that a harness verb
> cannot be ADDED without a lock, which is a statement about `package.json` and
> not about any source file; and [[DC-143]]'s is a walk of one app's import graph
> in `routes.test.ts`, beside the lazy table it protects, because the rule is
> about a single entry point and not about the tree. A
> class that can be made executable should be: a rule nobody can forget beats a
> rule everybody has read — and „executable“ is the requirement, „one more
> `check:` script“ only the usual way of meeting it.
>
> This paragraph used to carry a class total („twenty-seven of the hundred and
> thirty-one“) and it was wrong twice, the same way CLAUDE.md's was: a figure
> copied into a second sentence rather than counted in both. The two numbers
> above are the two that can be counted directly — `check:` keys in
> `package.json`, and the `**DC-nn —` headers below — so those are the two it
> states, and the per-class attribution is left to each entry's own `*Fix:*`
> line rather than restated here where it can rot.

This file used to be §5 of [STATUS.md](STATUS.md), where it was 1 900 of that
document's 9 855 lines. It is a reference work, not a status: entries are
appended and almost never revised, and nobody reads it front to back. Splitting
it out is what let the status document go back to being one.

**Related:** [STATUS.md](STATUS.md) (what is true now) ·
[log/](log/) (the wave entries these classes came out of) ·
[security/baseline.md](security/baseline.md) (the `SEC-*` rules, which are
binding requirements rather than observed failure shapes).

---

**DC-01 — A gate that silently covers nothing still reports success.**
*Three instances in two days, and every one of them was introduced by work whose
entire purpose was to make verification stronger.* The colour gate's escape
hatch failed OPEN (a marker with no reason was accepted whenever any source
followed it on the line — which is how anybody would actually write it in CSS).
The same gate's module carried a `#!` shebang that made it unimportable by its
own test suite under Vite. And its root `vitest.config.mjs` was auto-discovered
by `@nexus/core`, which has no config of its own, so **2,556 tests collected
zero files for a day** while turbo replayed a cached log saying they had passed.
*The rule this class produces:* **adding a gate is a change to the build, and a
change to the build is verified by watching it FAIL first.** A gate that has
never been seen refusing something has not been tested; it has been written.
Corollary: an include list is a promise about where tests may be written, so a
directory absent from one is a directory whose tests do not run.

**DC-02 — A rule written twice is a rule that has already begun to drift.**
Instances this wave: the muscle-list JSON parser (two copies, differing only in
which error they raised); `isUniqueConstraintViolation` (three copies);
`moduleName` (eleven copies, and one of them had already drifted — STUDY's page
titled itself „Predmeti" while the sidebar called it „Učenje"); the exercise
reference grammar (two regexes, both looser than the catalogue they point at);
and the sr-Latn clock formatter (three copies). *The rule:* the second time a
rule is needed it moves to one place THEN, not later — and where the callers
need different error messages, the shared function answers `null` and each
caller writes its own sentence. *Still recurring.* The least obviously
dangerous copy is the one under a comment saying the copy is safe — the tenth
search kind met `SearchKind` declared in `@nexus/core` and again on the IPC
wire, which is [[DC-141]].

**DC-03 — A mirror of a private number is a number that drifts.**
`MAX_FIT_WORKOUT_NOTES_LENGTH` on the IPC wire said 1 000 and its comment
claimed it mirrored the store. The store's cap was 500 and it was not exported
at all, so the „mirror" was invented. A wire looser than its store turns a clean
refusal into a confusing one. *The rule:* a constant that is mirrored is
exported from the side that ENFORCES it, and the mirror cites it by name.

**DC-04 — Failures were said; successes never were.**
The canvas autosave announced every refusal and announced no write, so the
founder read the silence as „nothing is being kept" and asked for a save button
the app had had all along. The same shape exists wherever a surface writes
without being asked. *The rule:* if a screen saves by itself, it says WHEN — and
the line carries a clock, because a bare „Sačuvano" is still true an hour later
and therefore proves nothing.

**DC-05 — A primitive that was never built is a rule every page invented for
itself.**
`TextField` has carried a label since the first week, so every text input in the
app has one. A `<select>` never had a primitive, so every page wrote raw markup
and improvised: a wrapping `<label>` here, a bare `aria-label` there, nothing at
all somewhere else. **An audit on 2026-08-07 found 39 of the app's 74 selects
with no visible label** — the control announced itself to a screen reader and
said nothing to everyone else. That is not thirty-nine mistakes, it is one
missing component. *The rule:* when the same decision has to be made at every
call site, the decision belongs in a component, and the component makes the
wrong answer unrepresentable — `Select`'s `label` is required, rendered, and has
no `aria-label` escape hatch.

**DC-05 also names item 17, which had gone stale.** The „EmptyState has two
shapes" note cited a CSS override that no longer exists, so the finding had to be
re-established, and it is the same class as DC-05 rather than a leftover: the
component only ever had ONE shape — centred, 64 px of padding, an 18px title —
so every surface that needed a small one grew its own. `dash__empty`,
`ntf__empty` and `search__empty` were three near-identical rules differing only
in padding. The two shapes are now a `variant` on the component: `page` (the
whole surface is empty, unchanged) and `inline` (one list inside a populated page
is), adopted at fifteen sites. **Three of the eighteen turned out not to be empty
states at all** — a widget's read FAILURE, the notification centre's loading line
and its load-error line were wearing the empty class because it was the only
small quiet rule in the file. Those are `*__quiet` now, and a card that could not
read is no longer told there is nothing to read.

**What DC-05 leaves open, precisely.** `Select` shipped with the four Tasks
view-controls and the nine FIT selects adopted (thirteen sites, both layouts
proven). The remaining audit, to be worked with the overhaul:
- **26 selects still name themselves only through `aria-label`** —
  `DashboardPage` 1, `DocumentsPanel` 1, `FinCsvImport` 4, `FinancePage` 8,
  `NoteChecklistTasksDialog` 1, `NoteEditor` 1, `PeoplePanel` 3, `SettingsPage`
  11, `StudyPage` 6, `moduleSettingsPanels` 1. **Not all of them are defects**,
  and that distinction is the work: a select inside a labelled table column (the
  CSV import mapper) IS named by visible text and wants `aria-labelledby`
  pointing at that header, not a second label repeating it. Each site needs a
  judgement, which is why this is not a sweep.
- **35 more are correctly labelled by hand** and should adopt the primitive so
  there is one pattern rather than five.

**DC-06 — A pane that can be squeezed will be squeezed to nothing; the question
is only which pane.**
The notes page has been fixed twice for the same defect and the second fix was
the founder's rule, not a technique. Version one paid the two fixed rails first
and gave the writing column the remainder — 75 px of editor at the window this
app enforces. `f1fa51a` inverted it: a floor for the editor, derived from the
user's own measure, and the rails yield. That is better arithmetic and the same
class of answer, because **`minmax(0, X)` on a rail does not mean „the rail is
flexible", it means „the rail may be deleted a pixel at a time"** — and the
„široka" measure simply moved the slivers into a wider band (1345–1493 px), so
the fix carried its own next bug report inside it. *The rule:* a pane declares
the width below which it stops doing its job, and below that width it LEAVES and
is reachable some other way. Everything that stays is full width. The corollary
is that the breakpoint is not a taste — it is derived: the width at which the
last pane's slack falls under the measure the page exists to show.
**The same class was found one level down while fixing it, and there it had been
broken at every window width since the day it was written:** „Istorija verzija"
and „Šabloni" each put a fixed 280 px list beside a preview with no floor, inside
a box already capped at `--note-measure` — 208 px of preview at the default
measure, 100 px at „uska". `auto-fit` with a floor answers it without a
breakpoint at all, which matters because that width depends on two axes (the
user's measure and the pane) and a media query on the window can read neither.
**The blast radius is written out in §5 B's verdict above**, measured rather
than guessed: three other page rails, all of them fixed tracks beside a
`minmax(0, 1fr)`, which is the safe half of this class — the content column
absorbs the loss and no rail becomes a sliver.

**DC-07 — An open item that is never re-read stops being a record and becomes
a rumour.**
On 2026-08-07 the founder asked a plain question — *„da li je ostalo bilo šta da
se uradi?"* — and the honest answer could not be read off this document, because
this document was wrong. Every one of §5's twelve still-open items was re-checked
against the code that day instead of being recounted from the page. **Nine of the
twelve were already fixed**, several of them by commits whose own messages said
so (`f1fa51a` closed the kanban, the calendar and most of Settings' measure, and
this section still listed all three as open). The other three were partly done,
and **not one of the twelve was still open as written**. This is the third time
the ledger itself has been the defect —
item 7's arithmetic was recounted, item 16's caption claim was overstated, item
17 cited an override that no longer existed — which is enough repetitions to
call it a class rather than three accidents. *The rule:* an entry is closed by
the commit that closes it, in the same commit; and a status question is answered
by re-reading the code, never by reading this file aloud. **The re-check also
paid for itself**: it found the seventh silent failure in item 5 — `SearchPage`
still had the defect `SearchPalette` had been fixed for — which nobody would
have gone looking for, because the item said the work was done.

**DC-08 — A rule applied on one path is not applied; it is only present.**
Every finding of 2026-08-07's two sweeps has this shape, which is why they are
one class and not nineteen defects. Quiet hours were computed and then consulted
on ONE of the two paths that deliver a notification. The confirmation rule for
unrecoverable deletes was applied to the note rail's three containers and to
none of the six other surfaces doing the same act. The duplicate-name refusal
five stores emit was mapped by one renderer. The keyboard grammar CANV's picker
and the palette share was absent from FIT's picker. SET-007's module gate
reached the sidebar, the dashboard and search, and not the scheduler. *The rule:*
when a rule is written, the question is not „does this surface follow it" but
„how many surfaces perform this act, and do all of them" — and the answer has to
be counted, not assumed from the one that prompted the rule. The counting is
cheap: every one of these was found by asking which two artifacts should agree
and then walking both sides. **The corollary is where the cost actually is:**
a rule that exists in only one place is indistinguishable, from inside that
place, from a rule that is followed everywhere.

**DC-09 — A figure whose SOURCE is lossy reads as a total unless the drawing
says otherwise, in the same breath.**
*Found five times over in one arc, while building the drawn-data layer, and
every instance would have looked perfectly correct.* TASK's „zatvoreno" is a
floor three ways at once: a deleted task leaves `listActive` and takes its own
creation out of history with it, reopening a task NULLS its `completedAt`, and a
recurring task stamps no completion at all until its rule is exhausted. NOTE's
„Ritam pisanja" can only ever shade two squares per note, because a note keeps
`createdAt` and `updatedAt` and nothing between them — a note edited on nine
different days contributes two. FILES' size total comes from an index capped at
the 500 newest entries. FIT's session tonnage had this shape already and already
said so, which is the precedent the rest were written against. *The rule:* a
derived figure whose source is lossy is not a smaller version of the true
figure, it is A DIFFERENT FIGURE — so the surface names the loss where the
figure is, in the caption for the reader and in the doc comment for the next
programmer, and never in a footnote somewhere else. Where the loss is
CONDITIONAL, the caption itself changes (`truncated` swaps FILES' whole
sentence) rather than carrying a permanent hedge that is wrong most of the time.
*The corollary that makes this a class and not four notes:* the temptation is
always to clamp, average or interpolate the gap away, and each of those turns a
figure that is honestly short into one that is quietly wrong.

**DC-10 — A structural fact read out of a display library depends on which
binary happens to be running.**
*One instance, and it was money.* `currencyMinorDigits` answered „how many minor
units make one dinar" by asking
`Intl.NumberFormat(…).resolvedOptions().maximumFractionDigits`. That question is
not the one being asked: `Intl` reports a **display convention**, out of
whichever CLDR the process bundles. Node's ICU says RSD has 2 fraction digits;
Chromium's says 0, because Serbia has written dinars without para for years and
CLDR faithfully records the custom. So the test suite — which runs under Node —
asserted 2, agreed with ISO 4217, and passed, while the shipped Electron app
rendered **every dinar figure a hundred times too large** and a bank-statement
import parsed one a hundred times too small. Nothing in the repo could have
noticed: both sides of the bug were correct about their own runtime.
*The rule:* a fact the DATA depends on — a scale, an exponent, a sort order that
a stored key was built with — is stated in this repo, in a table, with a test
that pins it. A formatting library may be asked how to SHOW something; it may
never be asked what something IS. *The tell:* the answer changes when the
process does, and the test process is not the shipping process. *The regression
test that makes the class unrepresentable here:* it asserts the app's answer AND
reads `Intl`'s answer beside it, so an implementation that merely forwards ICU
cannot satisfy both on both runtimes.

**DC-11 — A recovery path that rewrites rows the user did not touch destroys the
distinction between "they reordered" and "the system re-spaced".**
The sparse-integer sort key (migration 022, and copied into every ordered scope
after it) worked by taking the midpoint between two neighbours and, when the gap
ran out, calling `renumberScope` — which rewrote **every row in the scope**. On
one machine that reads as an optimisation. The moment a second machine exists it
is unrecoverable data loss: the write two devices produce is identical in shape
whether the user dragged one row or the system re-spaced two hundred, so no merge
rule can tell them apart, and last-writer-wins silently discards one person's
reordering entire. Nothing about it would ever look broken. *The rule this class
produces:* **a write must carry the intent of the edit that caused it.** Where a
representation forces a bulk write to express a single user action, the
representation is the defect — not the merge rule that later fails to untangle
it. Prefer a form in which the operation is *structurally* local (a fractional
rank has no gap to exhaust, so a move writes exactly the row that moved) over one
that is local *most of the time* with a bulk fallback. And when the fix lands,
the fallback is DELETED, not left unreachable: code for a case that can no longer
arise is a claim that it still can.

*Recognised 2026-08-08 while mapping the sync collection set (ADR-082). Closed
the same day, in schema 62, deliberately before a single row had ever synced —
afterwards it would have been a migration of every task on every device,
coordinated across a network.*

**DC-12 — Two constants kept in step by a test are two constants, and one of
them will be bumped alone.**
`exportArchive.ts` and `importArchive.ts` each hold the interchange schema
version, with a comment explaining the duplication (the reader already imports
from the writer; a cycle would be worse) and a test that pins them equal. Raising
the archive format to `1.39.0` for the rank change, I bumped the reader and not
the writer — so every archive the build wrote declared the OLD era, in which the
reader expects the field it had just stopped emitting, and refused it. *The rule:*
the test caught it, which is the arrangement working exactly as designed — so the
class is not "don't duplicate", it is **a duplicated constant's test is part of
the constant, and a change to one is not finished until that test has been run.**
Where the pairing exists to dodge an import cycle, the cheaper fix is usually to
move the constant to a third module both can import, and that is what this pair
should get the next time either side is touched.

*Recognised 2026-08-08, caught by `importArchive.test.ts`'s own pin before any
build shipped.*

**DC-13 — A monotone-forward column an untrusted session can write is a one-way
ratchet, and the attacker's move is always to slam it to the far end.**
Migration 003 carried a „a tombstone is terminal" rule: `deleted` could go false
→ true and never back. It read as a safety property and was the opposite of one.
Consider the attacker this schema actually fears reaching — a stolen session, no
content key. It cannot resurrect anything, but with that rule in force it could
set `deleted = true` on every row, and no key-holder could ever undo it, because
the honest repair is precisely a write with `deleted = false`. The rule did not
prevent an attack; it converted a repairable one into a permanent one and handed
that upgrade to the exact party it was written against. (It also contradicted a
shipped feature — restore-from-trash — and its security argument did not hold,
since both `version` and `deleted` are in the AEAD associated data, so an old
ciphertext cannot authenticate at a new version anyway.) *The rule this class
produces:* **monotonicity is only safe where the far end is not a loss.**
`devices.revoked_at` qualifies — the far end is „signed out", and re-pairing
recovers it. User data never does. Before adding a „can only move forward"
constraint to a column an untrusted session can write, name what happens when
that session slams every row to the far end, and who can undo it.

*Recognised 2026-08-09 while rewriting the `sync_objects` guard.*

**DC-14 — A constraint that reads two columns is a constraint field-level LWW
cannot see.**
`COLLECTION_DERIVED` held exactly one entry, `tasks.completed_at`, under a doc
saying it listed the columns bound to another column by a CHECK. Probing the
real schema found **eleven** table-level CHECKs over synced collections reading
two columns that both travel as fields. Each is a place where two honest edits
on two devices merge into a row the database refuses to write — and „refuses to
write" is worse than „wrong", because the row cannot be applied at all and the
device it fails on is the one that will look broken. Nothing in `merge.ts` can
see it: field-level LWW is per column by construction, and the constraint spans
columns. *The rule:* **a per-field merge owes an answer to every cross-field
constraint, and the answer must be deterministic** — every device computing the
same repaired row from the same merged state, or the two of them diverge over a
row neither can fix. The half that is built is the ledger (`COLLECTION_COUPLED`)
and the gate that checks it against the real schema in both directions, so the
twelfth cannot arrive unnoticed. Corollary worth carrying: derivation only
solves this pair where the partner column is RECONSTRUCTIBLE from what
travelled, which is why `completed_at` (a time, and the winning `status` carries
its own stamp) was solvable and none of the other eleven are.

*Recognised 2026-08-09, by scanning `sqlite_master` rather than by reading the
migrations — the CHECKs are spread across twenty files and several tables were
rebuilt after they were first written.*

*Closed 2026-08-16 (`22177b2`) by `packages/sync/src/repair.ts`, and the shape of
the answer generalises past this class.* **Repair the PROJECTION, not the state.**
The merged `RowState` is stored and pushed exactly as it merged — both columns,
both stamps — and only the row written into the module table is bent into a legal
shape. That buys three things at once: no new stamps, so nothing echoes and two
devices cannot mint two stamps for „the same" repair; no loss, because the hidden
column is still in the state and reappears the moment the other half changes; and
a real user fix wins automatically, being an ordinary newer-stamped edit. Two
further rules fell out of writing it. **„Newest wins" is not general** — it is
right only where both directions are reachable without inventing the user's data,
and a `kind='cloze'` with no cloze text needs text nobody wrote. **Repairs are
per TABLE, not per CHECK**, because `cards`' three constraints all read `kind`
and repairing them independently lets one undo another.

**DC-15 — A guard that also refuses the correct action will be switched off by
the person it is protecting.**
The web app's `no-restricted-imports` rule was first written as
`patterns: [{ group: ["@nexus/sync-crypto", "!@nexus/sync-crypto/web"] }]`.
`group` entries match the way `.gitignore` matches, and gitignore cannot
re-include a path under an excluded directory — so the negation did nothing and
the rule refused `@nexus/sync-crypto/web`, **the one import the web app exists to
make**. Nothing about that failure says „the rule is too broad". It reads as the
barrel being wrong, and the repair a developer reaches for at 11pm is
`// eslint-disable-next-line` on precisely the line the rule was written to
watch — which switches the guard off at its only real call site while leaving it
green everywhere it does not matter. *The rule:* **a guard must be tested on
what it should PERMIT, not only on what it should refuse.** A refusal-only test
cannot distinguish „correctly narrow" from „refuses everything", and the second
one is self-repealing. Same shape as the positive controls in `01_two_users.test.sql`
(„a wall that denies everyone passes every isolation assertion while the product
does not work"), met here on a lint rule rather than a policy. The fix was
`paths`, which matches specifiers exactly, with the entry list DERIVED from the
package's `exports` map so a future subpath goes red on the commit that adds it
rather than on the commit that imports it.

*Recognised 2026-08-09, by running the rule against a file containing all three
specifiers instead of reading its configuration. Reading it would never have
found this: the config says what it means, and the semantics are in the `ignore`
package.*

**DC-16 — A defence applied per-operation, when its hazard is per-session, moves
the operation's own baseline.**
`pullPage` subtracted the 64-row cursor overlap on every request. The overlap
exists because an identity value is assigned before commit, so a row numbered
below a device's STORED watermark can commit after the device read past it — a
fact about the stored watermark and about nothing else. Applied per request, it
took 64 off the number the walk had just moved forward to: with any page limit
at or below 64 the window never moved and **the walk did not terminate**, and
above it every page of a full hydration re-read 64 rows instead of once at the
start. Both symptoms are the same error, and the unit tests passed through both,
because each individual request was correct — only the sequence was not. *The
rule:* **name the scope a safety margin belongs to, and put the margin in a
function whose name is that scope.** Here that is `pullWindow(cursor)`, called
once per round, with `pullPage(…, fromSeq, …)` taking its argument literally. A
margin whose scope is written only in a comment gets re-applied by the next
person who sees the value it protects.

*Recognised 2026-08-09, by a live test walking five rows two at a time. Nothing
smaller finds it: the defect needs a page limit below the overlap, and every
unit fixture used the default.*

**DC-17 — „Suppressed" and „skipped" both look identical to „considered".**
Two instances in one slice, and they are the same shape. (a) The live test
carried `// eslint-disable-next-line no-restricted-globals` above its `fetch`.
That rule is configured nowhere in this repository, so the directive suppressed
nothing — but it reads exactly like a deliberate, reviewed exception, and the
next person to ask „is `fetch` controlled in packages?" gets *yes* from the
evidence in front of them. (b) Turbo hides every environment variable a task
does not declare, so `pnpm test` reported the live suite as **skipped** with all
four `NEXUS_LIVE_*` set in the shell — and a skip is what a correctly opted-out
run also prints. In both, the artefact that would signal something is wrong is
byte-identical to the artefact of everything being fine. *The rule:* **an
annotation that a control exists is not the control; assert the control from
outside the file that claims it.** For (a) the real permission is the named
entry in `scripts/check-egress.mjs`, and the comment now says only that. For (b)
the fix is declaring the variables in `turbo.json` — as `env`, so the two kinds
of run are different cache keys rather than one shared cached result. Closely
related to DC-01, and worth its own entry because DC-01 is about a gate that
scans nothing, while this is about a gate that was never asked to scan.

*Recognised 2026-08-09. (a) came from ESLint's own „unused eslint-disable
directive" warning, which is the only reason it was ever visible; (b) came from
reading a green run's per-file line instead of its summary.*

**DC-18 — Evidence about a party, writable by that party, is not evidence — and
a default is not a writer.**
`sync_state.updated_at` is commented „when the device last synced" and is the one
value in that table a human would read as proof a device is alive. Migration 002
granted `authenticated` UPDATE on it, so it was the device's own claim about its
own clock, settable to any value including one that keeps a lost device looking
active. The second half is what makes this its own class rather than an instance
of DC-13: **nothing wrote the column at all.** `default now()` fires on INSERT
only, so revoking the grant alone would have frozen it at „when this cursor row
was created" while it went on reading as „last synced" — populated, plausible,
and monotonically wrong, which is strictly harder to notice than a column that
is empty. *The rule:* **for every column the design calls a server fact, check
both halves — that the client cannot state it, AND that something actually
states it.** Either alone produces a value that is worse than absent. Migration
003 had already made this call for `sync_objects`; migration 008 makes the same
rule hold on both tables that carry the column, so it is one rule applied twice
rather than one rule and one exception nobody wrote down.

*Recognised 2026-08-09, while writing the cursor client and asking what the
transport should send for `updated_at`. The answer „nothing, the server stamps
it" turned out to be true of the comment and false of the schema.*

**DC-19 — An assertion whose fixture violates two rules at once proves neither,
and reads as if it proves the one it is named after.**
`05_mk_mint.test.sql` asserted „an aal1 session cannot mint" against a fixture
session that was `aal1` **and** had no `mfa_amr_claims` row. Both guards refuse
it, so the assertion passed — and kept passing with the `aal2` check deleted from
the function entirely, because the AMR check was answering in its place. The
assertion's name, its comment and its failure message all said „assurance"; what
it exercised was „recorded factors". *The rule this class produces:* **a test for
a guard must be run against the function with that guard removed** — nothing else
distinguishes „this assertion covers the rule" from „this assertion covers
something that happens to fire first". And when it does not go red, the fix is
the FIXTURE: make the rule under test the only thing wrong with the input.
Sibling of DC-01, one level in: there the gate covered nothing, here the gate
covers something, just not the thing on the label. Cheap to run — seven guards,
seven mutations, ten minutes — and it is the only way this was ever going to be
found.

*Recognised 2026-08-09, mutating the mint's guards one at a time.*

**DC-20 — A bound stated on one side is not a range, and the unstated side is
where the permanent failure lives.**
`key_wraps_kdf_params_floor` bounded Argon2id cost from below only, because the
danger being reasoned about was „too cheap to resist a dictionary attack". The
other side was left open, and `kdf.ts` — correctly, since the parameters arrive
from a server this design treats as hostile — refuses to derive above a ceiling.
So the schema accepted wraps that no client in the product will ever open, and
for the two `mk_*` slots that is a master key with no route back and no way to
rewrite it. The sharper half: for `parallelism`, higher is *weaker*, so the
unstated side was not merely a usability bound but a security one, and a row
carrying `p = 64` looks stronger than one carrying `p = 1` to anybody reading it.
*The rule:* **when a validator is written as a floor, ask what the ceiling-side
value does — and if any consumer enforces one, the storage layer must enforce
the same one.** A bound enforced only on read is a bound that lets the
unopenable value be written down first. Migration 012 adds the ceiling; the two
copies of the numbers are held together by
`supabase/tests/static/kdf-bounds.test.mjs`, which is DC-12 answered rather than
repeated.

*Recognised 2026-08-09, while deciding whether the `sync-enable` Edge Function
should restate the floor. The answer — „no, the database owns it" — only holds if
the database owns all of it.*

**DC-21 — A test suite that skips when its dependency is absent stops being a
test the moment its dependency changes underneath it.**
`packages/sync-transport/src/live.test.ts` measures the rules this whole layer
rests on — how `bytea` is spelled, that a filter must be percent-encoded and
never quoted, that a PATCH matching no row is a silent 200. It skips without a
running Supabase, which is a deliberate and correct compromise: the alternative
makes the suite unrunnable and it gets deleted within a month. But migration 010
tightened `key_wraps_desktop_only` so that every write to `key_wraps` needs a
live desktop device bound to the caller's session, and the suite's fixture had
no desktop device at all. All twelve tests died in `beforeAll` — and the tree
stayed green, because locally the suite skipped and CI had not run since.
*The rule:* **a schema change that tightens a policy invalidates every fixture
that was on the loose side of it, and the blast radius of a policy is every
fixture that writes to the table, not only the tests named after the policy.**
When a migration narrows a `WITH CHECK`, the sweep is „what inserts into this
table, anywhere" — including test setup, which is the code least likely to be
re-read and the only code whose failure can hide behind a skip. The narrower
lesson worth keeping separately: an opt-in suite is only as honest as the last
time something forced it to run.

*Recognised 2026-08-09, running the transport's live suite for the first time
since migration 010, while adding one test to it.*

**DC-22 — User-facing copy is a claim about behaviour, and nothing in the build
checks it.**
`strings.settings.privacy.offline` told every user that „Nexus proverava samo da
li postoji nova verzija" — a sentence written when an auto-updater was planned,
kept after it was disarmed before 1.0.0, and therefore **false in the shipped
product**, in the one section of the application whose entire subject is what the
app does and does not send. Four gates run over this file and all four passed:
`check:strings` proves the table is not read at module scope, `check:colours`
and `check:tokens` never look at prose, and the type system proves the key
exists. Every one of them checks the *shape* of the copy. Nothing checks whether
a sentence is true, and a promise about network behaviour is the highest-stakes
sentence in the product.
*The rule:* **copy that makes a factual claim about behaviour names the code that
makes it true, in a comment beside the string, and the claim is re-read whenever
that code is touched.** The `privacy` block's doc-comment now does exactly this —
it names `net.fetch` in `main/sync/electronFetch.ts`, `check:egress`, and
`createCloudPorts` returning `null` — so the next person to disarm or arm a
subsystem has the affected sentence pointed at them. The wider corollary: when a
feature is *removed*, the sweep is „what does the product SAY about this",
including copy, and copy is the part with no compiler.

*Recognised 2026-08-09, writing the sync section's copy directly beneath it.*

**DC-23 — A constant standing in for a dimension that is measured at runtime is
right at exactly one viewport.**
`.set__section { scroll-margin-top: calc(var(--nx-space-8) + var(--nx-space-4)) }`
— „one index strip's height plus a step" — so that a card jumped to from the
section index clears the sticky strip. The strip is a wrapping row of links: it
is two or three lines tall at every window size the app actually opens at, and a
different number again as the filter hides sections. The constant was therefore
wrong at **all three sizes in both themes**, and the symptom was a card's title
sitting behind the bar — invisible for a year, because no screenshot scene had
ever scrolled a page before shooting.
*The root cause is a shape, not a number:* CSS cannot make one element's margin
depend on another element's height, and `position: sticky` keeps the bar out of
flow so no layout box carries the measurement either. The platform's answer is
`scroll-margin-top` on the target; the missing half is that the value must be
*published* from the element that owns the height. `stickyOffset.ts` is that
half — a `ResizeObserver` writing `--set-index-height` onto the bar's parent (not
`:root`, so two such bars on one screen cannot collide), with the old constant
kept as the fallback because it is the honest value for the one frame before the
first measurement lands.
*The rule:* **a sticky or fixed bar that something else must clear publishes its
measured height as a custom property; nothing downstream may guess it.** And the
instrument half: a scene that scrolls before it shoots is what makes this class
visible at all — before `settings-sync` there was no frame in 414 that could have
shown it.

**Two instances are OPEN**, both in the notes editor, both the same shape:
`noteTableOfContents.tsx:95` scrolls a heading into view under NOTE's own sticky
toolbar, and ProseMirror's `tr.scrollIntoView()` runs against `.note__find` with
no `scroll-margin-top` at all. Neither has a screenshot scene that scrolls, which
is why neither has been seen. They are the next adoption of `useStickyBarHeight`.

*Recognised 2026-08-09, from the first shots scene that scrolls a page.*

**DC-24 — A one-shot transaction is the only place a future recovery can be
prepared, and it never runs again.**
`nexus_mk_mint` is an atomic singleton by construction — one master key per
account, ever, guaranteed by the very design that makes MK worth having. Every
piece of state a *later* recovery path needs must therefore be written **by that
transaction**, because there is no second one. Migration 011 wrote both key
wraps together for exactly this reason (`mk_under_kwrap` and `mk_under_src`,
„both or neither"), and then stopped one item short: it stored nothing that a
desktop could later use to *prove it holds MK*. That omission is what made a
revoked desktop unrecoverable — the key sat openable on its own disk, the server
had no way to be shown that, and the row it needed could only be bought with the
one thing (`aal2`) that must never buy it. The class is not „a missing column";
it is **a one-shot that did not ask what the account would need on its worst
day.**
*The rule:* **before a one-shot mint ships, enumerate every future path that will
need to prove something about this account, and write the material for all of
them inside that same transaction.** An additive migration cannot fix it later:
the accounts already minted have no way to acquire the value, and a nullable
column is a schema that says „some accounts can never recover" while looking
identical to one that says nothing. Which is why closing this one **dropped and
recreated** `nexus_mk_mint` with a fourteenth parameter rather than adding a
second function — the mint is one transaction or it is not a mint.
*The neighbours to check when this shape appears:* the Recovery Kit's local wrap
(one-shot at account creation), the pairing handshake's transcript, and any
future per-profile content key minted once and wrapped thereafter.

*Recognised 2026-08-09, closing the device-stranding hole.*

**DC-25 — A sentinel of the same type as a valid value is not a sentinel; it is
a valid value that happens to be wrong.**
`parseIntStrict` in the crypto drawer returned `NaN` for „the field does not hold
a number", and `NaN` is a `number`. It therefore passed untouched through every
`kdf?.iterations ?? source.iterations ?? DEFAULT` chain the validators use, and
the first check that noticed was whichever happened to run first — the envelope
parser. Typing rubbish into „PBKDF2 iteracije" while ENCRYPTING produced
„Koverta nije ispravna", about a field that does not exist during an encrypt. The
same sentinel was doing a second job elsewhere: at the PSS salt-length field
`Number.isNaN` meant „empty, use the default", so garbage there was silently
accepted as „default" — one value carrying two meanings that the call sites
disagreed about. *The rule:* **the absence of a value must be spelled in a type
the language can refuse — `null`, not an in-band member of the value's own
type.** `null` cannot be handed to a `number` parameter, so every call site is
forced to say which of „empty" and „nonsense" it meant, and they turn out not to
agree. Sibling of DC-13 in shape (a value that reads as ordinary) but the fix is
at the type, not the schema.

*Recognised 2026-08-10, reviewing the crypto surfaces of the developer drawer.*

**DC-26 — A cap applied at the call site fixes the calls that were noticed; the
class lives in the component.**
`ToolTable` draws every row it is handed. Several tools build one row per unit of
something the user pasted — per character, per code point, per diff run, per
JSONPath hit, per subnet — so a paste of a log file became tens of thousands of
`<tr>`s, rebuilt on **every keystroke** because the field driving them is
controlled. The tempting fix is a `.slice(0, 512)` in the two surfaces a reviewer
happened to open; that leaves five more alive and guarantees the next table
somebody adds is defective on the day it is written. The same component had
already produced the same shape once — one cell type (monospace, `nowrap`) where
the domain has two, which pushed the HTTP-status table 180 px past the window.
*The rule:* **when a shared component owns a dimension — geometry, size, layout —
every rule about that dimension belongs inside it, and a call-site fix is
evidence the component is missing a concept.** The corollary that makes it
honest: a cap must be *stated* („U tabeli je prvih 512 od 12 480 redova"), because
a table that stops silently misreports its input.

*Recognised 2026-08-10, sweeping every `<ToolTable rows={…}>` in the drawer after
one report about one table.*

**DC-27 — Where the discipline is „refuse", every narrowing is a defect, and
narrowings are invisible.**
The whole `@nexus/core/devtools` layer refuses rather than repairs. Four places
repaired anyway, and none of them could be seen: `word >>> 0` in the RISC-V
disassembler turned a 33-bit input into a different, legal-looking word (`0x1_0000_0000`
→ `0`, disassembled with confidence); `& 0xffff` inside `decodeCompressed` did the
same to the upper half of a 32-bit value; `positiveInt(text, fallback)` in the
hexdump tool answered a typed `0` with the default 16, so a wrong setting and a
right one produced identical output; and `parseImmediateText`'s doc comment
claimed a twenty-bit cap it never enforced, which is what made the first
truncation look safe. *The rule:* **a repair leaves no trace, so it cannot be
found by using the product — it has to be found by grepping for the constructs
that repair** (`>>> 0`, `& mask`, `?? fallback`, `clamp`, `Math.min`) **and asking
each one whether the value it silently changed was the user's.** A bound that
exists only in a comment is the same defect one level up: it makes the caller
skip the check it would otherwise have written.

*Recognised 2026-08-10, from one report about a 33-bit disassembler input.*

**DC-28 — A type derived from an overloaded platform declaration means whatever
the ambient `lib` set says it means.**
`type KeyUsages = Parameters<SubtleCrypto["importKey"]>[4]` looks like „whatever
the platform accepts". `Parameters<T>` takes the **last** overload, and adding
`DOM.Iterable` to `lib` appends an `importKey` overload whose `keyUsages` is
`Iterable<KeyUsage>` — so the alias silently became `Iterable<KeyUsage>`, a
`push` on it stopped compiling, and the error surfaced 200 lines away as „No
overload matches this call… 'modulusLength' does not exist in type 'Algorithm'".
*The rule:* **never derive a type from an overloaded declaration you do not
own.** Name the element type and rebuild the shape you want
(`Parameters<…>[4] extends Iterable<infer U> ? U : never`), so the meaning is
pinned to something one overload cannot move. The diagnostic pointing at an
unrelated argument is part of the class: overload resolution reports the *last*
candidate's failure, never the one the author had in mind.

*Recognised 2026-08-09, bisecting a `tsconfig` change against a probe file.*

**DC-29 — A type that permits what the runtime cannot carry is a crash waiting
for the first author who believes the type.**
`LocaleShape<T>` mapped every leaf of the strings table to `string | nested`,
with functions mapped to themselves — so a translator file could legally hold a
function leaf. `strings.ts` `structuredClone`s the whole table at module load,
and `structuredClone` throws `DataCloneError` on a function: 24 interpolating
strings written as `(n) => …` were a **white window at startup**, and they took
29 desktop test files down with them. Nothing was wrong with the code that wrote
them; the type said it was allowed. *The rule:* **when a structure passes through
a runtime boundary — `structuredClone`, `postMessage`, IPC, JSON, SQLite — the
type at that boundary must permit exactly what the boundary carries, and no
more.** Here the fix is one line, mapping the function arm to `never`, which
turns a startup crash into a compile error at the file that caused it. The
replacement for the capability that was removed is `fill(template, values)` —
data, not behaviour.

*Recognised 2026-08-09, when 29 test files went red at once.*

**DC-30 — A result must describe itself; a view that measures a live field to
describe a finished computation is right only until the next keystroke.**
The RSA-OAEP surface showed „Iskorišćeno: {actual} od {limit} bajtova" under a
ciphertext, computing `actual` as `textToBytes(plaintext).length` — from the
live `useState` of the plaintext textarea, not from the message that was actually
encrypted. Type one more character and the row describes a ciphertext that is
still on screen with a number that no longer belongs to it, and the `limit` beside
it *does* come from the result, so the two halves of one sentence are about
different moments. *The rule:* **whatever an async result is described by must
travel inside that result.** The fix is in the module, not the surface —
`RsaCryptOutput` gained `plaintextBytes` — because otherwise every future caller
gets to make the same mistake, and it is the kind that no test written from the
same misunderstanding will catch.

*Recognised 2026-08-10, reviewing the crypto surfaces.*

**DC-31 — A field written for developers becomes product copy the moment a
packaging tool reads it, and nothing in the build says which audience a string
belongs to.**
`apps/desktop/package.json`'s `description` is an architecture note — „Electron
main/preload/renderer with the real SQLite database in the main process behind a
typed, allowlisted IPC bridge (ADR-001, SEC-EL)" — written for whoever opens the
manifest. electron-builder treats that same field as the product's one-line
description, so **the 1.1.0 installer already on the founder's desktop carries it
as its Windows file description**: it is what Explorer's properties page shows and
what the SmartScreen prompt puts under „Nexus". The Linux work surfaced it because
the generated `.desktop` entry put the identical sentence in `Comment`, where it
would have been the menu tooltip. Neither surface is reachable from the app, so
neither was ever looked at, and `check:strings` cannot see it — the string never
enters the strings table at all. *The rule:* **a field consumed by a packaging
tool is user-facing copy regardless of what it was written for, and the fix
belongs in the packaging config rather than in the developer's field** — one
`extraMetadata.description` in `electron-builder.yml` now feeds every target,
Windows and Linux, in Serbian like the rest of the app. *The neighbours to check
when this shape appears:* `productName`, `copyright`, `author`, the NSIS
uninstaller's display name, and anything else a build reads out of a manifest
written for humans on the other side of the product.

*Recognised 2026-08-10, reading the generated .desktop entry out of the AppImage
— then confirmed against the shipped `Nexus-Setup-1.1.0.exe` rather than assumed.*

**DC-32 — A response that bundles facts of two different lifetimes fails whole
whenever the shorter-lived one is absent, and the caller that needed only the
long-lived half pays for it.**
`AppInfo` carried the build's name and version, the device's userData path, the
engine versions — and `databasePath`, which needs a *selected account*. The title
bar asks for this at mount to print the version, which on a first run is before
any account exists, so the whole call rejected: the version line silently
disappeared from the menu (its `.catch` is correct and made the failure
invisible) and main logged „Internal error: no local account is selected" for the
most ordinary state the app has. **Nothing had ever read `databasePath`.** *The
rule:* **a response's fields must all be answerable from the same scope; a field
that needs a narrower one belongs on a call that is about that scope.** The fix
removes the field rather than making it nullable, because a nullable field
invites a caller to handle a case that should not exist in this shape at all.
*Blast radius, checked rather than assumed:* every other main-process reader of
the active account goes through `requireDb()`, whose handlers are unreachable
until the session is unlocked — `appInfo` was the only mixed-scope response.

*Recognised 2026-08-10, from the main-process log of the first Linux launch —
found by RUNNING the packaged build, which is a thing the Windows exe had never
been asked to do on a machine with no account on it.*

**DC-33 — An unset packaging field is not empty; it ships the toolchain's own
answer under the product's name.**
Working DC-31's „neighbours to check" list found `author` missing from
`apps/desktop/package.json`, and missing is worse than wrong here.
electron-builder derives `appInfo.companyName` from `metadata.author.name`, and
`winPackager` writes the `CompanyName` resource **only when that is non-null** —
so the resource compiled into the Electron binary survived untouched, and every
shipped Nexus told Explorer's details page it was made by **„GitHub, Inc."** The
same absent field is the NSIS uninstall key's `Publisher`, so Windows'
installed-apps list showed the publisher column blank next to a commercial
product. Both were read off the shipped 0.1.0, 1.0.0 and 1.1.0 binaries, not
inferred. *The rule:* **a packaging field left unset inherits a default from
whoever built the toolchain, so the audit question is never „is this field
right" but „what is in the artifact where this field would have gone".** The fix
is one `author` object in the manifest, because that is the single source the
packager reads for both surfaces. *The wider finding, which is the more useful
one:* nothing in this repo had ever read the resource block back out of a built
binary — DC-31 and DC-33 are one unaudited subsystem sampled twice, and the
audit that closes it is dumping every VERSIONINFO string from the installer and
the app executable and reading them, which is now what the wave entry in §3
records having done.

*Recognised 2026-08-10, by walking DC-31's own neighbour list instead of
treating DC-31 as finished.*

**DC-34 — A gate scoped to a window reports success as soon as the problem
leaves the window, so a failure nobody acts on the same day stops existing.**
`gitleaks-action` scans `base^..head` on `push` and the whole history only on
`schedule`, and exposes no input to change that. Run `30624013396` failed on
2026-07-31 on a fixture in `privEnvelope.test.ts`; the next push was green
because the scanned range had moved past that commit, and the repository stayed
green for ten days with the finding still in it, until the first scheduled full
scan reported the identical line. Nothing was fixed in between — the failure was
**outlived**. The badge was never lying about what it measured; it measured „the
last push added nothing" and was read as „the repository is clean". *The rule:*
**a gate whose coverage depends on its trigger cannot be read as a statement
about the repository, so either the coverage is made trigger-independent or the
green is not evidence.** Here every event now scans the whole history, which
costs about seven seconds. *The neighbours to check when this shape appears:*
any gate that diffs rather than sweeps — a lint run over changed files, a
coverage delta, a migration check keyed to the current branch point.

*Recognised 2026-08-10, from the scheduled and push runs of the same workflow
disagreeing 90 seconds apart, each reporting a finding the other could not see.*

**DC-35 — A test whose runtime is dominated by its assertion rather than by the
behaviour under test is a flake waiting for a slow machine.**
`bytes.test.ts`'s „survives an input far past the argument-count limit" timed
out on CI at 6 802 ms, and the obvious reading — the codec is too slow — was
wrong. Measured: the codec does 300 000 bytes in 13.9 ms and is flat per byte
from 37 500 to 600 000; **`toEqual` on the resulting 300 000-element pair cost
370 ms of the test's 390 ms**, because structural equality walks the pair at
about 1.1 µs per element. The test was paying seventeen times the cost of the
thing it existed to check, and a runner three times slower than a laptop was
enough to cross the default timeout. *The rule:* **an assertion is part of a
test's cost, and an assertion asymptotically more expensive than the code under
test makes the test a measurement of the runner.** The fix compares lengths and
then the first differing index — 19 ms, and the failure names one byte instead
of printing three hundred thousand. *The second half, which is the more useful
one:* the same CI run had `RestoreStore > T10` **passing at 4 332 ms** under a
5 s default nobody chose, with six more between 3.4 s and 4.2 s. A gate with
668 ms of headroom fails a different test every time the runner is busy, and
that reads as „flaky CI" rather than as a finding.

*Recognised 2026-08-10, by timing the two halves of the failing assertion
separately instead of raising the timeout.*

*Still recurring, and the second instance is the same lesson from the other
side.* On 2026-09-23 `check-copy.test.mjs` walked the whole repository **three
times per run** — once for the census, and twice inside the verdict's test,
because `scanRepo()` IS `findings(repoCopyLeaves())` and the call beside it
walked the tree again. One walk measures 7.3 s against this tree's ~15 900
leaves, so 22 of the file's 35 seconds were the same work on the same unchanged
tree. It passed here with the verdict's test at 14.7 s against a 30 s budget,
and went red on CI's four-core runner with „Test timed out" — a message naming
neither the gate's subject nor the cause. **The budget had already been raised
once for this suite**, 5 s → 30 s, and `vitest.scripts.config.mjs` carries the
reasoning; a third raise would have been the same answer twice. The fix is the
memo: one walk per file, 8.9 s, and the census and the verdict now describe the
SAME walk, so „found nothing" and „looked at less than it should" cannot come
from two different readings of the tree.

**DC-36 — One byte can make a whole file invisible to every text-based gate,
and the gate reports nothing rather than reporting a gap.**
`packages/core/src/devtools/jsonTypes.test.ts` held a raw `0x00` at offset 2876
— a fuzz input written as a literal NUL instead of as `"\x00"`. Git's binary
heuristic reads the first 8 000 bytes, so `git log -p` emits „Binary files …
differ" for that file forever, and the secret scan reads exactly that patch:
**the file has never been scanned, and a secret committed into it would have
been invisible.** It is also unreviewable — `git diff` shows nothing for it.
Nothing in any log distinguishes „scanned and clean" from „skipped". *The rule:*
**a gate that walks text has a binary classification underneath it, and that
classification is a silent exclusion list nobody wrote.** The escape produces an
identical runtime string, so the fix costs nothing. *The neighbours to check:*
every other gate in this repository that walks files — `check:colours`,
`check:strings`, `check:tokens`, `check:css`, `check:egress`,
`check-rls-wall.mjs` — reads bytes directly rather than through git, so this
one file was opaque only to the git-based scan; that is a fact that was checked,
not a fact that was assumed.

*Recognised 2026-08-10, by a NUL-byte sweep run precisely because grep would
have been blind to the same file — grep prints „Binary file X matches" and
suppresses the lines, so four separate content sweeps had silently skipped it.*

**DC-37 — A name only one side of the app knows fails silently in whichever
direction it was broken, and both directions look like „it works".**
Renaming the professional drawer surfaced three instances of one class at once.
`.tool--developer` was still the selector for the drawer's entire DENSITY block
after the modifier had become `.tool--professional`, so those rules had stopped
applying to anything and the drawer had been rendering at „Alatke" density with
nobody noticing. `.onb__demo` was the same failure inverted: a class rendered by
the questionnaire with no rule anywhere, so its label and its caption sat flush
against each other. And the demo profile enabled every MODULE but no `pack:*`
row, so `--demo` and the screenshot sweep would both have opened the newest
surface in the app onto an empty list — with the sweep reporting „found nothing
to fan out", i.e. a false alarm about a drawer that works. *The rule this class
produces:* **a class name, a flag key or an id is a contract between two files,
and nothing in TypeScript, CSS or SQL is checking that both ends exist.** CSS
drops an unmatched selector and an undefined custom property in silence; a
`feature_flags` row is a free-form string; and a renamed React class name
compiles. `check:tokens` already closes exactly this hole for `var(--nx-*)`,
which is the shape of the fix: the missing gate is the same walk over CLASS
names — every `className` literal in the renderer resolves to a rule in some
stylesheet, and every rule is reachable from some `className`. Until that exists,
the discipline is manual: a rename greps for the old name across *all four*
languages, never only the one being edited.

*Recognised 2026-08-13, while renaming „Programerske alatke". None of the three
had a failing test, and two of them had been shipped in 1.0.0.*

**DC-38 — A helper that cannot be imported gets written again, once per file,
with a different bug in each copy.**
`result.ts`'s guards were spelled `isPositive(value: number): boolean`. Every
optional input in the drawer is `number | undefined`, so at each call site the
choice on offer was a non-null assertion or a private copy — and three toolkits
wrote the copy, correctly preferring it. The same shape produced four private
`roundHalfUp`s, one `round9`, one `roundTo`, one private `quotient` and nine
inline `Math.ceil(x - 1e-9)`s. Two verification rounds over 274 tools returned 63
correctness findings and **36 of them were the same defect**: a divisor that
reached the division unguarded, whose symptom is `Infinity` and whose appearance
on screen is „∞ mm" — which reads as a rendering bug, not as arithmetic that
should have refused. Nothing in review looks wrong: every copy is three obvious
lines, and every copy agrees with its own tests.
*The rule:* **when N call sites reinvent one helper, the defect is in the kit's
SIGNATURE, not in the call sites.** The guards were widened to take
`number | undefined` and to return type predicates — which removes the reason to
copy rather than forbidding the copy — and `quotient`, `snap`, `floorSnapped`,
`ceilSnapped` and `roundHalfUp` were added beside them, each with the failing
vector that produced it kept as a regression (`3.3 / 1.1` is `2.9999999999999996`
and floors to two hives; `Math.round(-2.5)` is `-2` and every invoice wants `-3`;
an absolute `1e-9` is twenty times a quantity of `5e-8` and far below one ULP of
nine hundred million). `check:pro-math` is the half that keeps it fixed: it fires
on a private copy of a kit name, on an absolute epsilon INSIDE a rounding call,
and on a division by an input field the function never guarded — and deliberately
not on `Math.floor(a / b)`, which was measured at 137 sites, nearly all integer
calendar arithmetic, and a gate with 137 findings on its first run is a gate
somebody switches off.

**DC-39 — A regex deletion with an optional prefix deletes from the first
candidate in the FILE, not from the nearest one.**
The codemod that removed those private copies was
`\n(?:/\*\*[\s\S]*?\*/\n)?function positive\(…\)…\n\}\n`. The lazy quantifier
looks safe and is not: a regex engine takes the LEFTMOST match, so the engine
started at the first `\n/**` in the file and expanded `[\s\S]*?` across 214 lines
of real code to reach the `*/` immediately above the guard. Two hundred and
fourteen lines of `pro/gradnja.ts` — four angle constants and the whole stair
block — were replaced with a newline. The script's own safety assertion,
`hits.length !== 1 → refuse`, **passed**, because there was exactly one match and
it was enormous. Only `gradnja.ts` lost code; in the other two files the guards
happened to sit near the top with a short comment above them, which is the sort
of luck that decides whether a defect of this class is noticed at all.
*The rule:* **a codemod that DELETES asserts on the size of what it removes, not
only on the count** — and an optional comment prefix is written so it cannot span
a comment terminator (`(?:/\*\*(?:(?!\*/)[\s\S])*\*/\n)?`). Recovery was possible
only because a pre-damage copy happened to exist in the scratchpad; `git` held a
130-line ancestor that predated the work.

**DC-40 — A formatter and a parser written apart are not inverses, and the
failure renders as an empty field.**
`proNum` formats in `sr-Latn`, which groups with a full stop: 1 234 567,89 prints
as „1.234.567,89". The parse each of the 274 surfaces was about to copy was
`text.trim().replace(",", ".")` and `Number(...)`, which turns that into
„1.234.567.89" → `NaN` → `undefined` → **the field reads as empty**. Copy a result
out of one professional tool, paste it into the next, and the second tool shows
nothing at all. The two functions were written months apart, both are obviously
correct on their own, and no test had ever run one against the other.
*The rule:* **where a product displays a value and takes it back, the parse is
defined as the formatter's inverse and a round-trip test over real values is part
of the pair.** `proParse` now is that inverse — last-separator-wins for a mixed
pair, repeated separator is grouping, and the one genuinely ambiguous shape
(`\d{1,3}.\d{3}`) is resolved towards the app's own output because that is the
misreading a user can actually reach by copying inside the app.

**DC-41 — A partition by a field that may be absent drops the row instead of
failing.**
The generator that writes the three shared files groups the catalogue by
`owner`. `rebate-chain` had no `owner`, so it appeared in the name table, in the
blurb table and in NO registration array: a tool with arithmetic, hand-derived
tests and Serbian copy that the drawer could never show. The output was 273 where
the catalogue held 274, and nothing about a 3 792-line generated file looks one
entry short.
*The rule:* **a generator that partitions asserts that the partition covers its
input, and derives a missing key where the rule for deriving it is already
written down.** Ownership is „the first pack in `TOOL_PACKS` order", which has no
judgement in it, so the generator now derives it — and still refuses the run if
any entry lands in no group.

**DC-42 — Guarding every input proves nothing about a product of inputs.
Finiteness is a property of the RESULT.**
`sectionProperties` checks every dimension it is given: positive, finite, inside
a band. A rectangle of 1e-200 mm × 1e-200 mm therefore passes every guard the
function has — and `1e-200 × 1e-200` is `1e-400`, which is below the smallest
double and rounds to exactly zero. Area zero, section modulus zero, so
`bendingStress = M·1000 / 0` is `Infinity` and `radiusOfGyration = sqrt(0/0)` is
`NaN`, both returned on an `ok: true` result and both printed by the surface as
readings — in a `life-safety` structural stress tool. The same shape appeared a
second time one layer up and had been there from the first line of the kit:
`ratioAgainst` checked the LIMIT for finiteness and never the VALUE, on the
reasoning that the value is computed by the tool and therefore sound. `Infinity`
over an allowable of 235 is `Infinity`, and it reached the screen wearing the
authority of a comparison against the user's own limit.
*The rule:* **a guard on the inputs is a guard on the inputs; where a DERIVED
quantity will be divided by, the check belongs on the derived quantity, at the
one seam where it is constructed.** One `finiteSection` in front of five shape
branches, not five checks in front of five divisions — because the class has to
be unrepresentable, and the sixth caller will not know to write the sixth check.
The kit's own functions follow the same rule for the same reason: `quotient`
already checked its result (`1e308 / 1e-308` overflows from two divisors that
both passed), and `ratioAgainst` now checks its value. Neither half had a failing
test, and neither could have: every test in the suite was written in realistic
millimetres, which is the range where the defect does not exist. It was found by
an independent verifier reading the arithmetic and asking what the extremes of
a double do to it.
**This class deliberately gets no gate, and the measurement is the reason.** The
mechanical rule — „a local bound to a product, used as a divisor, that nothing in
the body proves positive and finite" — was written and run before being proposed:
**92 candidate sites across 15 files**, and the great majority are ordinary and
correct (a `dL = l2 - l1` inside CIEDE2000, a sum of squared deviations, an area
that is only ever a ratio's numerator). A rule at that precision is DC-38's own
lesson repeated. What generalises instead is the kit: `quotient` already refuses
a zero or non-finite divisor **and** checks its own result, so routing a
dangerous division through it is both the fix and something `check:pro-math`
recognises. The audit is therefore a read-and-re-derive pass over the seams, not
a regex.

**DC-43 — A string union is a claim the caller makes, and an `===` chain always
ends on a branch. 129 sites, and the whole class was admitted by one cast.**
An audit of all seventeen toolkits for „a selector value used without being
checked" returned **129 instances across 15 files**, in two shapes. Shape A
indexes a constant table: `SHEETS[input.sheet]`, `PACK_UNITS[input.packUnit]`,
`FLOW_UNIT_IN_M3S[flow.unit]`, `PERIODS_PER_YEAR[target]`, `branches[input.order]`
— and because `noUncheckedIndexedAccess` only fires when the key type is `string`,
a `Record<Union, T>` indexed by that union is *believed* to be defined, so nothing
forces a check. Four of those throw a `TypeError`; three return `NaN` on an
`ok: true` result. Shape B is the `===` chain: `material === "aluminium" ? … : …`
silently means copper, `method === "simple" ? … : …` silently means compound
interest, and `beamCheck`'s `switch` default is not a refusal but the
cantilever-point formula.
*Two corrections to the record, because an inaccurate one is worse than an open
one.* First, **the audit was briefed wrongly and its severity is overstated**: it
was told these functions run in the main process over IPC. They do not — the
professional tools are imported straight into the renderer, exactly like the
forty-eight devtools, and no `pro/` symbol is reachable from `main/`. So this is
not a boundary defect and nothing in it is a security hole. Second, what actually
kept it unreachable was **not** that the tools validate: it is that `ToolSelect`
is generic in `T`, so TypeScript rejects an option id outside the union at every
one of the 274 surfaces.
*The rule:* **where a whole class is prevented by one component, read that
component before concluding the class is prevented.** `ToolSelect` ended
`onChange(event.target.value as T)` — a `DOMString` asserted to be a member of the
union, once, in the file every surface imports. That single cast admitted all 129,
and it is reachable without any bad faith: a controlled `<select>` whose options
narrow while `value` still holds the old selection shows the browser's fallback
while the state keeps the stale one, so the user reads one branch off the screen
and the tool computes another. It now resolves the emitted string against the
options it actually rendered, and returns a value that was really on offer — one
edit, 274 surfaces, no `as` left. The seven Shape-A sites were fixed with
`isKeyOf` regardless, because a thrown `TypeError` and a `NaN` are defects at any
trust level, and because a union widened without its table being widened compiles.
*And the subsystem answer, which is the useful one:* **nothing in this drawer was
ever designed to validate a selector.** Seventeen authors wrote seventeen files
and sixteen of them trusted the type. The seventeenth, `muzika.ts`, wrote
`isKeyOf` and `isOneOf` privately with a comment explaining why the union could
not be trusted — DC-38's exact shape, and the signal that the kit was missing
something every file needed. Both now live in `result.ts`. The remaining ~121
Shape-B chains are not reachable through the UI as it is built and each is a
wrong answer rather than a refusal if it ever becomes reachable; they are the
standing work item, and the discipline until then is that a selector's branches
are exhaustive with a refusal at the end, never a fallthrough.

**DC-44 — 168 confirmed findings, four of them reachable. Severity is a property
of the repro, and an audit that does not grade it turns signal into volume.**
DC-42's blast radius was measured properly: eighteen readers over
`packages/core/src/pro/*.ts`, then a second agent per pack briefed to REFUTE each
claim, re-derive the arithmetic and reject any repro a guard would catch. **168
survived, at 143 distinct seams** — a number that reads like a subsystem in
ruins. Grading each repro by the magnitude of the input it needs says something
else entirely: **163 of the 168 require a value no user can produce** — 1e300
hectares, 1e308 kg of livestock, a subnormal 1e-320 passed as a unit override.
One more needs 1e6. **Four are reachable, and two of those are not extreme at
all**: `parseTimecode` and `subtitleAudit` read a subtitle's hour field through
an unbounded `(\d+)`, and `Number("9".repeat(400))` is `Infinity` — which is what
a truncated or mis-encoded paste looks like, not an attack. Those two returned a
duration of `Infinity` on an `ok: true` audit.
*The rule:* **grade the reach before acting on the count.** The two findings that
mattered were, in the returned list, indistinguishable from a hectare count of
1e300. The grading was four lines of arithmetic over the returned JSON, and it
changed the work from „143 seams" into „two regexes" — both fixed where the bound
belongs, in the pattern, so that a non-finite number cannot be *parsed* rather
than being caught downstream of a parse that already produced one. The other 164
are kept in full in [dc42-findings.md](dc42-findings.md) with each one's reach
marked: they are real, they are cheap to close when a file is next opened, and
re-deriving them would cost another 3.7M tokens.
*The second-order finding, which is about `isPositive`:* all 163 have one shape —
an input guarded `isPositive` (finite, above zero, **no ceiling**) multiplied by
another input guarded the same way. `isInRange` sat in the same kit, unused. That
is DC-38 from the other side: not a missing helper, but the wrong one being the
easiest to reach, in a drawer that has no notion of a plausible magnitude for a
physical quantity. The standing item is that every physical input carries a real
band — which is also the better product behaviour, since a band catches the typo
that a positivity check waves through.

**DC-45 — An absolute epsilon on a magnitude-dependent value, in a layer the
gate could not see.** The Serbian amount-in-words tool decided whether a typed
figure had more than two decimals with
`Math.abs(x * 100 - Math.round(x * 100)) > 1e-6`. Both halves are wrong. The
tolerance is absolute and the error in `x * 100` is proportional, so the test
holds up to 2^27 and then starts refusing ordinary money: **612 068 388,17 gives
61 206 838 816.999 99, misses by 1e-5, and the tool says „that is not a legal
amount."** Above 10^8 it refuses roughly one amount in eight. `Math.round` is
also the wrong rounder for money in a drawer where negatives are ordinary
(`Math.round(-0.5)` is `-0`).
*The rule:* **a tolerance that does not scale with the value is not a tolerance,
it is a magnitude limit nobody wrote down.** Fixed once, in the kit:
`minorUnits(amount, digits)` returns the integer minor units or `undefined`, with
the tolerance derived from the value (`max(|scaled|, 1) * 8 * EPSILON`) and a
`Number.isSafeInteger` ceiling so it refuses where the float itself stops being
exact rather than where a constant happened to fall. Adopted at both money sites
in `racunovodstvo.tsx`.
*The finding under the finding, which is the more useful half:* **the gate
written to catch exactly this construct did not read the file it was in.**
`check:pro-math` globbed `packages/core/src/pro/*.ts` only — the surfaces were
never scanned, on the assumption that a surface does no arithmetic, which is the
assumption the defect violated. Its `EPSILON` pattern did not match `1e-6`
either; it started at `1e-7`. Both corrected: the gate now reads the 17 surfaces
as well, matches `1e-4` upward and `Number.EPSILON`, and fires on an epsilon
anywhere on a line containing a rounding call rather than only inside its
arguments. Measured after the fix: **2 epsilon sites in 42 800 lines of surface
code**, one of them the defect and one a legitimate tolerance between two
constants 0.27 apart. *A gate's reach is part of the gate.* A rule that reads
half the tree reports success about the other half.

**DC-46 — A core default restated in the surface, so „the default" has two
authors.** `zanat.tsx` echoed the shelf raster the user did not type as
`proParse(rasterText) ?? 32`, and `shelfSpacing` in the core applies its own
`?? 32`. The number agreed, so nothing was visibly wrong — until either one
changes, at which point the screen reports a value the arithmetic did not use,
which is the worst available failure for a tool whose whole product is a number
somebody will act on. Measured across the drawer: **eight sites in six packs**
(`zanat` 32, `inzenjering` 20/50/100, `muzika` 20, `nekretnine` 100, `event`
400), distinguishable from ~24 benign sites where the *surface* owns the default
and passes it in — which is fine, because there the surface is the single author.
*The rule:* **a default is a fact about the calculation, so the calculation
reports it.** Fixed properly at the reported site: `ShelfSpacingResult` gained
`rasterUsed`, the surface reads it, and three assertions pin it (defaulted,
explicit, and `undefined` when snapping is off). The other seven are scheduled;
they are the same edit each time.

*Re-measured 2026-08-14, once every surface was wired and greppable.* The
numeric restatements are the seven named above — `batteryBankRuntime` 100,
`cableCrossSection` 20, `inductionMotorRating` 50, `reverbTime` 20,
`soundWavelength` 20, `rentalYield` 100, `threePhaseLoadBalance` 400 — each
confirmed against the `input.x ?? N` line in its own core function. But the
class also wears **string clothing**, which the first count missed because it
does not contain a `??`: nine more echo entries of the shape
`series.trim() === "" ? "1"`, in three packs, printing a literal for a field the
user left empty while the core applies its own `?? 1`. Same defect, same fix —
the screen must not be the second author of a number the arithmetic chose. True
size of the class: **sixteen sites, one fixed.**

**DC-46 is now CLOSED (2026-08-14).** Nine core functions gained a resolved-value
field — `batteryBankRuntime` (`seriesUsed`, `parallelUsed`, `efficiencyPctUsed`),
`cableCrossSection` (`conductorTempCUsed`), `inductionMotorRating`
(`frequencyHzUsed`), `soundWavelength` / `reverbTime` / `roomModes`
(`temperatureUsed`), `rentalYield` (`occupancyUsed`), `threePhaseLoadBalance`
(`lineVoltageUsed`), `billableHours` (`intervalMinutesUsed`) and `pistonForce`
(`rodMmUsed`) — and every surface now reads them. The assertions pin each field
in both its defaulted and its explicit state, and each one also pins the quantity
that field decides — the synchronous speed against the frequency, the pack
current against the efficiency, the effective income against the occupancy — so a
field that stopped tracking the arithmetic fails rather than merely disagrees.

Two things only appeared once the type was made to state the truth:

  - **`soundWavelength` had no temperature to report on one of its paths.** A
    speed typed in directly is not derived from any temperature, so
    `temperatureUsed` is `number | undefined` there — and the old surface had
    been printing „20 °C" beside a speed the user had measured themselves. The
    compiler refused the naive read the moment the field stopped lying, which is
    the fix catching a second defect before it shipped.
  - **Three of the restatements were benign and stay as they are.** In
    `budgetPerGuest` the surface passes `proParse(tables) ?? 0` itself, so the
    surface IS the single author and its echo reports its own value. The
    distinguishing question is never „is there a literal in the surface" but
    „who chose it".

**DC-47 — Correlated optional fields declared independently, so a wrong guard
type-checks and prints a number that is not true.** `grainMoistureShrink`
returns `grossValue`, `netValue` and `valueDifference` as three separate
`number | undefined` fields, but all three are `undefined` together — they exist
exactly when `pricePerKg` was given. The type does not say that, so the surface
guards on one of them and writes `?? 0` on the other two. Where the guard is the
right field, the fallback is dead code and merely noise. Where it slipped, the
tool prints **0** for a quantity that has no value at all — and this is not
hypothetical: `transport.tsx` guarded three result rows with `"front" in result`
when `front` exists on *both* members of the union, so the guard never
discriminated and the rear-axle figures rendered from the wrong branch. That was
found by reading, not by a gate; nothing in the type system objected, because
nothing in the type system had been told the fields travel together.

Two sub-shapes, and only the first is a defect:
  - **correlated optionals** — `grossValue`/`netValue`/`valueDifference`,
    `actualEnergyMJ`/`actualEnergyKWh`: `undefined` together, declared apart.
  - **a lie about presence** — `minimumEnergyMJ`/`minimumEnergyKWh` are computed
    unconditionally and can never be `undefined`, yet are declared optional, so
    every surface writes a fallback for a case the arithmetic cannot produce.

*The rule:* **fields that appear and disappear together are one optional field,
not several** — a group the surface must open before it can read anything
inside, and a field the arithmetic always produces is not optional. Then
`?? 0` is not something a surface author can write, and the wrong guard stops
compiling.

**The census was re-done with the type checker, and the first grep count was
wrong (2026-08-14).** The earlier line here said „172 `result.X ?? 0` sites in
9 packs", counted by grep. Grep cannot answer either question that matters, and
it was wrong in both directions. A TypeScript program over
`apps/desktop/tsconfig.web.json` finds **1 193** `?? 0`/`?? ""` expressions in
the drawer, of which **995 are `proParse(field) ?? 0`** — reading an empty text
box, the correct idiom, not this class at all. That leaves **198 property
reads**. For each, the compiler was asked whether the operand can actually be
`undefined` *at that point*. Seven expressions in the whole drawer provably
cannot be, six of them property reads — `inzenjering.slipPercent` ×4 and
`event.twoPointForceAKgf` ×2, both narrowed by a guard above — and those
fallbacks are dead code rather than a false zero. The class is therefore **192
property-read sites across 87 declarations in 12 packs**, and the script that
measures it lives in the session scratchpad as `dc47-map.mjs`.

**Progress (2026-08-14): 79 of 192 closed, in three commits.**
`965f20c` — agro honey (`drying`/`jars`/`value`), irrigation
(`sprinkler`/`drip`, where the type now also says the two method groups are
mutually exclusive, which a row of independent optionals cannot express at all)
and the grain shrink (`value`/`actualEnergy`, plus `minimumEnergyMJ`/`KWh` made
required — the second sub-shape, a field the arithmetic cannot fail to
produce). `7a33634` — the fertiliser blend (`target`: eight fields the old code
returned as a block of eight consecutive `undefined`s, which is as plain a
statement as there is that they are one thing), planting density
(`onParcel`/`desired`) and machine field capacity (`fuel`/`turns`, with
`fuel.cost` nested one level down because the money pair needs a price the
litres do not).

**DC-47 IS CLOSED (2026-08-15). The census reads zero across all seventeen
packs.** Nine commits: `965f20c`, `7a33634`, `9c33dbe` (agro), `621f7af`
(event), `a6ed51e` (prosveta), `7c49166`, `4aca0f0` (inženjering), `9ff796c`
(zanat) and `80106e1` (foto, biznis, transport, nekretnine). The last one also
took `kuhinja.test.ts`'s no-verdict check from `Object.keys` to a recursive
walk, which was DC-45 sitting in the third file of the same shape.

**Five live defects came out of it, none of which was the thing being fixed.**
That is the argument for doing the whole class rather than the reported
instance, and each is written up where its pack is:

  1. **The rigging tool could report the wrong leg.** `transport.tsx` guarded
     three rows with `"front" in result` where `front` exists on *both* members
     of the union, so the guard never discriminated.
  2. **The induction motor threw away its slip figure above synchronism.** The
     core returns a negative slip deliberately; the screen printed only the
     words „generatorski rad" and dropped the number, while the clipboard kept
     it — so what the user read and what they pasted disagreed.
  3. **The mitre tool showed one measurement on two rows.** `lengthToLongPoint`
     was assigned from the `outsideLength` variable — the same variable, not a
     coincidence of inputs — so two labelled rows asserted by their layout that
     they were different measurements. They cannot be: the long point of a
     mitre IS the outside corner.
  4. **The fuel tool put a freight rate on the clipboard that the screen
     refused to show.** A laden distance of 0 is a legal entry; tonne-kilometres
     are then an honest 0 and a cost *per* tonne-kilometre is nothing at all.
     The screen drew no row. The copy button guarded on `tonneKm` and printed
     `costPerTonneKm ?? 0`, so the clipboard read „0,00 RSD/tkm".
  5. **The IRR was one step from the same thing.** `irrOutcome === "found"`
     guarded a read of `irr ?? 0`, and an internal rate of return of exactly
     0 %/period is both a plausible number and a completely wrong one. The
     outcome is a discriminated union now, so the guard IS the read.

Alongside those: four figures the screen had and the clipboard did not, one the
core computed that neither showed, and one union member the surface would have
rendered with the wrong word.

**What the census still lists is not this class, and is left alone.**
`rows[i]?.name`, `lines[i]?.unit` and `options.find(…)?.label` are
`noUncheckedIndexedAccess` and `Array.find` artifacts on *required* fields — the
access can fail, the field cannot be absent. `trening`'s `unit ?? ""` is an
optional free-text unit with a deliberate empty rendering and no correlated
sibling. Recognising these as false positives is part of the class: the tell for
DC-47 is a `?? 0` **under a guard on a sibling**, not a `??` on its own.

**A method note worth keeping.** The test rewrites are done by a script that
asserts every match is unique before it writes anything, and that assert earned
its place immediately: `agro.test.ts` held two byte-identical assertions,
`expect(r.rowsCount).toBe(0)`, in two different tools — one on
`plantSpacingDensity`, whose `rowsCount` moved into a group, and one on
`orchardTrellisLayout`, whose `rowsCount` is required and must not move. The
run stopped instead of silently editing the wrong tool.

**DC-48 — The layout audit reported 726 surfaces overlapping, and every one of
them was the app working.** DC-01's inverse for the second time, and worth its
own entry because the *reason* is new. The audit skipped an element when it was
`display: none`, `visibility: hidden` or `opacity: 0` — three properties, named
one at a time. A fourth exists: Chromium hides a closed `<details>`'s contents
through `content-visibility` on `::details-content`, which does not paint the
subtree but does keep a layout box, and `getComputedStyle` on a descendant still
answers `display: block; visibility: visible; opacity: 1`. So every collapsed
risk notice in the professional drawer — the disclaimer the whole toolkit wave
exists to show — measured as a paragraph sitting on top of the first field below
it. **Enumerating the ways a box can be invisible was the mistake.**
`Element.checkVisibility()` is the platform's own predicate, it accounts for
`content-visibility`, and it also catches an ancestor at `opacity: 0`, which the
property test never did.

The same sweep exposed a second mechanism defect in the same loop: the
„painted outside the window" check compared an element's RAW rect against the
viewport, so content inside a horizontal scroller — which is wider than its
scroller by design — was reported as offscreen. It reads the clipped box now, and
the finding correctly moves to the scroller, which is the element somebody can
actually fix. Together: **nine distinct findings over ~750 surfaces became two
over eleven**, and the two that remain are real.

*The added rule:* **when the platform has a predicate for the thing you are
testing, use the predicate.** A hand-rolled list of the ways a condition can hold
is only ever as current as the day it was written, and this one was silently a
version of Chromium out of date.

**A gate that is a string is a gate nothing reads (2026-08-14).** The audit runs
in the renderer, so it lives in a template literal — `tsc` sees characters,
ESLint sees characters, and the editor offers no syntax colouring to catch it
with the eye. Fixing DC-48 left two `const painted` declarations in one block: a
plain `SyntaxError` any compiler refuses instantly, which instead cost a
six-minute build-and-sweep and printed `SHOTS FAIL: Script failed to execute,
this normally means an error was thrown. Check the renderer console` — no line,
no message, and no console left to check. `audit.test.ts` now compiles the string
with `new Function` (which parses without running) plus a negative control
showing that mechanism going red on the exact redeclaration that got through.
Same family as DC-45: the reach of a check is part of the check.

**`check:css` missed the exact defect it was written for (2026-08-14).** The
same family again, and the sharpest instance yet, because this gate exists for
one class and one class only: *a comment closed early, leaving prose in the
stylesheet.* On 2026-08-14 that happened again — ten lines into a comment inside
a rule body in `tools.css` — and `check:css` passed the file. The production
build refused it (`postcss: Unknown word The`), which is the only reason it was
found before a commit.

Two mechanism defects, both from the gate's reach having been fixed by the one
example it was written from:

1. Its `stray-comment-end` check was `text.includes("*/") && !text.includes("/*")`
   — true only for a file holding a comment END and no comment START anywhere.
   No real stylesheet is that file, so the check had **never** been able to fire.
2. Its prose check reads **depth zero only**. The original 2026-08-08 instance
   happened to be at the top level; this one was at depth one, inside
   `.tool__table-scroll { … }`, where CSS discards the malformed declaration and
   the browser silently loses the rest of the rule.

The fix is at (1) rather than (2): an early close always leaves a `*/` behind,
and a `*/` outside a comment is unambiguous at **every** depth, with none of the
false-positive risk that reading declaration bodies as prose would carry
(`content: "„"` is legal CSS). Three tests added, including the depth-one shape
verbatim and a negative control the old check could not have failed.

*The added rule, third statement of it:* **a gate written from one example
inherits that example's coordinates.** Ask what the defect looks like somewhere
else in the file before deciding the gate covers the class.

**DC-49 — A free-text vocabulary the surface restates instead of reading, so
the word the hint asks for and the word the tool accepts have two authors.**
Found in `pro/kuhinja.tsx`, four times, and it is DC-02 with a specific and
nastier failure mode: **the mismatch is not an error, it is a different set of
numbers.** Each tool read a table cell against a module-level
`Record<string, …>` holding its own copy of „brašno" / „jednostruko" / „ml",
keyed on the diacritic spelling and matched with `toLowerCase()`, while the hint
above the field read the same words out of `strings`. Change one and the other
does not follow.

- `bakers-percentage`: an unmatched role falls to „other", which changes the
  percentage BASE every number on the screen is computed against. And the map
  was keyed on „brašno" alone, so „brasno" — what most people type, and what
  this app's own search has always accepted — was silently „other".
- `plate-cost`: **the worst one.** An unmatched unit fell to `"g"`, so a row
  entered as `200;ml` was priced per kilogram instead of per litre and printed
  as „200 g". The core has an `isKeyOf` guard and `strings` has an `errorUnit`
  message for exactly this — and the surface's `?? "g"` meant **no input could
  ever reach either.** A written error message that no input can reach is the
  same shape as a gate that looks nowhere.
- `lamination-layers` and `recipe-scale`: the same construct; recipe-scale's two
  copies had already drifted (map key „ostalo", label „drugo"), invisible only
  because everything unrecognised lands on „other" anyway.

All four are now one function per vocabulary, comparing `foldSearchText(word)`
against `foldSearchText(strings…)` — so case and diacritics stop deciding
whether a word is recognised, and there is exactly one author. `plate-cost`'s
returns `undefined` and the tool refuses the row, which is what makes
`errorUnit` reachable for the first time. `PlateCostRow` gained the `unit` it
was costed in, so the surface cannot print a quantity in a unit it assumed.
Sixteen assertions in `pro/kuhinja.test.ts` (renderer) pin each vocabulary
against the strings table it must agree with.

*The added rule:* **a word the user is told to type is user-facing copy, and
user-facing copy lives in `strings.ts` — including when its other job is to be
a map key.**

**DC-50 — One member of a formatted family that formats its answer differently,
under a label that says otherwise.** `pro/format.ts` has `proRatio` precisely so
a computed value against the user's own limit prints as a plain quotient:
„1,12", never „112 %", because a percentage OF a limit reads as an overrun that
has already been judged — and `toolForbidsVerdict` tools may not judge. Forty of
the drawer's forty-one `ToolAgainstLimit` call sites use it. The forty-first,
`agro`'s `sprayer-calibration`, printed „112,0 %" — under the label
**„Izmereno ÷ ciljano"**, which promises a quotient. It is a `life-safety` tool.

Root cause was in the core, not the surface: `ratioAgainst` was called correctly
and its result then multiplied by 100 into a field named `ratioPercent` — the
only one of the drawer's ~45 `ratioAgainst` results that scaled. The surface
imported `proRatio` and never used it, which is how the lint gate found this.
The field is now `ratio`, the surface uses `proRatio`, and the label is
unchanged because the label was the half that was right.

(`kuhinja`'s `water-temperature` puts a temperature DIFFERENCE in the same slot
and is correct: a quotient of two Celsius readings is meaningless, Celsius not
being a ratio scale. Checked, not assumed.)

**`lint` was not in the pre-commit gate list, and six real errors shipped
because of it (2026-08-14).** `CLAUDE.md` names typecheck, test, build, smoke
and the ten static gates. CI runs `pnpm lint` as its own step, so commit
`2aad366` went out red. What it was holding was not style noise:
`kuhinja.tsx`'s unused `plateUnitLabel` was the DC-49 display bug above, and
`agro.tsx`'s unused `proRatio` was DC-50. `packages/core` was carrying nine
more, including one `no-irregular-whitespace` — a literal U+2003 EM SPACE inside
a comment in `tekst.test.ts`, which `check:invisibles` deliberately does not
cover (it renders as a space and IS one, so it fails that gate's stated test)
and which eslint does. **An unused import is a question, not a nit: it is
usually the name of a feature somebody wrote half of.** Both of this arc's most
expensive display defects were found by reading one.

**DC-51 — A file read with the wrong encoding and written back, which every
gate, every test and the build passed (2026-08-14).**
`packages/core/src/pro/biznis.test.ts` had 58 of its comment lines silently
re-encoded: every „—" became three characters, every „…" three more, 125 stray
characters in all. The cause is a read+rewrite where the read used the system
ANSI codepage instead of UTF-8 — Windows PowerShell 5.1's `Get-Content` and
`Set-Content` both default to it, which is already in the shell-hazards note for
a different reason.

**What makes this its own class is what did not notice.** `pnpm typecheck`
(12/12), `pnpm test` (5 753 assertions in core alone), `pnpm lint`, all ten
static gates and `pnpm build` were green with the file in that state — because
the damage was entirely inside comments, and nothing in the gate set reads
comments for meaning. It was found by eye, in a `git diff --stat` line reading
`152 ++++----` for a file where 38 lines had been added and none removed.

Repaired by inverting the corruption **line by line**, not file-wide: 58 lines
were mojibake and one line — an em dash typed after the corruption — was correct
UTF-8, and a whole-file round-trip would have destroyed that one. The repaired
file now differs from `HEAD` by `38 insertions, 0 deletions`, which is the proof
the inversion was exact. Blast radius swept: 1 245 text files in the tree, one
hit, in `release/win-unpacked/LICENSES.chromium.html` — a build artefact and
third-party.

**`check:invisibles` now covers it.** A UTF-8 lead byte (`0xC2–0xF4`) followed
immediately by a C1 control (`0x80–0x9F`), both decoded as single characters, is
not text — it is a byte sequence somebody read as latin1. The continuation half
is deliberately narrower than UTF-8's own `0x80–0xBF`: the full range reported
„mañana·" and „bücher·" in a punycode comment, plus the Serbian copy of the
drawer's own **`mojibake-repair` tool**, whose fixtures are mojibake on purpose.
Reporting shipped copy as broken is DC-01's inverse, and the narrowing costs
only a file whose sole corrupted character is „š" or „ž" — which corruption
never is, since it hits every non-ASCII character at once and this codebase
cannot write a paragraph without a dash or a „ quote. Four tests: the em dash,
the ellipsis and the „č" all firing, and the three real texts that must not.

*The added rule:* **never let a file round-trip through a tool whose input
encoding you have not stated.** On this machine that means: no `Get-Content` /
`Set-Content` without `-Encoding utf8`, and edits go through the editing tools
or a Node script with an explicit `"utf8"` on both ends.

**DC-52 — Two things given the same corner by two different positioning systems,
where only one of them can see the other (2026-08-14).** `PageHeader` draws the
module's mark as a watermark: `.nx-page-header__sigil`, `position: absolute;
top: 0; right: 0`, 72px, `opacity: 0.13`, `z-index: 0`. It also has an actions
slot: `.nx-page-header__actions`, `margin-left: auto` in a flex row, `z-index:
1`. Both resolve to the header's top-right corner, and the actions are opaque —
so on every page that supplies both, a button was painted across the mark.
„Stručne alatke" left the briefcase a bare rounded rectangle; „Beleške" took the
top off the document. **Nine of the sixteen `PageHeader` call sites pass both** —
Kontrolna tabla, Zadaci, Beleške, Fajlovi, Finansije, Studije, Privatno, Platno's
board view, and the two drawers of Alatke — and four of the nine supply the
actions through a conditional spread, so the collision appears only in the state
that has controls. The other seven pass a mark alone and rendered it whole,
which is what made the difference diagnosable: `CalendarPage` beside
`NotesPage`, same component, one mark complete and one cut in half.

**Root cause is not the z-index; it is that neither declaration knew about the
other.** Flow layout cannot see an absolutely-positioned element, so the actions
were right-aligned against a corner they had every reason to believe was empty,
and the mark was placed at a corner it had every reason to believe was its own.
Nothing in either rule is individually wrong. The class is: *a decorative layer
taken out of flow, and a live control aligned to the same edge, is a collision
that neither stylesheet can express.* Whoever adds the second one is not
looking at the first.

**Fixed by giving the mark a column rather than by re-stacking anything.**
`.nx-page-header--sigil .nx-page-header__actions { margin-right: calc(72px +
var(--nx-space-2)) }` — margin on the actions, deliberately not padding on the
header, because `right: 0` resolves against the padding box and padding would
move the mark by exactly as much as it moved the button. The modifier class is
set inside `PageHeader` from the `sigil` prop itself, so a page cannot supply a
mark and forget the column; and only pages that HAVE a mark pay for it.

**What could not see it, and this is the finding.** The sweep renders 2 406
frames and grades them, and it reported nothing here across all four sizes and
both themes — correctly, by its own rules. Its `overlap` class is text-over-text
and its `small-target` class is pointer targets under 24px; this mark is neither,
being an `aria-hidden` SVG at `pointer-events: none`. **The audit measures
whether the app is USABLE, and this defect is one where the app is entirely
usable and looks broken.** Every rendering-fault-shaped defect of this arc — the
26px sigil slice, this — was found by a person opening the PNGs. *The added
rule:* **the sweep's report being empty is not the review; looking at the frames
is the review.** The report narrows where to look, it does not replace looking.

**DC-17 recurred, in the tool that was being used to fix something else.** Every
allowlist mechanism gitleaks' current documentation suggests — `[[allowlists]]`
(plural), `targetRules`, `matchCondition` — is an unknown key in the pinned
8.24.3, and TOML drops unknown keys without a word. The first candidate config
was well-formed, read as a careful rule-scoped exemption, and did **nothing**:
the history still reported both findings. It was caught only because the config
was measured against the real repository before being committed rather than
after. Same shape as the `eslint-disable` for a rule nobody configured; new
evidence that the shape is a property of configuration formats generally, not of
one linter. *The added rule:* **a suppression is not written, it is measured —
against the artefact it claims to suppress, and against something it must still
refuse.**

**DC-01 gained its inverse.** The layout audit reported a sticky bar overlapping
the content scrolling beneath it as an `overlap` finding — four standing entries
the moment a scrolling scene existed. A gate that covers nothing reports success;
a gate that reports the design working as a defect is the same failure from the
other side, because both end with a human who no longer reads the output. The
audit now exempts `sticky`/`fixed` subtrees from the overlap check specifically
(`OVERLAY_SELECTOR` could not have caught them — that list is about dialogs and
menus, and this is about a bar pinned to the edge of a scroller).

**DC-02 gained an instance in the same wave.** The sync card's renderer began
re-deriving `cloudRequiresRestart` from a `pendingCloud` it held itself, beside
main's own copy of the rule — two answers to „does this need a relaunch", one of
which did not survive the component being unmounted. It is now one field on
`SyncStatusView`, computed in `service.ts`, whose single caller is `status()`.

**DC-02 gained its worst instance yet in this arc.** The component gallery's
`ICON_NAMES` was a hand-written array under a comment reading „Every icon the
set ships, in declaration order — the gallery's whole job is to show all of
them, not a chosen few." It listed **27 of 91**, and had done since the second
batch of icons was drawn. The set and its index were the same fact written
twice, and the copy that nothing enforced is the one that stopped being true.
It is now `Object.keys(SHAPES)` exported from `@nexus/ui` — an icon is in the
gallery the moment it is drawn, and there is no second place to forget. The same
arc retired the week-opening arithmetic, which had reached **four** copies
(`weekDayKeys`, HABIT's `weekStartKey`, NOTE's rhythm grid, TASK's flow chart)
into one `weekOpeningDayKey` in `@nexus/core`, with `weekStartKey` kept as a
named re-export so no HABIT call site moved.

**DC-53 — A security rule whose pattern is also a name this codebase uses
everywhere, so the gate fires on copy changes (2026-08-15).** gitleaks'
`vault-service-token` matches a legacy HashiCorp Vault token: the letter `s`, a
dot, 24 base62 characters, above an entropy floor, followed by a quote, a
backtick, a semicolon, whitespace or end of line. Every surface in this app
opens with `const s = strings.<module>`, which makes `s.someStringKey` the
single most common expression in the renderer — and a key that happens to be
exactly 24 characters long has that exact shape. **64 such reads exist today
over 47 distinct keys**; three carry digits, clear the entropy floor and sit
before an accepted delimiter, and those three failed the Security workflow on
the 2026-08-15 push. Nothing in that push touched them.

The measurement is worth keeping because it names the population that can fire.
`s.targetMinusDeliveredP2o5` is a fourth key of the same shape and entropy that
does **not** fire, and only because every one of its call sites is followed by
`}` rather than by a delimiter the rule accepts. So the risk set is „24-character
key carrying a digit, before a space or a quote", not „24-character key".

**One correction, 2026-09-26.** That statement is about the CODE and it is still
true there — but it stopped being true of the repository when `docs/` entered
version control, because this entry quotes the key in prose, where a backtick
closes it and the rule opens. So the fourth literal is now named in
`.gitleaks.toml` as well, and the population that can fire is not only call
sites: **any file the scan reads, documentation included.** The line stayed
because the history scan is why the exemption is in the config rather than in
this sentence — a later commit cannot un-scan an earlier one.

**Fixed by naming the three literals** in `.gitleaks.toml`, which keeps the rule
armed — a real Vault token in this repository is still a failure. Measured both
ways at the pinned 8.24.3 before and after: history scan 6 → 0, working tree
over a clean `git archive` of HEAD 6 → 0. The alternative, `[extend]
disabledRules`, was measured and does work; it was not taken, because a rule
switched off to stop a false positive is off for the true one too.

*The class:* **a detector and a naming convention can describe the same
characters, and then the gate's failures stop being about security.** The cost
here is that the next 24-character string key fails a *security* gate for a
*copy* change — which is the shape that trains people to ignore a red security
workflow, and is exactly how the 2026-07-31 finding sat in a green repository
for ten days. It is listed in §5 as a question for the founder rather than
settled unilaterally, because every remaining option trades away real detection.

**DC-54 — An override pinned to the current edge of an advisory range, where
the range is somebody else's moving claim (2026-08-15).** `nanoid` was raised to
`^3.3.17` on 2026-08-08 for GHSA-2v37-7h3g-55p8, whose text then read „patched
in 3.3.17". Upstream re-cut the advisory to „patched in 3.3.18", and the version
that was the fix a week ago became the vulnerable version — with nothing in this
tree changed, and no commit to point at. The same push that carried DC-53 went
red on it.

The trap is that the override *looks* current: `^3.3.17` already admits 3.3.18
by ordinary caret resolution, so a reader checking the range sees a correct
range. But a lockfile that already satisfies its range is never re-resolved, so
the tree stays on 3.3.17 forever. Raising the floor is what forces the move,
and `pnpm-workspace.yaml`'s own rule is the proof: after an entry changes,
`pnpm why <pkg>` must no longer list the affected version. It now finds one
version, 3.3.18.

*The class:* **a pinned reference to an external claim ages without being
touched.** Advisory ranges, CVE severities and „latest patched" are revisions of
somebody else's opinion, not facts fixed at the time of writing; an entry that
records only the number, and not that the number can move, reads as settled when
it is merely current.

**2026-08-21 — the same class, and this time the tooling fact underneath it.**
`tar` went from clean to a blocking `high` twenty seconds after a push that
touched no dependency: GHSA-r292-9mhp-454m was cut against `<= 7.5.20` while the
tree sat on 7.5.19. Unlike `nanoid`, both dependants already asked for a range
that ADMITS the patch (`^7.5.7`, `^7.5.4`, against a published 7.5.22), so a
clean install with no lockfile would have landed on the fix by itself.

**And that is precisely why it could not be fixed by updating.** `pnpm update
tar -r` reports success, resolves 839 packages, and leaves 7.5.19 exactly where
it was; so does `pnpm update "tar@^7.5.22" -r --depth Infinity`. Both are the
obvious commands, both exit 0, and neither changes a byte — because a resolved
version that still satisfies its range is never re-resolved, and `update` does
not reach a transitive no workspace package declares. Worth recording as a fact
about the tools rather than a fact about `tar`: **the two commands that look
like they nudge a lockfile do not, and they say so by saying nothing.** An
override is the only mechanism, which makes the „ordinary resolution already
reaches the patch" carve-out in `pnpm-workspace.yaml` narrower than it reads:
it is true of a fresh install and false of every existing checkout.

**DC-55 — A result field the core computes deliberately to stop a misreading,
that no surface names (2026-08-14/15).** The counterpart to DC-47, and invisible
to everything DC-47 was visible to. `angleOfView` returns `farIsInfinite`
because a hyperfocal far limit of „∞" and one of „412 m" are different
statements about the same photograph; `reeferFuelUse` returns `usedMeasured`
because a consumption figure the user measured and one this tool assumed are not
the same claim. Both were computed, both were tested, and neither appeared on
any screen. The caveat exists precisely to prevent a misreading, so a caveat the
screen never prints is the misreading shipping.

**Nothing else can see this.** Reading four of a result's five fields is
well-typed; an unused *property* is not an unused variable, so the linter is
silent; the tests assert the field because the core produces it; and a review
reads the core file and the surface file separately, where each half looks
complete. That is why it needed its own gate rather than a rule in someone's
head: `check:pro-flags` (`5644ffd`) pairs every boolean on an exported result
type in `packages/core/src/pro/*.ts` with the pack's surface and fails when the
surface never mentions it — 81 flags across 17 packs today, all named.

**Two of the three were closed by deletion, not by adding a row**, which is the
better outcome and worth stating: `farIsInfinite` and `usedMeasured` were both
derivable at the surface from fields it already read, so the flag was a second
copy of a fact (DC-02) as well as an unnamed caveat. The third,
`muzika`'s unspellable-transposition marker, became a discriminated union — the
segment is now *either* prose, *or* a chord, *or* unspellable, and a surface
cannot render the third as if it were the second.

*The rule:* **a caveat is not a field, it is a sentence on a screen.** If the
core computes one, the surface owes it words; if the surface owes it nothing,
the core should not compute it.

**DC-56 — A generated file that is committed, with an intention instead of an
enforcement (2026-08-15).** `licences.json` — the only thing the app's „Licence"
card reads — credited **dompurify 3.4.12, js-yaml 4.3.0, mermaid 11.16.0 and
nanoid 3.3.16** while the installer shipped 3.4.13, 4.3.1, 11.16.1 and 3.3.18.
**Three of those four are the packages the security overrides in
`pnpm-workspace.yaml` moved**, so the screen was naming the OLD, vulnerable
release of a dependency the product had already patched — wrong in the direction
that looks worse than the truth, and a defective attribution besides: a licence
text belongs to a version, and pointing at another one is not the notice those
licences ask for.

**The four numbers are not the finding.** The generator's own header already
said the file „is regenerated whenever the dependency set moves" — a sentence,
not a mechanism. `licences.test.ts` exists and passes: it reads the file and
asks whether it is **fit to ship** (every entry carries a notice, nothing is
UNKNOWN, every font family is present). It cannot ask whether the file still
**describes this tree**, because the file is all it ever sees. Two different
questions; only one of them had an answer, and the passing suite made it look
like both did.

**Fixed with a twelfth static gate**, `check:licences` — `--check` on the
generator renders the payload and compares bytes, which is sound only because
that script was written deterministic on purpose (same node_modules in,
byte-identical out, separators normalised to `/` so Windows and Linux agree).
On a mismatch it prints the drift by name, `was -> now`. Proved able to fail by
editing nanoid's entry back to 3.3.16. `ci-workflow.test.mjs` derives the gate
list from `package.json`, so the CI step was demanded by a red test before it
was written.

*The class:* **a generated artefact that is committed has two authors — the
generator and whoever last ran it — and nothing makes the second one show up.**
It is DC-02 (one fact in two places) with a specific tell: the second copy is
produced by a command, so the failure is not a wrong edit but an omitted run,
and it leaves no trace in any diff. Anywhere this repo commits generated output,
the question to ask is not „is it correct" but „what would notice if it stopped
being".

**DC-57 — A visual harness whose fixture can never reach the state the surface
is for (2026-08-16).** `pnpm --filter @nexus/desktop shots` photographs 394
surfaces per theme and reports „2 406 frames, 2 distinct findings". One of those
surfaces is `settings-sync`, a scene added deliberately so the sync card would
not go unphotographed. Opening the frame it produces shows the card rendering
**„Ova verzija Nexusa nije povezana ni sa jednim serverom"** — the `unconfigured`
branch, one sentence long.

`syncCardState` returns `enable` only when `configured && cloudEnabled &&
!cloudRestartRequired`. The harness redirects `userData` into a disposable
subdirectory, so there is no `cloud.json` and cloud is off; and the build carries
no `MAIN_VITE_SUPABASE_*` pair, so `configured` is false as well. Both knobs are
off, and neither is reachable from a scene definition. **The enable form, the
reconnect form, the one-time recovery panel and the adoption form have therefore
never appeared in a screenshot** — four form surfaces, roughly a dozen fields
between them, inside a sweep whose whole job is to find clipped text, escaping
boxes and sub-24px targets.

*Why it is not DC-01:* that class is a gate whose *matcher* covers nothing. Here
the scene matches, the frame is written, the geometry is measured and the finding
count is honest about what it saw. What is missing is upstream of all of it — the
fixture cannot enter the state. A scene list is not coverage; a scene list plus a
fixture that can reach each state is.

*The tell:* a harness that builds its own throwaway world will photograph the
DEFAULT of every switch, and a surface that only exists once a switch is flipped
is invisible to it while looking fully covered. Ask of any visual harness not
„is this surface in the scene list" but „can the fixture put it on screen".

*Not fixed here, and deliberately.* The two knobs are a placeholder project baked
into the build and `cloud.json` written into the disposable profile — and the
second one turns the packet boundary off for the run, which is a security
boundary the harness currently enjoys unconditionally. That trade is the
founder's, and it is in [STATUS.md](STATUS.md) §5 rather than decided at the end
of an unrelated piece of work.

**DC-58 — A probe that can fail for its own reasons answers „failed" to every
question you ask it (2026-08-16).** The test proving the DC-14 repair against the
real schema builds a temp table from `table`'s columns plus `table`'s CHECKs,
inserts the merged row, and asks „refused: yes or no". It drops NOT NULL, FK and
DEFAULT on purpose — they belong to the apply path, not to the repair — but it
kept every CHECK, and `focus_sessions` has
`CHECK (typeof(paused_seconds) = 'integer')` on a column the probe therefore
supplied as NULL. Two of seven tables failed, and the failure was in the probe.

What makes this a class rather than a slip is the SHAPE of the wrong answer. The
scenario asserted two things: the merged row is refused, and the repaired row is
not. The probe refused both. So the first assertion — the one that exists to
prove the scenario is a real conflict — **passed for the wrong reason**, and only
the second failed. Had the repair also been wrong, the pair would still have read
exactly like this. A boolean verdict from an instrument that has its own failure
mode cannot distinguish „your input is bad" from „my instrument is bad", and it
will confirm whichever hypothesis you brought.

*The fix, and the general form:* **make the instrument name the rule it applied.**
One CHECK per probe table, the answer returned as the refusing constraints' own
text, and the scope narrowed to the constraints the code under test actually owes
an answer to. A failure now reads „`ended_at > started_at` refused the repaired
row" instead of „false ≠ true", and the wrong-reason pass becomes impossible
because the reason is the output.

*The tell:* any checker with a setup step — a fixture, a temp schema, a stub
server, a parser — whose verdict is a boolean. Ask what ELSE could produce that
boolean, and if the answer is „the harness misconfigured itself", the verdict has
to carry its evidence. This is the third instrument this arc that reported a false
failure: `check-makefile.mjs` (a `$(shell …)` value compared against its own
source text), the sync service's fake PostgREST (a `kind=` filter it ignored), and
now this one. **A red result from a tool I wrote is a claim about the tool first.**

**DC-59 — A green check is evidence about a gate set, not about a branch
(2026-08-16).** Five Dependabot pull requests were resolved; GitHub reported PRs
#20, #21 and #23 as `CLEAN`, and the first two were merged on that. Their check
runs were produced **2026-08-10, 15:55–15:59**. The eleventh gate (`check:pro-flags`,
`5644ffd`) and the twelfth (`check:licences`, `3084c51`) landed on `main` on
**2026-08-15**. So the tick certified those branches against a ten-gate set while
`main` had grown to twelve, and merging them imported the older rule set. The
consequence was immediate and exact: #21 moved electron to 42.8.1 and yjs to
13.6.32, and `check:licences` went red the first time it ran over the merged tree.
**The gate written for DC-56 could not fire on the pull request that committed
DC-56**, and the log of #21's run confirms why — it contains no such step at all.

The mechanism is that „all checks passed" is the conclusion of the newest run on
that head, and it carries no opinion about whether the workflow has changed since.
A branch that has not moved keeps its tick indefinitely, so the tick's age is the
age of the rules it enforced. Bot branches are where this bites, because a bot
does not rebase unless something forces it to, and this repository adds gates
often — twelve so far, two of them in the two days those pull requests sat.

*The asymmetry that makes it dangerous:* **a stale red stays true; a stale green
does not.** A failure that was observed happened, and no later gate can un-observe
it — #22's TS7016 and #24's `BufferSource` errors, same vintage, were still valid
findings today. A pass only ever says „nothing that was checked objected", so it
decays silently the moment the set of things checked grows. Reading both kinds of
stale result with the same confidence is the actual error.

*The tell:* a check-run timestamp older than the last commit to
`.github/workflows/`, on any branch anyone proposes to merge.

*The fix, where it belongs, and it is now in place (founder, 2026-08-16):* `main`
was not a protected branch — `GET /branches/main/protection` answered 404 — so
nothing required a branch to be up to date with its base. It is protected now,
with the four checks required, `strict` on, and **administrators exempt** at the
founder's choice so direct pushes to `main` keep working.

That exemption is worth being precise about, because it decides what the fix
actually buys. It does **not** physically prevent an admin from merging a stale
branch. What `strict` does is make the staleness *visible*: a pull request behind
its base reports `mergeStateStatus: BEHIND` instead of `CLEAN`. DC-59's entire
failure was that GitHub said `CLEAN` and I believed it, so the signal is the fix —
`gh pr list --json mergeStateStatus` before merging anything is the reading that
would have caught this one. The manual backstop stays either way: run the gates
locally after merging, which is how it was caught.

**DC-60 — A reported number bounded by how it was computed rather than by what it
measures (2026-08-16).** `SyncRoundReport` has five counters, and running the loop
against two real databases proved two of them could not answer their own question.

`owed` was `deps.store.owed(1).length`. `owed(limit)` exists to fetch a PAGE to
push, so the expression is capable of exactly 0 and 1 — and this is the number a
screen shows the user. „247 stavki čeka slanje" would have read „1 čeka" for ever,
and nothing about the call site looks wrong: it names the right table, asks the
right store, and the field is even called `owed`. `applied` counted every
write-back the pull produced, but a write-back also happens when the merge equals
what the device already holds, and `PULL_OVERLAP = 64` means a fully caught-up
device re-reads its last rows on every round. So a device with nothing to do
reported work for ever, and „did this round change anything" had no answer.

The class is the shape both share: **a summary number reused from a call that was
made for a different purpose inherits that call's bound, not the question's.** The
bound is invisible at the reading site because the mechanics that impose it —
a `limit` argument, an outcome-per-request contract, a page size, a `LIMIT` in
SQL — live at the producing site. A number is not a measurement just because it is
an integer of roughly the right size; it is a measurement only if the thing that
produced it was asked the same question the reader is asking.

*The fix, and the general form:* give the port its own question rather than
deriving one. `SyncStore` gained `owedCount()`, answered by a `count(*)` over the
same JOIN `owed` uses — the same JOIN, so it cannot report work the push can never
find — and `applied` now counts only the outcomes whose status is `written`. Both
fixes replace a derivation with a statement of intent, which is also what makes
them readable at the call site.

*The tell:* a count taken as `.length` of a result that accepted a `limit`, an
offset, a page or a filter chosen for another reason; and any counter whose value
would be identical on a round that did nothing and a round that did something.
This is DC-58 in the numeric register — there the instrument answered
„failed" for its own reasons, here it answers a NUMBER for its own reasons — and
it is the same discipline that closes both: what a probe reports has to carry the
rule it applied, not just a value.

**DC-61 — A rule enforced over a reachability set permits everything outside the
set, and the violation is planted long before it fires (2026-08-17).**
`@nexus/sync-transport` needed a profile's content-key wrap off the wire, and the
obvious code imports `parseSealedKey` to validate it. That import compiles, lints,
passes every gate, and is a live security defect with a delay fuse on it.

`wrap.ts` is absent from `@nexus/sync-crypto/web` deliberately: it holds
`unwrapKey`, a signed-in browser can ask the server for `mk_under_kwrap`, and the
distance between „a browser holds K_wrap" and „a browser holds MK" is exactly one
call. `scripts/web-key-surface.test.mjs` enforces that by walking the DEPENDENCY
CLOSURE of `@nexus/web` — which today is `core`, `tokens`, `ui`. Not
`sync-transport`. So the gate would have said nothing, and gone on saying nothing
until the day `apps/web` gained sync — at which point it fails in a file nobody
touched that week, with a message naming `sync-crypto`, months after the decision
that caused it.

The class is not „we nearly imported the wrong thing". It is: **a gate scoped to
what is currently reachable answers „compliant" for everything unreachable, and
its silence is routinely read as approval.** The same shape reaches every gate
here defined over a set rather than over a repository — the egress check, the
web-key surface, an RLS wall stated per table, a lint override scoped by
`files:`. „Not in scope" and „allowed" produce identical output.

*The fix:* do not plant it. The transport now carries three base64url strings and
`parseSealedKey` runs at the desktop, where `wrap.ts` legitimately lives — so the
edge cannot come back by someone later adding a dependency. Where that is not
possible, the gate has to state its own boundary, so that widening the set is a
diff somebody reviews rather than a silent change of what was being checked.

*The tell:* an import that a gate would refuse if the importing package were in
scope, and a package that is one `dependencies` line away from being in scope.
Ask of any gate that walks a graph: what is it NOT walking, and what would
change that?

**DC-62 — An absence established by a search whose window is smaller than the
construct is not an absence, and everything built on it inherits the error
(2026-08-17).** The finding, stated with confidence and escalated to the founder:
`public.key_wraps` has no INSERT grant for `authenticated`, so
`key_wraps_owner_insert` is a policy the database has never evaluated, and minting
a profile content key needs a change to the security wall.

Every word of it wrong. The grant is in the same migration as the policy, forty
lines above it, column-scoped and complete — and it already names all seven
columns a `ck_under_mk` mint writes.

The search was `grant insert` near `key_wraps`. The statement is

```sql
grant insert (user_id, kind, profile_id, epoch, nonce, wrapped, commit_tag, kdf_salt, kdf_params)
  on public.key_wraps to authenticated;
```

Verb on one line, table on the next. `grep` matches lines; a SQL statement is
terminated by a semicolon and does not care where the newlines fall. The search
did not fail — it answered its own question correctly, and its question was „is
this on one line".

**The miss is ordinary; what was built on it is the class.** A migration widening
a privilege on the table that holds the key wraps. A restrictive policy to confine
that widening. An entry in this ledger. A message to the founder asking for
authorisation to change the wall — the one kind of change this project does not
make without him. Every step after the premise was sound, which is exactly why
nothing downstream could catch it: derivation preserves truth, and it preserves
falsehood just as faithfully. The further the work goes, the more it looks like
evidence for the thing that started it.

And it was contradicted, in the repository, the whole time. `check:rls` reads the
same file with `/\bgrant\b[^;]*;/g` — statement-oriented, so it sees the grant —
and had been reporting the wall sound at every gate run. That silence was read as
„this is not a rule it checks". **When a hand-search and a parser disagree about
the same file, the parser is right.**

*The fix:* never state an absence from a line-oriented search of a construct
whose syntax ignores newlines — SQL statements, a call whose arguments wrapped, a
JSX prop list, a chained builder, a TS type across lines. Use the language's own
terminator (`rg -U`, `grep -Pzo`) or read the region. Where a parser for the
artifact already exists in the repo, ask it.

*And the shape that was wrongly reported is now a gate,* because it is a real
shape even though this was not an instance of it: a grant and a policy are two
independent gates in series, Postgres consults the privilege first and answers
`42501` before RLS runs, so a policy on a privilege the role lacks never executes
and reads as the rule it is not — and the mirror image, a write grant no
permissive policy admits, is a statement that affects zero rows and reports HTTP
200 `[]`. `check-rls-wall.mjs` rule 8f asserts both directions per privilege, and
`clientGrantsOf` now replays REVOKEs so the picture is the state the migrations
end in rather than the widest state they ever had. Had the grant genuinely been
missing, one command would have said so.

*The tell:* a conclusion of the form „X does not exist" whose only evidence is a
grep. Also — the reason this had no other witness — any suite that proves a rule
by asserting a REFUSAL: a refusal is the same output whether the rule under test
fired or a gate two layers up did, so pgTAP proving „a client cannot write another
user's wrap" would pass identically if no client could write any wrap at all.

**DC-63 — A `finally` runs at the RETURN STATEMENT, not when the returned promise
settles, so a release inside one releases what the call is still using
(2026-08-17).** `openContentKey` opens the master key, uses it, and erases it:

```ts
try {
  return openAll(deps, input, masterKey, wraps, false);   // async
} finally {
  zeroize(masterKey);                                     // runs NOW
}
```

The `finally` fires while the returned promise is still pending. Generation 1
opened — its subkeys were derived before the first `await` yielded — and
generation 2 was decrypted under **32 zero bytes**.

**Every part of the failure points away from the cause.** The symptom is
`wrap/commitment-mismatch`, whose message reads „wrong password, recovery code,
account or profile" — so it presents as a server serving another account's row.
It is data-dependent: one key opens and the next does not, which reads as one bad
ROW rather than one bad LINE. And the code is not merely plausible; the `finally`
is correct in intent, argued in a comment, and doing the right thing at the wrong
time. The fix is the word `await`, which is exactly the edit a reviewer deletes
as redundant.

The class is wider than key material — a handle closed early, a document
destroyed early, a transaction flag restored early are the same ordering mistake
— but those fail LOUDLY on the next call. **A key erased early keeps producing
plausible ciphertext and blames something else**, which is why the gate below
triggers on `zeroize` and on nothing else: a rule that can never be wrong beats a
rule that covers more and gets switched off. Eight other `try/finally` sites in
the repository return a call; all eight return a value that is already computed.

*The fix:* `return await`, and **thirteenth gate `check:zeroize`** — in a `try`
whose `finally` calls `zeroize`, a returned call must be awaited, exempting only
a call to a function the same file declares non-async (`adopt.ts` and
`reconnect.ts` legitimately `return refused(…)` there). `@typescript-eslint/return-await`
states the rule exactly for every type and needs type information, which
`eslint.config.mjs` deliberately does not wire; when that arc happens it replaces
the gate.

*The tell:* a `finally` that releases anything, in a function that returns the
result of another async call — and, from the other end, a decryption failure that
is data-dependent within one batch. „The first one worked" is a statement about
timing at least as often as it is a statement about data.

**DC-64 — A gate that compares a generated artefact byte-for-byte against a
checkout whose encoding the platform decides. It is right on CI and wrong on
every developer machine, which is the inverse of the failure it exists to catch
(2026-08-19).** `check:licences` regenerates the third-party notices in memory
and compares them to the committed file. `.gitattributes` says `* text=auto`, so
git checks that file out with **CRLF on Windows**, while `JSON.stringify` always
writes **LF**. The comparison was `committed === rendered`, so the gate reported
„does not describe this tree" on a file that was exactly current — every time,
on every Windows checkout, and never once on CI.

What made it worse than a false alarm is that the report could not say so. The
failure branch diffs package VERSIONS and prints the ones that moved; when only
the line endings differ, nothing has moved, so the gate printed its headline and
then nothing — a tool asserting staleness and unable to name a single stale
thing. That is [DC-58](#) again from the other side: an instrument that fails for
its own reasons answers „failed" to every question, and here it also answered
„…and I cannot tell you why".

The cost is not the wasted minute. A gate that cries wolf on a clean tree gets
run with `|| true`, or dropped from the local pre-commit list, and then the
staleness it was written for (DC-56) ships. **The gate's own reliability is part
of the gate**, exactly as its reach was in [DC-45](#).

The class is wider than line endings: any comparison between something GENERATED
and something CHECKED OUT is comparing across a transformation nobody in the
comparison controls. Line endings are git's; file mode, BOM, and unicode
normalisation on macOS are the same shape. The rule: **compare the artefact's
MEANING, and let the encoding be whatever the platform wanted.**

*The fix:* normalise `\r\n` before comparing, with the reason in the code so it
is not tidied away as a redundant `replaceAll`; and pin
`apps/desktop/src/renderer/src/data/licences.json` to `eol=lf` in
`.gitattributes` so the working copy stops flipping. Both, deliberately — the
attribute keeps the tree clean, but the gate must not DEPEND on anyone having
remembered the attribute, because the next generated file will not have one.
Verified in both directions rather than by re-running: the gate passes against a
deliberately CRLF-rewritten copy, and still catches (and names) a single package
version edited to `0.0.0-not-real`.

*The tell:* a gate that is green in CI and red locally with no local change to
what it measures. The instinct is „my environment is dirty"; the question to ask
first is what the gate compares, and whether both sides of the comparison came
through the same door.

**DC-65 — A tool that writes its SUMMARY only on the success path, beside outputs
it writes incrementally. A failure between the two rates leaves a set that is
internally inconsistent, and silently so (2026-08-21).** The screenshot sweep
writes its ~2 400 PNGs one at a time as it takes them, and writes `frames.json`
and `report.md` once, at the very end. A transient `capturePage` rejection 2 200
frames in therefore did two things. The obvious one: every geometric finding
those 2 200 frames had already produced was discarded, and a twenty-five-minute
run produced nothing readable. The quiet one is worse — the fresh PNGs were left
sitting next to a `report.md` from a run five days earlier, and **nothing in
either file says which run it describes.** A stale report beside fresh frames is
read as a report *about* them, and it is the first file a reviewer opens.

The class is not „wrap it in `try/finally`". It is: **when a tool's outputs are
written at two different rates, the slower one is a claim about the faster one,
and a failure in between silently breaks that claim.** The incremental half
survives the crash; the summary half is the previous run's. This is
[DC-56](#) seen from a different angle — there a generated file that was
committed had two authors and nothing made the second one show up; here the
second author is the previous run of the same tool.

*The fix:* the summary is written in a `finally`, from whatever was collected,
and the failure still propagates so the run exits non-zero and names what broke.
A partial report that covers what ran beats no report, and beats a complete
report about something else. The failure message now also says where the partial
output is, because the reader's next question is whether anything survived.

*The tell:* an output directory in which two files carry timestamps from
different runs — and a tool that prints `FAIL` without saying what it left
behind.

**DC-66 — An operation treated as a read when it is a request to another process,
which is entitled to answer with nothing (2026-08-21).** `capturePage()` reads
like a getter: no arguments, returns the picture. It is not. It asks Chromium's
compositor to *produce* a bitmap, and the compositor may decline — as a rejected
promise whose message is `VizSentEmptyBitmap`, or, worse, as a **successful**
zero-sized image. The sweep called it once, checked nothing, and had no retry.

Both halves matter and only one of them is loud. The rejection ends the run,
which at least says so. The empty success is the dangerous one: `toPNG()` on a
zero-sized image writes a file no viewer opens, the frame is recorded as taken,
and what the reviewer eventually meets is a page that apparently rendered
nothing — a defect report against the app, caused by the instrument.

There is a third answer, and it is the worst of them: **nothing, for ever.**
`executeJavaScript` returns a promise with no guarantee of settling, and a
suspended page runs no script, so it neither resolves nor rejects. That killed
the next run 1 215 frames in — no error, no output, four Electron processes at
flat CPU, and a `report.md` from an hour earlier sitting beside the frames
([DC-65]).

The rule: **an inter-process request needs a retry, an explicit check that what
came back is a result, and a ceiling — because „the call did not throw" is not
the same as „the other process produced something", and neither is the same as
„the other process answered".** Nothing in the type signature distinguishes the
three; `Promise<NativeImage>` is what all of them look like.

**And all three had ONE cause, which is the part worth keeping.** Chromium
stands a window down when it decides the window is not visible — occluded by
another window, minimised, on another desktop — and a stood-down window has no
live compositor and no animation frames. `capturePage` on it answers
`VizSentEmptyBitmap`; a script awaiting `requestAnimationFrame` on it never
runs. The sweep drives a real window for twenty-five minutes on a machine
somebody else is using, and „nothing will ever cover it" was an assumption it was
never entitled to make. Fixed at the cause (`backgroundThrottling: false` plus
`--disable-backgrounding-occluded-windows` and
`--disable-renderer-backgrounding`, all three guarded on `--shots`, because
throttling an invisible window is correct behaviour a laptop's battery depends
on) *and* at the symptom (the retry, the emptiness check, the ceiling), because
a measurement instrument that only works when the machine is idle is an
instrument that reports on the machine.

*Blast radius:* three call sites, and the first reading of them was wrong in a
way worth recording. It said `executeJavaScript` was „already inside `waitFor`'s
deadline loop" — and the next run proved that deadline unreachable, which is
[DC-68] below. The corrected reading: `capturePage` (retried, `isEmpty()`
treated as a failed attempt), the sweep's `executeJavaScript` (now bounded at
the bottom, in `evalIn`, so everything built on it inherits the bound), and the
smoke run's single `executeJavaScript`, which is an ASSERTION rather than a
collection step and is supposed to end the run.

*The tell:* an API named like an accessor that crosses a process boundary. If
the value is produced somewhere else, the call is a request — and a request can
go unanswered.

**DC-67 — A responsive fallback that reflows along the dimension the surface is
already short of (2026-08-21).** Below 1 180 px the Elektronika instrument moved
its inspector panel out from the right rail and put it under the BENCH, capped
at `max-height: 40vh`. Every line of that media query did exactly what it said.
The result at the app's own 900 × 600 minimum was a bench **105 px tall**, and
the demo circuit framing itself at **20 %** — a photograph of a board rather than
a board.

The mistake is which dimension the fallback spent. A breakpoint fires because
there is not enough WIDTH; this one answered by taking HEIGHT. That is only a
trade if height is the abundant one, and on a surface whose content is scaled to
fit it never is: `fitView` fits both axes and therefore takes the **smaller**
ratio, so a pixel of height removed from the bench is a proportional cut in the
scale the whole drawing is shown at. Width and height are not interchangeable
currency on a zoom-to-fit surface — the scarcer one sets the scale, and the
fallback was taking from it.

*The fix:* the panel stacks under the DRAWER instead, on the rail it can share,
and the bench keeps the instrument's full height at the full remaining width —
435 × 600 at the minimum window, where it had been 105 × 600.

*The rule:* before moving a panel to a new edge, ask which dimension the main
surface is actually limited by, and reflow along the other one. If the surface
scales its content to fit, the limiting dimension is whichever gives the smaller
ratio — which is a thing to measure, not to guess.

*The tell:* a fallback layout that is arithmetically correct and still looks
broken, and a fit-to-content zoom reading far below 100 % at the smallest
supported window. The zoom figure is the instrument here: it reports the
layout's real geometry in one number.

**DC-68 — A deadline checked only between calls, on a loop whose calls can block
for ever. It reads as a bounded wait and is not (2026-08-21).** The screenshot
sweep's `waitFor` polls for a selector against `Date.now() + 8000`:

```ts
const deadline = Date.now() + timeoutMs;
while (Date.now() < deadline) {
  const found = await evalIn(win, `document.querySelector(…) !== null`);
  …
}
```

Every part of that is ordinary and the shape is one everybody writes. It is also
unbounded, because **the deadline is only consulted once the previous call has
returned.** One `executeJavaScript` that never settles — which is what a
suspended renderer produces ([DC-66]) — and the `while` condition is never
evaluated again. The timeout is real for every failure except the one it looks
like it is there for.

The same sentence covers the other shape in the file, and that one has no
timeout at all to be fooled by:
`await new Promise((r) => win.webContents.once("did-finish-load", r))`. **An
event listener is a deadline of infinity.** It waits for an event that may
already have fired, or that a stood-down page will never reach, and nothing
about it looks like a risk.

*The fix belongs at the bottom, not at each loop.* Every renderer call in the
sweep goes through one `evalIn`, so the ceiling went there: the call races a
main-process timer (unthrottled, unlike anything in the renderer) and answers a
sentinel when the clock wins. `waitFor`'s polling loop then becomes genuinely
bounded without being touched, because each iteration is now guaranteed to
return. A bound at the bottom is a bound everywhere; a bound at every call site
is a bound wherever somebody remembered.

Two details that are not incidental. The timeout answers a **sentinel rather
than throwing**, because every caller already has a „the page did not have it"
branch and a symbol equals none of the values they test for — so each falls into
the path it already had, and no call site needed editing. And the abandoned
promise gets a `.catch`: a promise the race walked away from can still reject
later, and an unhandled rejection ends the process at an arbitrary point with a
stack that names none of this.

*The tell:* `while (Date.now() < deadline) { await somethingRemote() }`. Ask what
happens if the awaited call returns never — not late, never. If the answer is
„the loop stops looping", the deadline is decoration.

**DC-69 — A guard whose comment states a bound that only holds while an upstream
invariant does, and nothing states the invariant (2026-08-21).** `SeriesPlot`
clamps its axis labels into the drawing:

```ts
export function clampTickLabelY(y: number, height: number): number {
  return Math.min(height - TICK_HALF_LINE, Math.max(TICK_HALF_LINE, y));
}
```

with a comment — and a test — saying it moves the two extreme ticks *by three
pixels*, which is the half-line a `dominantBaseline="middle"` label hangs
outside a `PAD_Y` of 6. Both were written truthfully and both were wrong,
because three pixels is what the clamp moves a tick that is **already inside the
box**, and the ticks were not. `niceTicks` rounds both ends OUTWARD on purpose,
so that the axis contains the data; the plot was scaled to the data's own
extent. The first and last tick therefore landed outside the drawing and the
clamp pinned them to the edges, on top of their neighbours: FIN's balance flow
printed „80.000,00" and „75.000,00" as one smear. Derived by hand, the top label
was displaced by **8.65px** — and the sweep had measured 8.6px of shared pixels
on four surfaces, which is the same number and the confirmation that the
mechanism was the one being seen.

The root cause is not the clamp. It is that **the ticks and the scale were built
from two different domains** — one function rounding outward, another not
knowing it had — and neither file could see the other's half. The fix makes the
ladder authoritative (`tickDomain`), which restores the clamp's comment to being
true rather than patching around it.

*The tell:* a `Math.min`/`Math.max` guard whose documentation names a **specific
small displacement**. That number is a claim about the guard's INPUT, not about
the guard, and nothing in the file can enforce it. Ask what the input's actual
range is; if the answer is „whatever that other function returns", the bound is
a hope. A test asserting the small displacement makes it worse: it pins the
arithmetic and says nothing about the range, so it stays green through the
defect.

**DC-70 — A threshold applied to a rendered measurement that the viewer
controls: the instrument reports on the viewer's state, not on the design
(2026-08-21).** The layout audit's pointer-target floor read
`getBoundingClientRect()` and compared it to 24. On every surface in the product
that is the right question. On the electronics workbench it is not: the bench is
one transformed `<g>`, so a pin's hit circle — 24 circuit units across, and
unable to be larger without stealing its neighbour's click, since
`PIN_HIT_RADIUS` is exactly half `PIN_PITCH` — measures 15.8px in the fit view
and 29px one press of „+" later. **One design, two verdicts, and the audit was
reporting the zoom.**

Every available „fix" to the surface is worse than the finding: a bigger radius
overlaps the neighbouring pins, and a fit that never zooms below 100 % is not a
fit. So the instrument was wrong, not the bench. `getScreenCTM` is the whole
chain from an element's own user space to the screen; dividing it out asks what
the floor is actually about — *is this target 24 across where it was written
down?* Nothing outside an SVG has such a chain, so every other element on every
other surface is measured exactly as before, and a genuinely 15px control inside
the canvas still fails. Note what was NOT done: the surface was not added to an
exemption list. An exemption blinds the rule; a change of unit keeps it armed.

*The tell:* the same element yields a different verdict at two moments with no
code between them. Ask whether the number being compared is a property of the
DESIGN or of the SESSION — anything downstream of a zoom, a font-size setting, a
window size or a scroll position is the second, and a fixed threshold against it
is a measurement of the user. (The repair was correct and the eighteen findings
survived it anyway, for a reason belonging to the instrument rather than to this
class — see DC-73.)

**DC-71 — A rule written over a CLASS NAME is a rule over a naming convention,
and a convention with two spellings covers exactly the half you looked at
(2026-08-21).** The tool drawer's forms were made a grid so that a field holding
„4" could stop being five hundred and eighty pixels wide, and the rule saying
which children are cells rather than rows was written:

```css
.tool__body > .tool__field,
.tool__section > .tool__field {
  grid-column: auto;
}
```

`.tool__field` is what `pro/shared.tsx` emits, so all two hundred and seventy-four
professional surfaces reflowed on the first reload. „Alatke" did not move at all
— and the two drawers are the SAME component, rendered by the same `ToolsPage`
through the same stylesheet, so „the tool drawer now reflows" was true and
half-false at once. `toolSurfaces.tsx` writes nine of its fields as the kit's
`<TextField label={…}>`, which renders `.nx-textfield` and never touches the
project's class; its own `ToolSelect`, ten lines away in the same file, does use
`.tool__field`. Neither spelling is wrong. The two labels even compute to the
same three declarations, which is why nothing about the drawer LOOKED
inconsistent — the divergence was invisible until a rule tried to name it.

*The tell:* a selector naming a project-local class in a codebase that also ships
a component kit. Ask what the KIT renders for the same idea and whether both are
reachable from this container. And note where the verification went wrong:
opening the drawer the rule was written against confirms one spelling. The
surfaces worth opening are the ones somebody else wrote.

What keeps this a recorded class rather than an open bug is the DIRECTION of the
default. Spanning the row is what an unrecognised child gets, so the next kit
control nobody thought to list comes out full-width: wrong, immediately visible,
and not broken. Written the other way round — cell by default, span by
exception — the first unlisted control would be squeezed into half a column with
nothing on screen to say why.

**DC-72 — A layout validated at the size the first feature happened to be, then
inherited by features an order of magnitude larger (2026-08-21).** `.tool__body`
was a flex column: every control at the body's whole measure, one per line. For
„Alatke" — eleven tools of two or three fields each, answering with one large
figure — that is a correct and even elegant form. „Stručne alatke" then put two
hundred and seventy-four surfaces through the same container, and „Boje
otpornika", which is six selects and a checkbox, filled the window with 580px
dropdowns and pushed its ANSWER — the only reason the tool exists — below the
fold. A form that cannot show its result beside its inputs is not a form, it is
a questionnaire.

Nothing in the container recorded which scale it had been designed for, and
nothing could have: `flex-direction: column` is not a claim about child count.
The count grew twenty-five-fold inside one release and the layout was never
re-asked. The repair is one declaration — a grid on `--tool-columns`, with the
column count a media query's business — and it reached all three hundred and
twenty-seven surfaces without one of them being edited, which is the measure of
how squarely the defect sat in the container rather than in the tools.

*The tell:* a container with no `max-width`, no column count and no wrapping,
rendering a variable number of children. Ask what the LARGEST child count
actually is, never the typical one. If nobody can say, the layout was designed
for the smallest — and the surface that proves it is never the one in the
screenshot, because the screenshot is of the feature the layout was written for.

**DC-73 — A threshold compared against a value the code RECONSTRUCTED, on a
design that sits exactly on the threshold (2026-08-21).** DC-70's repair divided
the zoom out of the pointer-target measurement, and the sweep went on reporting
eighteen failing pins — with the failing size printed as „24", which is the floor
itself. `PIN_HIT_RADIUS` is half `PIN_PITCH`, so the hit circle is twenty-four
circuit units across BY CONSTRUCTION; recovering that twenty-four from a painted
width by dividing out the same scale is not obliged to give back twenty-four, and
it did not. The rule read a hair under. The report, rounding to the one decimal
place it has always used, read exactly the floor.

The defect is not the arithmetic. It is that the RULE and the REPORT were reading
one measurement at two precisions, so the report could not be used to check the
rule — and the only reading a human ever sees said the target was fine. Comparing
at the report's own precision makes the two agree, and a target that is genuinely
23,9 still fails.

*The tell:* a finding whose reported amount EQUALS the threshold it is said to
violate. That is never a design one pixel short of the floor; it is the
instrument disagreeing with itself, and the disagreement is the finding. The
second tell is structural: any `x / scale < LIMIT` where the design states `x` as
an exact multiple of that same scale — a float round trip is not an identity, and
the one design guaranteed to sit on the boundary is the one drawn from the
constant the boundary was chosen for.

**DC-74 — A property asserted ONCE and then assumed for hundreds of observations
that are each LABELLED with it (2026-08-21).** The screenshot sweep sets the
window size at the top of each pass and captures four hundred frames under it,
writing them into `min/`, `default/` or `wide/` and recording that size in
`frames.json`. On 2026-08-21 the window came back MAXIMISED a hundred and eighty
frames into the „min" pass, and the sweep went on writing 1920×1032 images into
`min/` and auditing them as 900×600. Every responsive rule in the product was
reported on at a width nobody had asked about — and the run printed „SHOTS OK",
because nothing in it was checking. The audit exists to answer questions about
width; an instrument that is wrong about width is not a weaker one, it is a
confident one answering a different question.

It was found by reading the PNG headers, not by looking at the pictures, and that
is the point: a screenshot of a correct layout looks correct at every width. The
one artefact that could have shown it — the file's own dimensions — is the one
thing nobody looks at.

*The tell* is the shape of the claim rather than the bug: `set(X); for (…hundreds
of items…) { observe(); record(X) }`. Ask what re-checks X between the set and
the last record. If the answer is „nothing, it cannot change", ask what the
OUTPUT would look like if it did — and here it looks identical, which is what
made a wrong sweep indistinguishable from a right one for as long as it lasted.

The repair asserts the size inside the single function that captures a frame, so
„this image is 900 wide" and „this image is in `min/`" cannot come apart; and it
writes a line to stderr when it has to correct, because a silent correction would
hide the cause exactly as thoroughly as the original hid the symptom.

**And the same class had a second instance four hundred lines further down, which
is how a rule over a REACHABILITY SET fails (DC-61 again).** The guard above sits
inside `shoot`, the function every sized frame goes through — so it covers 2 423
of the 2 424 frames and misses the one whose subject IS the window state. The
„maximized“ pass calls `capture` directly, asks for `win.maximize()`, waits four
hundred milliseconds and photographs whatever it gets; on 2026-08-21 that was a
1600×1000 window filed under `maximized/`. The frame exists precisely because a
maximised frameless window is where Windows keeps an invisible 8 px resize border
that can push past the work area — a thing no merely-wide window can show — so a
wide window in that folder is not a weaker frame, it is the one frame that cannot
be right. It now retries once and, failing that, writes NO frame and says why: a
missing observation is a gap, a mislabelled one is a false answer.

**DC-75 — A catalogue assembled PACK BY PACK has no uniqueness rule, so the same
tool gets built twice under two ids (2026-08-21).** „Stručne alatke" ships four
pairs of tools with the SAME Serbian name: „Iznos slovima"
(`amount-in-words` / `iznos-slovima`), „Račun i IBAN" (`bank-account-iban` /
`racun-iban-provera`), „Suvlasnički udeli" (`ownership-shares` /
`suvlasnicki-udeli`) and „Nominalna i efektivna stopa" (`rate-conversion` /
`nominalna-efektivna-stopa`). Every pair is one tool from `pravo.ts` and one
from `racunovodstvo.ts`; every pair shares a `riskClass` and nearly all of its
packs, so a profile holding both toolkits shows the same name twice in one rail,
filed under two different categories.

It is not two rows with one name — it is **the same specification implemented
twice**. Both numeral tools embed the Serbian numeral lexicon and both cite
*Pravopis srpskoga jezika*, Matica srpska (2010). Both account tools define
their own `stripSeparators` and their own digit-at-a-time ISO 7064 MOD 97-10,
under names one character apart (`mod97` / `mod97Digits`). Nothing was copied by
hand: two packs were specified independently, each discovered that its trade
needs this, and each built it.

*The cause is structural and it is worth naming precisely:* a tool's identity in
the contract is its **`id`**, and two ids are two tools by construction. Packs
FILTER a shared registry, which is what lets one tool serve six trades — so the
registry was designed for overlap and given no way to notice it. Every gate the
drawer has asks whether a tool is well-formed; none asks whether it already
exists.

*The tell is arithmetic that does not reconcile.* This was found by a screenshot
sweep reporting **2 423 frames over 2 399 image files**. The sweep fans out over
the rail's LABELS and slugs them into filenames, so two rows with one name are
two captures writing one file — the second silently overwriting the first. Four
tools × three sizes × two themes = the twenty-four missing images exactly. The
count had been wrong in every sweep ever run and nothing was going to say so,
because the report is a count of what the sweep DID and the directory is a count
of what survived, and only subtracting one from the other asks the question.

*The rule this became is a TEST, not a fifteenth gate,* and the reason is worth
keeping: `modules.test.ts` already resolves every `titleKey` through `strings`,
so „no two tools in one drawer resolve to one name" is a dozen lines there,
sitting beside the id-uniqueness test that never thought to ask it — while a
`.mjs` gate would have had to re-implement that resolution by regex over a
4 000-line registry and a 1 600-line strings table. A gate earns its keep when
nothing else can see the rule (`check:pro-flags` is the type case); this one is
visible to the tests, so it belongs in the tests. Armed 2026-08-22 in `12b3b8e`,
and the mutation that reddens it is restoring any one of the four old names.
Stated per DRAWER rather than per pack on purpose: a profile may switch on every
toolkit, so for anybody who does, „unique within a pack" and „unique within the
drawer" are the same question — and the demo profile, the screenshot sweep and
the pack editor all reach that state.

*The founder chose to RENAME rather than retire* (2026-08-22, „Preimenuj"), so
one of each pair keeps its name and the other takes one naming something the
surface actually shows and the sibling does not: a bare-number mode, a third
check-digit regime, a target denominator, the proportional-vs-conformal pair.
**What that costs is worth writing down, because it is the part a rename cannot
do:** the two implementations stay. The redundancy is now labelled rather than
removed, and the duplicated Serbian numeral lexicon and the two copies of ISO
7064 MOD 97-10 are still one job done twice.

*The instrument half is a SECOND rule, and it needed its own fix.* Unique names
do not repair the sweep: `slug()` folds diacritics and truncates at 32
characters, so two DISTINCT names can still land on one file stem. Closed
2026-08-23 — `sweep` holds every path it has written, `shoot` keeps both frames
and disambiguates the second with a `-2` suffix, and `duplicateStems` puts the
collision at the top of `report.md` and **on the `SHOTS OK` line**, which is the
half that matters: a run that had quietly lost frames printed exactly what a
clean one prints. The duplicate list is DERIVED from the frame list rather than
tracked beside it, so the report and the sweep cannot disagree about what
happened. **A defect class can own a rule over the SUBJECT and a rule over the
INSTRUMENT, and fixing the subject makes the instrument look fixed** — the
reconciliation reconciled again the moment the four tools were renamed, and
nothing about the overwrite had changed.

**DC-76 — `1fr` is `minmax(auto, 1fr)`, so „these columns are equal" is a
request that one cell's content can refuse (2026-08-23).** The calendar's month
grid is `grid-template-columns: repeat(7, 1fr)` and the weekday header above it
is the same declaration. A day cell holds `.cal__month-chip` buttons whose
labels are `white-space: nowrap`, so a chip reading „08:00 — Plata" set that
column's AUTOMATIC MINIMUM to the full width of the sentence. The column took
it. The other six gave it up — and, because their own automatic minimum is a
one- or two-digit day number, they gave it up almost entirely: the sweep
measured `button.cal__month-day-number` reading „1", an interactive control with
a 24 px floor, at **5.7 px wide**. The header, whose labels are short and
uniform, went on drawing seven even columns that lined up with nothing beneath
them.

*What makes this a class rather than a typo* is that the surrounding code was
already written for the correct behaviour and could not enforce it. The chip
carries `overflow: hidden` and `text-overflow: ellipsis` — truncation that only
ever runs once the column stops growing, and which therefore never ran. Somebody
had already decided a chip should be clipped to its column; the track sizing
quietly overruled it. **When you find an ellipsis that never appears, look at
what is supposed to constrain it.**

*And the same grid had a SECOND consumer of the guarantee, which is what makes
this more than a cosmetic finding.* Multi-day events are drawn by an absolutely
positioned overlay whose every bar is placed with
`left: calc(${dayIndex} / 7 * 100%)` and `width: calc(${span} / 7 * 100%)` —
arithmetic that is correct if and only if a column is a seventh. It was not, so
a bar sat over days it does not belong to: „Kirija" painted across the middle of
a week whose cells had been squeezed to the right. Nothing about the overlay was
wrong. **Two halves of one feature depended on the same promise, one of them
stated it in CSS where it was not enforceable, and only the half written in
arithmetic could not silently bend.** Making the tracks `minmax(0, 1fr)` repairs
the overlay too, without touching it.

*The rule.* A track that must be an equal share is `minmax(0, 1fr)`. Bare `1fr`
is the right choice only where a cell growing past its share is the intent — and
in a calendar, a diary, a keypad or a table header it never is. Both halves of a
pair that must ALIGN (a header row and its body) have to be written the same
way, since the one with short labels stays even and hides the defect in the one
that does not.

*Blast radius, checked.* Every equal-share track in the product's CSS is in
`calendar.css`, all now `minmax(0, 1fr)`: the two weekday headers, the day cells
(`.cal__month-cells`, which `TaskMonthGrid` renders too — so the same defect was
live in TASK's month view) and the mini month picker. Two more tracks in the
same file are not shares but had the same shape: the week-number row's
remainder column, and the time grid's day headers, which are flex and take
the other route — `min-width: 0` on the item, plus the truncation that route
makes reachable. `shell.css`'s menu row was already correct by that route,
which is why it does not appear here. The internal component
gallery has two more and is not shipped UI.

*No gate.* The screenshot sweep already sees this and named it, which is the
test from wave 70b: a gate earns its keep when nothing else can see the rule.
A grep forbidding bare `1fr` would also refuse the cases where growth is
correct, and a guard that refuses the correct thing gets switched off by whoever
it obstructs (DC-15).

*It took a second instrument fix to become visible at all.* The finding existed
in exactly one frame of 2 423 — see DC-77.

**DC-77 — A sweep whose steps are not independent: every observation after the
first is conditioned on the one before it, and only the first is honest
(2026-08-23).** The screenshot harness photographs each module, then clicks
through that module's switcher and photographs every sub-view. It never put the
switcher back. Several of those switchers are backed by a PERSISTED preference,
so the next pass — the next window size, the other theme — opened the module on
the sub-view the previous pass had ended on.

*The cost was not one odd frame.* „Kalendar" opens on „Mesec"; the month grid is
the module's whole point; the first pass ended on „Ljudi". So in a run of
**2 423 frames the month grid appeared exactly once** — `min/noc` — and was
never photographed at the two larger sizes or in the light theme. The two real
defects it carries (DC-76) were reported at one width, where they would have
read as „a small-window problem" rather than as a grid that is wrong at every
width.

*And the fan-out itself went uneven, which is the tell.* „Ljudi" has no source
row and no create form, so the same scene enumerated **eighteen** options in the
first pass and **six** in the next. A harness photographing a different set of
surfaces at each size, with nothing in the report saying so — the frame TOTAL
was stable, because the frames it stopped taking at one size it started taking
at another.

*The rule.* A step in a sweep must leave the app as it found it, or the sweep is
measuring a path rather than a product. The harness already had this idea —
`scene.cleanup` exists for scenes that write rows — and simply did not apply it
to the switcher, which is the state that changes on every single scene. One
click back to the first option after the fan-out, and the loop's own assertion
(„the first option is already on screen") becomes true in every pass instead of
only the first.

*Tell, for the next instance:* two runs of the same harness that agree on the
TOTAL and disagree on the breakdown. A count that is stable because two errors
cancel is the hardest kind to notice, and comparing per-scene counts across
passes is one command.

**DC-78 — An absence that is a REFUSAL, written down in the file the change is
about to edit (2026-08-23).** ADR-086's plan needed dashboard cards to compose a
board from, and the catalogue had a conspicuous hole: five of the sixteen
modules published no widget at all — FILES, TOOLS, PRO, CANVAS, ELEC. That reads
as a gap somebody never got round to, and „five new dashboard widgets" went into
the design on that reading.

*All five manifests carried a written refusal, with a rule behind it:* **a
dashboard card draws a FACT about the profile.** Four of the five turn out to be
re-decidable against it — a file, a canvas board, a circuit and a set of enabled
toolkits are all rows of this profile — and were rightly reversed. **The fifth
was not, and it was the one the plan was most confident about**, because
„recently used tools" sounds like the most obviously useful card in the set. It
draws the DEVICE's usage history, not the profile's contents, and it would have
been a second copy of the drawer's own „Nedavno" rail three metres away. It was
dropped, having already been written.

*The rule.* When a plan's premise is „X is missing", look for a written refusal
of X before building it, and if there is one, either meet its argument or leave
X missing. When a refusal IS reversed, **rewrite it to say the rule is now
satisfied** rather than deleting it — a deleted refusal takes its reason with it,
and the next person meets the same hole with no record that it was ever
considered. And assert the outcome for **every member of the set, including the
ones that did not change** (`modules.test.ts` now pins all five), or the one
surviving refusal erodes silently the next time somebody counts modules with no
widget and finds four.

*Tell, for the next instance:* a comment inside the diff's own hunk that argues
against the diff. Four of the five refusal comments were still sitting above the
new `widgets:` arrays, contradicting the code underneath them, until they were
rewritten.

**DC-02 gained an instance in the same wave, and it is the shape worth naming:
two independent walks of one list, agreeing by coincidence.** `App` computed the
sidebar twice — `visibleModuleIds`, which numbers `Ctrl+1…Ctrl+9`, and the nav
render, which draws the rows. Both walked `registry.byCategory()` through the
same filters, so both produced the same order, and nothing was wrong. Then one
of them was asked to grow a rule: ADR-086 promotes a few modules into a pinned
group at the top. Adding that to the render alone would have renumbered the rows
on screen and left the shortcuts numbering the old order — `Ctrl+3` opening the
module in the fourth row, a defect with no error and no visible cause. Neither
walk was wrong; the defect was that there were two. The fix is not to keep them
in step but to make one derive from the other: `sidebarGroups()` returns the
groups, the render iterates them, and the shortcut list is
`groups.flatMap((group) => group.moduleIds)`. *Tell:* two pieces of code that
build the same list from the same source, far enough apart that neither mentions
the other.

**DC-79 — A container that cannot scroll, worked around ONE CHILD AT A TIME
(2026-08-23).** The onboarding shell is a centred grid, and „the shell is a
centred grid with no scroll of its own" was written down **three times** in
`shell.css` and `tools.css` — each time as the justification for capping the
list being added right there: `.onb__modules` at `46vh`, and the two-list screen
tightening the same pair to `24vh` and `28vh`. Each cap bounds the ONE child it
was written for. Everything else on the screen — a title, a description, the
recognised-trade chips, the risk notice, **the „Dalje" button** — is uncapped,
so it simply falls off the bottom. At 900×600 „Čime se baviš?" ran 121 px past
the window with no way to reach the control that advances the flow, and the
manual screen cut its pack grid in half mid-row because a scroller inside a
scroller was the only way the caps could work.

*The rule.* A cap on a child is not a scroll policy; it is a scroll policy
written once per child, and the children that arrive later do not get one. Put
the scroll on the container that owns the overflow — here `.onb__card`
(`max-height: 100%; overflow-y: auto`), not `.onb`, because `.onb` hosts the
star field as an absolutely positioned layer and a scrolling parent would carry
the sky up with the content. **Then delete every cap**: their whole
justification was the sentence that just stopped being true, and a cap left
behind is the nested scroller that cut the grid.

*Tell, for the next instance:* the same sentence appearing as a comment in more
than one rule, explaining why a `vh` number is there. A constraint restated is a
constraint nobody owns. The second tell is a `vh` unit on anything that is not a
viewport-sized surface — it measures the window, and the thing being bounded is
inside a card inside a padded grid, so the number is a guess that has to be
re-guessed whenever the chrome around it changes.

*Two sub-24px hit targets fell out of the same photograph, and they are one
class with the caps.* `.onb__quiet` („Otkaži", „Preskoči", „Podesi ručno") was
14.8 px tall — it copied `.set__reset`'s LOOK (no border, no fill, muted,
caption size) and dropped the `min-height: 24px` that makes it a control rather
than a link; the comment above it even names `.set__reset` as its source. Every
other bare-text button in the tree states that minimum. *Tell:* a comment that
names the pattern it copied — check what else that pattern says.

**DC-80 — A language with NO NEUTRAL FORM, and a house convention that quietly
picked one (2026-08-23).** Serbian's past tense is an l-participle that agrees
with its subject, so „šta si uneo", „Nisi izabrao" and „Rekao si" have all
chosen the reader's gender — and the only gender this product ever chose was
masculine. The sentence that surfaced it never shipped — the new reveal screen
said „Rekao si", and a screenshot is what showed it — but **behind it were forty
lines already in the shipped tree**. It was not a slip: „granica koju si uneo"
is a deliberate convention that says *whose* a limit is, and **six file headers
told the next author to copy it**, which is why it reached ten packs.

*Root cause.* The convention was designed for the right reason (attribute the
limit to the person, never to the app) and expressed through the one
construction Serbian cannot make gender-free. The possessive says the same thing
and has no gender: **„tvoja granica"**. The other three rewrites are the present
(„vrednosti koje uneseš"), the impersonal („bez odgovora…") and the passive
(„da li je nalepljen ceo odgovor").

*Why it is a gate (`check:address`, the fifteenth).* Nothing else in the tree can
see it. It is valid Serbian, valid TypeScript, and it photographs correctly, so
the screenshot sweep is blind to it; `check:strings` measures *when* a read
happens; the suites assert keys, not grammar; and review missed all forty
across every pass the drawer has had — including mine, twice, with a narrower
regex that did not know a participle can end in `-eo`. The gate parses with the
TypeScript compiler and looks only at string LITERALS, so the file headers that
now forbid the phrasing by naming it do not trip it.

*Tell, for the next instance:* a phrasing recommended in a file header. A
convention with six copies of its own instruction is a convention that will be
reproduced faithfully, including whatever is wrong with it. And more generally:
any rule of a natural language that a sentence cannot decline to answer —
gender, formality (`ti`/`vi`), number — has been answered by every line of copy
already written, whether or not anybody decided it.

*Amended 2026-08-30 — the gate was narrower than the class, twice, and both
holes had a live instance behind them.* Each widening found one more line —
thirty-nine and forty, on top of the thirty-eight the first version saw — which
is the strongest evidence a gate's REACH is part of the gate (DC-45).

- **It knew participles and not ADJECTIVES.** „proveri ako nisi siguran" was
  live in `pro.trening.ts`, in a sentence about women's barbells, and this
  suite's own „does not fire" case asserted a sentence containing those very
  words was clean. Serbian predicative adjectives agree with the person
  addressed exactly as participles do. `MASCULINE_PREDICATES` is a curated list
  rather than a pattern, because a masculine adjective ends in a consonant and
  so does most of the language — „slobodan prostor" and „naziv je obavezan" are
  two dozen honest lines here, all agreeing with a NOUN. The `si`/`nisi` beside
  it is what makes the pair precise.
- **It read a sentence's PIECES.** The copy is hand-wrapped near 100 columns, so
  a line long enough to need `+` puts its words either side of the operator by
  accident of length: `"…one iznose koje si " + "uneo."` in
  `pro.racunovodstvo.ts` is one sentence to the reader and two literals to a
  parser, and neither literal has both the trigger and the word it governs. A
  `+` chain is now scanned as one text — and it REPLACES its own leaves in the
  output, so a sentence is still reported once.

*Tell for both:* a gate whose unit of analysis is smaller than the unit the
defect lives in. The class is „a sentence picks the reader's gender"; the first
implementation read one grammatical form inside one syntax node, and the two
gaps are exactly the two ways a sentence can be bigger than that.

**DC-81 — A hand-written list of CAUSES beside a computation that already knows
its own inputs (2026-08-30).** ADR-086's fourth law is „every reason names at
least one signal", and `buildProfilePlan` broke it on its own first screen.
`wantedBoard` is written by four kinds of answer — a week shape, a keep, a tempo
and a TRADE (through `PACK_WANTS`) — and the `board` reason's `causedBy`
concatenated three of them. So a person who only said what they do for a living
got a board of three cards and a sentence explaining it that named nothing at
all: „Početna ti ima 3 kartice" with no „because", which is the one thing the
reveal screen exists to never do.

*Root cause.* The cause list mirrors the computation's inputs and is maintained
by hand, in a different function, thirty lines away. Nothing ties the two
together, so the mirror is correct only until somebody adds a fifth writer to
`wantedBoard` — and adding one is exactly what ADR-086 did to a table that
predated the reason.

*Why nothing saw it.* Every law-4 test supplied a FULL questionnaire. With week,
keep and tempo all present, `causedBy` is non-empty however many kinds are
missing from it, so the invariant passed on every case while being false. The
hole is reachable only from a SPARSE input — one kind of answer and no other —
and a suite that always fills the form never constructs one.

*Tell, for the next instance:* an array built by concatenating filters over the
same source, where the number of terms is smaller than the number of code paths
that write the value it explains. And, one level up: **an invariant whose test
cases all supply every input.** A law is a claim about every set, so the case
that proves it is the smallest set that can still trigger the rule, not the
largest.

*Not a gate.* The rule „this list must name every writer of that variable" is a
dataflow question over one function, and no cheap textual check states it. What
does state it is the test that now exists: a plan built from trades ALONE, with
`expect(reason.causedBy.length).toBeGreaterThan(0)` for every reason in it.

**DC-82 — A function whose DOC COMMENT names its call sites, and which has none
(2026-08-30).** `clearPinnedModules` was exported, tested, and documented as
„„Vrati na podrazumevano" (SET §5), and the „Napredno" escape hatch". Neither
call site existed. The comment was the only evidence anywhere that a person
could get their old sidebar back, and it was evidence about an intention rather
than about the app.

*Root cause.* The preference module was written as a set — read, write, clear —
because that is what the two modules it was modelled on (`accent.ts`,
`calendarPrefs.ts`) have. But those two are `SET §5` resets and this one is not:
the way back from a pinned sidebar is an ordinary empty WRITE, because a plan
with no signals has an empty `navPrimary` and `persistPinnedModules(id, [])`
removes the key. The escape hatch was real and reachable — „Ponovo pokreni
upitnik" then „Preskoči" — through the function that was already there.

*Why the test made it worse.* `clearPinnedModules` had a test of its own, so the
export was green, covered, and dead. A test proves a function works; it says
nothing about whether anything calls it, and it is the thing most likely to keep
an unused export looking used.

*Tell, for the next instance:* an exported function referenced by exactly one
file, and that file is its own `.test.ts`. Worth a grep whenever a preference
module is written by copying another one — the shape is copied whole, including
the members this key has no use for.

*Not a gate, deliberately.* An unused export is not an unused variable, so the
linter cannot see it, and a repo-wide dead-export check would need a tool this
tree does not carry (and would fire on every barrel). The rule that DOES fire is
the one already in `CLAUDE.md`: treat an unused import — or an unused export —
as a question, not a nit, because it is usually half a feature. Here it was half
a feature that turned out to be whole somewhere else.

**DC-83 — A gate that reads text cannot tell code from a comment ABOUT that
code, so the file documenting the trap is the file that fails (2026-08-30).**
`check:zeroize` went red on `main/sync/round.ts:39`, which is a line inside the
file's header:

    * `try { return syncOnce(…) } finally { keys.zeroize() }`, which erases the
    * keys AT THE RETURN STATEMENT…

There is no such code in that file. The header says the opposite, at length,
because the defect the gate exists for is invisible in correct-looking code and
the mitigation is that every file which meets it writes the wrong shape down.

*Root cause.* The gate's unit of analysis is source TEXT, and prose about a
construct is textually identical to the construct.

*Blast radius, and why it is a class rather than an incident.* This is the THIRD
time. `check:egress` met it first — its last two findings were `strings.sr.ts`'s
own privacy copy and a JSDoc line — and `check:elec` met it second, on the six
files that explain in comments that a wire's colour comes from a
`--nx-elec-wire-*` token. Both were fixed by `scripts/strip-comments.mjs`, whose
own header states the rule out loud: *„a gate firing on prose about itself
teaches people to stop writing the prose"*. `check:zeroize` was written after
that module existed and did not use it — so the shared fix was there and the
third gate went without it, which is the ordinary way a repository-wide answer
stops being repository-wide.

*Why this instance is the worst of the three.* For `egress` and `elec` the prose
is incidental. For `zeroize` the prose IS the countermeasure: the failure it
guards produces plausible ciphertext and an error message that accuses the
server, so a file that meets it is supposed to quote the wrong shape. A gate that
punished that would be deleting its own documentation, and the cheap way out —
rewording the comment so it no longer looks like code — is the fix that makes the
next author's warning worse.

*Fixed once, where it belongs.* `scanSource` now runs `stripComments` first;
blanking preserves newlines, so a reported line is still the right one. Two tests
pin it: the quoted defect in a comment is not a finding, and a real defect on the
line UNDER a comment describing it is still reported at its own line number.

*Tell, for the next instance:* a gate finding whose reported line is inside a
`/** */` or after a `//`. Ask it of any new text-scanning gate before it ships —
the question is „what does this do to a file that explains the rule?", and the
answer should be `stripComments`.

**DC-84 — A hand-written list that must contain every workspace dependency,
beside the `package.json` that already declares them (2026-08-30).**
`electron.vite.config.ts` externalises node modules and BUNDLES workspace
packages, because those are consumed as raw TypeScript and Node cannot execute
`.ts`. Which packages are „ours" was a literal array of eight names.
`@nexus/sync-engine` became the ninth dependency and nobody edited the array.

*What made it invisible.* `pnpm typecheck` (13/13), `pnpm lint` (13/13),
`pnpm test` (1 700+) and `pnpm build` (4/4) ALL PASSED — every one of them reads
TypeScript source through Vite or `tsc`, and none of them executes the packaged
main process. The only thing in the gate set that could see it was
`pnpm --filter @nexus/desktop smoke`, which failed at load with
`ERR_MODULE_NOT_FOUND … packages/sync-engine/src/round.js`: Electron resolving
the package's `exports` to `src/index.ts` and then failing on its `./round.js`
import, a specifier that only ever resolves after a bundler has rewritten it.

*Root cause.* Two declarations of one fact. `package.json` says which
dependencies are `workspace:*`; the array said it again, by hand, in a file
nobody opens when adding a dependency.

*Fix.* The array is derived from `apps/desktop/package.json`'s own dependencies
— every range starting `workspace:`. The ninth package is bundled the day it is
depended on, and there is nothing left to forget.

*No gate, deliberately.* The derivation makes the class unrepresentable, which
is better than a check that reports it. A gate here would be a second reading of
the same rule, which is what caused this.

*Tell, for the next instance:* a build-tool config containing a literal list of
first-party package names. Also the general one: **a green gate set is evidence
about what the gates execute.** Four of the five gates never run the shipped
artefact, and the fifth is the reason this took twenty minutes instead of a
user's bug report.

**DC-85 — A type that ARRIVED rather than being declared, from a package nobody
asked for it (2026-08-31).**
Six packages — `core`, `sync`, `sync-crypto`, `sync-engine`, `sync-transport`
and, in its tests, `sync-transport` again — compiled against `TextEncoder`,
`TextDecoder`, `URL`, `atob`, `btoa`, `crypto`, `fetch`, `Response`, `process`,
`Buffer` and `node:crypto` while their `tsconfig.json` said `lib: ["ES2023"]`
and named no `types` at all. They typechecked for months because TypeScript
loads every `@types/*` package it can reach by walking `node_modules` upward
from each source file — and under pnpm, that walk goes THROUGH the symlink for
each declared devDependency into the store, where a test runner's own
dependencies sit. `vitest@3` shipped `@types/chai` and `@types/debug`, which put
an `@types` directory on that walk, which pulled in the whole of `@types/node`.
`vitest@4` dropped both. Thirty-two errors, in thirteen files, none of them
touched.

*What made it invisible.* „The type arrived" and „the type was declared" are the
same observation from inside `tsc` — there is no diagnostic for *this name
resolved through a directory you did not ask for*, and `skipLibCheck: true`
silences everything downstream. No gate in this repository reads a `tsconfig`,
and no gate could usefully be written for it: the rule is not „declare `lib`",
it is „declare the platform you actually compile against", and only the compiler
knows what that is. The tell is the failure shape, not the code: **a
devDependency bump produces errors in files it does not import.**

*Root cause.* A tsconfig that describes a platform is a claim; these six made
none, so nothing could be wrong. What was actually true — that the sync stack
and the domain layer target the WEB platform surface, deliberately, so one
implementation serves the Electron main process, the renderer and a browser tab
— was written down in `sync-port`'s tsconfig and in `sync/package.json`'s own
description, and nowhere that a compiler reads.

*Fix.* Every one of them now states it: `lib: ["ES2023", "DOM"]` where the code
uses web globals, `types: ["node"]` (and a declared `@types/node`) where a test
genuinely uses Node, and `DOM.Iterable` in `core` for the one `URLSearchParams`
iteration. A claim that can be wrong is a claim that can be checked.

*And it uncovered a second thing, which is the more useful half.* Declaring
`lib: DOM` on `sync-crypto` made its FAKE `CryptoPort` fail where the REAL one
in `sync-port` had always passed: the real port has a documented `view()` helper
adapting `Uint8Array<ArrayBufferLike>` to WebCrypto's `BufferSource`, and the
fake had never needed one because it was meeting Node's looser types. **Two
implementations of one port, held to two different contracts, and the weaker one
is what every sync test in the repository runs against.** The helper is now
`asBufferSource` in `@nexus/sync-crypto`, imported by both — one function, one
comment, and the fake can no longer drift from the thing it fakes on a rule
neither of them states. `@nexus/core` keeps a second copy on purpose, with the
reason in its doc: the domain layer must not grow a dependency on the sync stack
to obtain a one-line cast.

*Tell, for the next instance:* a `tsconfig.json` whose `compilerOptions` is only
`noEmit`, in a package that touches a platform global. Also the general one:
**an accident that works is indistinguishable from a decision until something
removes it.**

**DC-86 — Pinning the fetcher and not what it fetches (2026-08-31).**
`.github/workflows/ci.yml` opens with a paragraph explaining that every `uses:`
in this repository is pinned to a 40-character commit SHA, and why: a tag is a
mutable pointer, and in March 2025 an attacker repointed every tag of
`tj-actions/changed-files` at one commit that dumped CI secrets into build logs.
Every action here obeys that. Then one of them was handed `version: latest` as
an **input** — `supabase/setup-cli`, whose entire job is to fetch a tool.

*Root cause.* The pin was applied to the wrong layer. Pinning the action fixes
which code decides *how* to install the Supabase CLI; it says nothing about
*which* CLI, and each CLI release pins its own set of Docker image tags for
Postgres, PostgREST, GoTrue, Realtime, Storage and the rest. So the `database`
job re-resolved its whole stack on every run, with no commit in this repository
to point at — the exact drift the SHA pins exist to prevent, reintroduced one
line below a comment forbidding it.

*Why it matters more here than for an ordinary unpinned dependency.* This job's
purpose is to answer one question: are the migrations sound. An answer is only
useful if a red run means what it says. Under `latest`, „the SQL broke" and „the
toolchain moved under us" are the same colour, and a job whose red cannot be
read is a job people learn to re-run instead of read.

*Honest note on what did and did not cause the failure that found it.* The
`database` job went red on `f3e6233` with `error running container: exit 125`
during `supabase db reset`, before any project SQL ran. That was **not** this
defect: `setup-cli`'s `latest` resolves to the latest *stable* release, which
was v2.116.0 (2026-08-26) for both the passing run and the failing one — only
2.117.0 betas were published that day, and those are not `latest`. The failure
was environmental, and the whole-stack `supabase start` that precedes it is the
likelier pressure. The unpinned CLI is a real defect found while looking, not
the cause of what was being looked at, and saying otherwise would be inventing a
root cause because one was wanted.

*Fix.* `version: 2.116.0`, with the reasoning beside it and a note that the bump
is deliberate — a stale CLI against a purely LOCAL stack costs nothing, and the
bump becomes a diff somebody read.

*Tell, for the next instance:* a pinned `uses:` with an unpinned `with:`. More
generally — **whenever something is pinned, ask what that thing then goes and
fetches.** `actions/setup-node` is the same shape and is fine here only because
`node-version: 24` is a deliberate line and pnpm's version comes from
`packageManager` in `package.json`, which is exact.

**DC-87 — Asking whether a part is ON the net, when the property meant is where
it sits IN the path (2026-08-31).** E3's `led-unprotected` rule fires when a LED
is driven with no series resistor. The first implementation asked: is there a
part with `valueUnit: "ohm"` somewhere on the anode's net? Green tests, and
wrong twice over. A resistor with one leg on that net and its other leg in the
air is *on the net* and protects nothing — the false negative, which the LED
sits behind while the panel says the circuit is fine. And a resistor on the
**cathode** side is equally valid protection that the rule could not see, so a
correct circuit would have been reported — the false positive, which is worse,
because a rules panel that cries wolf is one the user stops reading.

*Root cause.* A net is a set, and set membership is not a position. „Protected"
is a statement about the *path* current takes: something must interrupt it
between the driving pin and ground. Membership can never express that, no matter
which component types the predicate learns to recognise.

*Fix, and why it is smaller than the bug.* The rule became purely topological —
report only when a driving pin is directly on the anode's net **and** ground is
directly on the cathode's net, i.e. nothing is in the path at all. That deleted
`hasResistance` and, with it, the rule's dependence on `valueUnit`: it now
reports the shape it means and says nothing about a resistor, a current-limiting
driver, or anything else a future catalogue entry might be. Both directions are
locked by a test.

*How it was found, which is the part worth copying.* Not by review. The demo
circuits are correct, so „the engine returns nothing" and „the engine is broken"
look identical on them; the check that found it was a **mutation test** — take
the resistor out of the demo circuit's path and assert the rule now fires. Any
derived-fact engine needs one of these, because the passing case of a rules
engine is an empty list, and an empty list is also what a dead engine returns.

*Tell, for the next instance:* a predicate that scans a collection for a member
with the right *type* in order to conclude something about *order*, *series* or
*between*. E4 and E5 read the same nets and will want the same shortcut.

**DC-88 — Reading one end's CAPABILITY as the wiring's INTENT (2026-08-31).**
Two defects, in two modules, from one rule. E4's sketch generator asked „can this
board pin carry a bus?" and E3's `bus-role` rule asked „does either end declare a
bus role?". Both meant „is this wire a bus?", which is a question about *two*
ends, and neither asked the second one.

The catalogue had already written the correct rule down, three months earlier,
beside the UNO's analogue block: „A4 and A5 double as the I²C pair — the
ambiguity that makes „is this an analogue input or the bus?" a question about the
wiring, not the pin." **Every hardware bus pin on every board in the catalogue is
also an ordinary GPIO with a second name.** A UNO's D10–D13 are the SPI header
*and* four digital pins; A4/A5 are the I²C pair *and* two analogue inputs.

*What each produced.* The generator, for the demo profile's own circuit — an
HC-SR04 on D10 and D11 — emitted `#include <SPI.h>` and `SPI.begin()` for a
board with no SPI device on it, and then named **neither pin**: both looked like
bus lines a library owned, so the sketch had no `constexpr`, no `pinMode`, no
read, and a `loop` saying „no pin is read here". The rules engine, for a BMP280
bit-banged onto D11, reported `bus-role` — severity **error** — on a legitimate
circuit, which is the exact practice its own comment says is ordinary. The
comment was true of a pin that declares *no* role and was read as being true of
a pin that is *not committed*, and those turned out to be very different sets.

*Fix, once, where it belongs.* One `pinBuses(pin)` in `component.ts` — beside
`BUS_REQUIREMENTS`, which answers the other question and is deliberately not the
same table (an SPI part must have SCK and a data line; it need not have CS,
which is very often a plain GPIO). Both modules intersect the two ends through
it: the sketch marks a wire as a hardware bus only where both ends share a bus,
and the rules engine judges two pins as crossed only when they are **on the same
bus** and badly paired. Different buses at the two ends means one of them is
bit-banging, which is nobody's business but the user's.

*How it was found, which is again the part worth copying.* Not by review, not by
a test — by **looking at a screenshot**. The sweep's new `electronics-sketch`
frame showed the generated file, and `#include <SPI.h>` above a circuit with an
ultrasonic sensor in it is wrong to anyone who reads C. Every test passed; the
fixtures had no board pin carrying a spare role, because a hand-written fixture
is trimmed to what the test needs and the second name is exactly the thing a
trimmed pin loses. Both fixtures now carry D11, with a comment saying why.

*Tell, for the next instance:* any predicate of the form `x.functions.some(…)`
or `x.roles.includes(…)` used to decide something about a **relationship**. If
the sentence you would write has two nouns in it — „this wire is a bus", „this
pin drives that one" — a predicate over one noun cannot be the whole answer.

**DC-89 — Waiting for the control to be AVAILABLE instead of for the state to
have ARRIVED (2026-08-31).** A sweep scene had to switch to another circuit and
then open that circuit's generated sketch. It selected the circuit, polled until
the „Kod" button was no longer `disabled`, and clicked it — and photographed the
ordinary page, with no dialog, under the dialog's name.

`disabled` was a true reading of a stale state. Selecting a circuit only
SCHEDULES the page's effect; for one turn the button is still enabled **on the
outgoing document**. The click opened the dialog, the effect ran a moment later,
and the effect's job is precisely to drop a dialog that belongs to the circuit
that just closed. Every step did what it says.

*The general shape.* `!disabled`, `!== null`, „the element exists" and „the
spinner is gone" are all properties of *whatever state is current*, and a probe
that starts checking them in the same turn as the navigation reads the old one.
Two animation frames are enough for a target that does not exist yet — which is
what `CLICK_THEN` was written for and says so — and are not enough for a target
that exists on the state you just navigated away from. The second case looks
identical from the outside and is the one that produces a green run.

**The second draft is the more useful half of this entry.** The obvious repair
is to wait for the TRANSITION instead: require the button to be seen `disabled`
before believing an enabled one. That ran, and reported „found nothing to open"
six times out of six — because `setDoc(null)` and the `setDoc(opened)` that
follows a sub-millisecond IPC read coalesce into a single React render. **The
loading state is real, is correct, and is never painted.** A state that exists
in the model is not therefore observable in the DOM, and a wait built on one
that isn't fails closed if you are lucky and open if you are not.

*Fix.* Wait for the **outcome**, which is the one thing that cannot be a proxy:
the dialog's own panel is in the DOM or it is not. The probe clicks and
re-checks until the panel is there, and reports „none" if it never gets there —
so a click that lands on the wrong turn simply happens again next frame.

*Tell, for the next instance:* a probe or a test that navigates and then acts,
where the thing it waits for would ALSO be true if the navigation had never
happened. If the wait would pass on the old page, it is not a wait — and if the
answer to that is a cleverer precondition rather than the outcome itself, expect
to write this entry twice.

**DC-90 — A portal hangs outside the element that sets the colour (2026-09-01).**
The sketch dialog's wiring table has three columns; two carry a class of their
own and the middle one, a part's name, carries none. In Noć it rendered a shade
that was not any token — because it was not `--nx-text-muted`, it was Chromium's
default BLACK, on a blue-black surface.

`color: var(--nx-text)` is set on **`.nx-app`**, and twenty components render
through `createPortal(…, document.body)` — every dialog, the search palette,
every popover. All of that markup is a sibling of `.nx-app`, not a descendant,
so none of it inherits the app's colour. It has been legible for months only
because every panel's children happen to name a colour themselves: the dialog
title says `--nx-text`, the question says `--nx-text-muted`, the code block says
`--nx-text`. The rule „inside a portal, every text node needs an explicit
colour" was load-bearing and written down nowhere, and the first element in
months that did not follow it was a `<td>`.

*Fix, once, where it belongs.* `body` now sets `color: var(--nx-text)` — one
line, beside the `background: var(--nx-bg)` that is on `body` for the exactly
analogous reason and whose comment already explains it („white never appears" is
made true by construction rather than by everyone remembering). In Dan the UA
default and `--nx-text` are both near-black, so nothing there ever showed the
defect; that asymmetry is why it survived — **the theme that would have exposed
it is the one a light-mode reviewer never opens.**

*Tell, for the next instance:* any new markup inside a `createPortal` target, and
any „this text looks slightly off but matches no token". Both are the same
question — *what is this element's nearest ancestor that names a colour, and is
it inside the app at all?*

**DC-91 — A word that says what a wire CARRIES is read as which way it GOES
(2026-09-01).** DC-88's sibling, one slice later, and found the same way: by
asking what the *other* generator would do with the rule E4a had already
shipped. `pwm` is not a direction. On a board's D9 it means „there is a timer
behind this hole"; on a servo's `SIG` or an L298N's `ENA` it means „this input
wants a waveform". One word, two opposite ends — exactly as `i2c-sda` is one
word at both ends of a bus.

Two places had it in a list of things that drive. `sketch.ts` therefore made the
board an **`INPUT`** on a motor-enable line, and then printed that floating pin
to the serial monitor as though it were a measurement — a reading of the noise
on a pin the sketch had just refused to drive. `rules.ts`'s hand-kept `DRIVING`
array had the same entry, so `output-conflict` could fire on two servos
paralleled off one line, which is how people parallel two servos.

*Fix, once, where it belongs.* `PIN_FLOW`, a **total** `Record<PinFunction,
PinFlow>` in `component.ts` with three answers — `drives`, `listens`, and the
one that kept being forgotten, `neither`. Total rather than three arrays for
`BUS_ROLE_FUNCTIONS`'s reason: a twenty-fifth pin function is now a compile
error that somebody must answer, instead of a string that silently belongs to no
list and is treated as `neither` by one reader and as a direction by the next.
Both call sites read it; the two arrays are gone. And the blast radius reached
the **catalogue**: twelve peripheral pins across `actuators`, `comms` and
`drivers` said only `["pwm"]`, which under the new rule is „no direction at all"
— true of the word, false of the part. Each is now `["digital-in", "pwm"]`,
which is what a servo's `SIG` actually is.

*Tell, for the next instance:* any list literal named for a direction —
`DRIVING`, `INPUTS`, `SOURCES` — whose members are drawn from a vocabulary that
also contains protocol names. Ask of each entry: *does this word name an END, or
does it name a SIGNAL?* If it names a signal, it belongs in neither list, and a
list is the wrong shape for the question.

**DC-92 — Matching a pin by its NAME where its FUNCTION was meant
(2026-09-01).** The demo seeder's test asserted the trade's wire colours by
looking for a pin literally spelled `"5V"`, with `find`, once per circuit. It
passed for as long as every board in the demo profile was an Arduino. A
Raspberry Pi supplies its peripherals from `3V3`; the name matched nothing,
`find` answered `undefined`, and a convention nobody had broken was reported
broken with `expected "red" received undefined`.

Two mistakes, and the second is the one that made the first invisible. A name is
a label a catalogue author chose; `power-out` is the fact. And `find` asks „is
the first one right", which is a strictly weaker question than „are they all
right" — the test read as a check of the whole circuit and checked one wire.

*Fix, once, where it belongs.* Over **every** wire, by the pin's declared
functions, plus a count that must be non-zero — so a circuit whose parts stop
resolving cannot pass by having no opinion about any wire. That last clause is
the mutation guard DC-87 taught: an empty result is also what a broken instrument
returns.

*Tell, for the next instance:* any string literal in a test that is an
identifier from a data table — a pin id, a component id, a category key — used
to select the thing a semantic field already describes. Ask whether the assertion
would survive a second row being added to that table, because the demo profile
gaining a third circuit is the whole of what happened here.

**DC-93 — A generator that overwrites in place leaves an orphan when a name
changes (2026-09-01).** The screenshot sweep writes each frame to a path derived
from its scene id and deliberately does **not** wipe its output directory first:
a run that dies late should still leave a usable set beside a report saying how
far it got. The cost is invisible until something is renamed. Three ELEC scenes
became `electronics-code-*`, and `electronics-sketch.png` and
`electronics-sketch-libraries.png` stayed on disk in every size and theme —
twelve files, current-looking, taken by a scene that no longer exists.

Nothing could see them. `frames.json` lists only what the run wrote, so the
report was right and complete about a directory it was describing incompletely.
The one reader who *could* see them is a person opening the folder, which is the
reader the whole instrument exists for. Same shape as `check:licences`: a
generated file that is kept rather than regenerated goes stale silently, and the
test over its *contents* cannot ask whether it should still be there at all.

*Fix, once, where it belongs.* A prune after the sweep — every `.png` under the
output directory that this run did not write is deleted, with a line on stderr
naming it. Placed on the **success path and not in the `finally`**, and that
placement is the whole design: a crashed run has a short frame list and a full
directory, so pruning there would delete every frame the run had not reached and
turn one transient capture failure into the loss of the previous run's evidence.

*Tell, for the next instance:* any writer whose output path is derived from a
name that a human can change — a scene id, a slug, a locale code — that does not
also own deletion. „Regenerate" that only ever creates and overwrites is a
half-implemented operation, and the half it is missing shows up as a file
nobody will question because it looks exactly like the ones beside it.

**DC-94 — A new child table under an existing parent leaves the parent's
BEFORE DELETE trigger describing the children that existed when it was written
(2026-09-01).** Migration 067 gave `circuits` a `_sync_bd` trigger, and it is
not decoration: once the circuit row is gone there is no `profile_id` anywhere
on the path, so a cascaded child's own AFTER DELETE selects nothing and journals
nothing — the tombstone is never pushed and the other device keeps parts of a
circuit it was told to forget. Migration 068 added `circuit_chassis` under the
same parent, with the same `ON DELETE CASCADE`, and inherited none of that:
SQLite has no `ALTER TRIGGER`, so a trigger written for two children stays
written for two children forever unless somebody drops and recreates it.

What makes this a class rather than an oversight is that **every other guard
passed**. The new table has its own three triggers; `journal.test.ts`'s shape
test walks `SYNC_MAP` and finds them; `collectionGuard.test.ts` agrees the map
and `RESTORE_WIPE_TABLES` describe the same set. All of those ask „does this
table have triggers", and none can ask „does its PARENT still know about it" —
the parent's trigger body is a SQL string that mentions two table names, and no
test in the tree reads it.

*Fix, once, where it belongs.* Migration 068 drops and recreates
`circuits_sync_bd` with the third `INSERT ... SELECT`, and a journal test deletes
a circuit that has a machine and asserts both tombstones. The test is the part
that generalises: it names the cascade rather than the trigger.

*Tell, for the next instance:* any migration that adds a table whose foreign key
is `ON DELETE CASCADE` into a parent that already has children. The question to
ask is not „did I write my triggers" but „whose trigger already enumerates my
siblings, and does it now enumerate me". The same shape reaches beyond triggers:
a hand-written enumeration of a set — a `CASE` over record types, a wipe list, a
`SELECT` naming sibling tables — is stale the moment the set grows, and only the
ones that live next to a test that derives the set can say so.

**DC-95 — A prose count that describes the list it sits beside, and is never
re-counted (2026-09-01).** `packages/sync/src/collections.ts` documents its own
map in sentences: „Forty-four of the fifty-four collections", „the eight
collections that carry no `profile_id` column of their own", „Ten collections
identify their objects by a NATURAL key". Every one of those was written true
and every one had gone stale — the real numbers on the day this was noticed were
45, 11 and 7, and the natural-key sentence had also stopped listing two of the
columns it claimed to enumerate. `repair.ts` and `projection.ts` carried the
same shape („eleven table-level CHECKs"), and there the number was load-bearing
prose: it is the file's own argument for why the repair exists.

Nothing can see it. A count in a comment is not a value, so no test compares it,
no gate parses it, and a reader who does not stop to count has no signal that
anything is wrong — the sentence is grammatical, plausible, and beside the
evidence. It is the documentation form of DC-93: a generated-looking artefact
that is maintained by hand and therefore silently ages.

*Fix, once, where it belongs.* Corrected to the real numbers, and — the part
that matters — each one re-derived by counting the list rather than by adjusting
the previous number, because „it said ten, I added one, so eleven" is how the
first of these became wrong.

*Tell, for the next instance:* a comment that counts something in the same file
is a test that never runs. Prefer a sentence that does not need a number
(„every collection whose identity is not its own id"), and where the number
genuinely helps a reader, put it where a test can reach it — the way
`OPEN_QUESTIONS` is asserted non-empty rather than described as non-empty.

**DC-96 — A promise in shared copy that only one branch keeps (2026-09-02).**
„Mašina" is offered on every circuit and its description says the nine numbers
*„idu u model koji simulator čita"*. The model is a file of the ROS 2 package,
so on an Arduino — where „Kod" produces a sketch — that sentence was simply
false: the user measured a machine, saved it, opened the artefact and found no
mention of it anywhere. The control was shared, the copy was shared, and the
outcome was not.

Nothing can see it. Both branches are well-typed, both render, both are green;
the defect is a sentence that is true in one of them. Nor is it the ordinary
„unfinished feature" — the feature is finished, and what is missing is the
*disclosure* that it does not apply here, which no test asserts because no test
reads prose.

*Fix, once, where it belongs.* The sketch half prints the absence and the reason,
the way the package half already prints its own („Za ovo kolo nije opisana
nijedna mašina…"). Printed, never hidden: a section that vanishes is
indistinguishable from a feature that broke. The demo profile gained a measured
Arduino so the branch has a photograph.

*Tell, for the next instance:* when one control feeds two artefacts, read its
copy once per artefact and ask whether the sentence is still true. A promise
made in a shared surface is made by every branch that surface reaches, and the
branch that cannot keep it has to say so out loud.

**DC-97 — A member inserted above a doc comment orphans it (2026-09-02).**
`chassis` was added to `strings/electronics.ts` immediately before the E4
`code:` block — and immediately AFTER the four-paragraph comment that documents
`code:`. The result is two `/** … */` blocks in a row, the first one now
describing the key below the second. Valid TypeScript, valid Markdown in the
hover, and wrong for the next reader: „the reason tables here are NOT the ones
`ros.ts` prints" is now apparently about a chassis form.

Nothing can see it. There is no unused-comment warning, no gate that parses
JSDoc attachment, and a diff shows the insertion as a clean addition — the
displaced comment does not appear in it at all, because it did not change.

*Fix, once, where it belongs.* The new block moved above the comment rather than
the comment being duplicated or trimmed. Then a sweep for the SHAPE — a `*/`
followed by nothing but a new `/**` — over every file this slice touched, and a
diff of that count against `HEAD` so the pre-existing legitimate instances (file
headers, mostly) did not have to be read one by one.

*Tell, for the next instance:* after inserting a member into a large literal or
interface, look at the line ABOVE the insertion, not only at the lines you
wrote. `*/` on the line before your new `/**` means you have taken someone
else's comment. It is a two-command check and it is the only signal there is.

**DC-98 — A new surface reaches for the native control the design system
already replaced (2026-09-02).** `packages/ui` replaces the OS radio and
checkbox with `.nx-radio` and `.nx-checkbox`: a 15 px box painted in the theme's
tokens, behind a 24×24 transparent hit area. A bare `<input type="radio">` gets
none of it — 13×13, grey in Dan and grey in Noć, because the OS does not know
the app has themes, and eleven pixels under the pointer floor the rest of the
product holds. It has now been written three times: `priv.css` (fixed by hand,
with a comment), the Elektronika chassis dialog (found by the sweep's
`small-target` audit), and a checkbox in `FitRoutines.tsx` that nobody had ever
noticed.

The cause is not carelessness, and that is the useful part. The design system's
answer to „I need a radio" is a **class**, not a component — so there is no
import to forget, no symbol to autocomplete, and nothing that distinguishes the
right answer from the ordinary JSX a developer already knows. The wrong version
is the shorter one.

Nothing can see it. It uses no colour, so `check:colours` and `check:contrast`
read nothing; it declares no custom property, so `check:tokens` finds nothing
missing; it typechecks, because a native input is valid React; and the linter
has no rule about it. The only check that ever caught one was **photography** —
and photography holds exactly where the camera goes: the third instance sits
three modal steps inside a form the sweep cannot drive (create a routine, open
it, add an exercise), which is [DC-57]'s shape one level up.

*Fix, once, where it belongs.* `check:controls` — a `<input>` whose attributes
say `radio` or `checkbox` must carry its own shared class, in every `.tsx` under
`apps/` and `packages/`, the component gallery included. `ALLOWED` holds one
file, the `<Checkbox>` component itself, which paints the class on its wrapping
`<label>`. The scanner tracks brace depth rather than matching `<input[^>]*>`,
because the first `>` after the tag is the arrow in `onChange={(event) => …}`
and a regex version would have reported the four correct `PrivPage.tsx` radios
as findings — a gate whose first run is wrong about known-good code is a gate
somebody deletes.

*Tell, for the next instance:* when the design system's replacement for a native
element is a CLASS, the class is a convention and conventions are not enforced
by anything. Either make it a component the type system can require, or make it
a gate. „Every other one in the tree does it correctly" is the description of a
rule that has never been checked, not evidence that it holds.

**DC-99 — An instrument whose COVERAGE follows the wall clock reports
intermittently about code that is not intermittent (2026-09-02).** The
screenshot sweep reported `clipped-text` on a calendar block in one run and
nothing in the runs on either side of it, same date, same code. The first
diagnosis blamed the fixture — the demo seed places sessions relative to
`Date.now()`, so surely the overlap count drifts. It does not: `seedDemoFocus`
is deterministic for a given date. What drifts is **which elements are
measured**. `CalendarTimeGrid` scrolls its body to the current time on mount,
and `audit.ts` skips any element more than half hidden by a clipping ancestor
(`isClippedAway`, and rightly — a row scrolled past the edge is not being looked
at by anyone). So the audited set is a function of the scroll position, the
scroll position is a function of the clock, and a real defect at 08:00 is
invisible at 15:00.

*Fix, once, where it belongs.* The defect itself was fixed at the level that
makes it unrepresentable rather than merely rarer — the block drops its clock
below a threshold instead of clipping it — because a defect that can only be
observed at certain hours cannot be closed by „the last run was green".

*Tell, for the next instance:* an instrument is not deterministic merely because
its subject is. Ask what decides its COVERAGE, not just its verdict — a
scroller scrolled to „now", a list paged by a date, a fan-out over „whatever is
first in the DOM" all make the sample move while the code stands still. The
symptom is the one that is easiest to mis-read: a finding that appears and
disappears looks like flakiness in the thing being measured, and the honest
reading is that the instrument looked somewhere else. This generalises past
photography: every sweep, audit and smoke run in this repository should be able
to say what it looked at, not only what it found.

*A second instance, the same day.* The sweep's write pass — the one that types
into a create form and submits it — never set a window size. It inherited
whatever the size loop above had last left, which, because `wide` is last in
`SHOT_SIZES`, was 1600px forever, by accident. Every full run therefore
exercised NOTE at a width where its organizer sits in the grid; the first
PARTIAL run pinned `default`, the organizer was a closed drawer, and NOTE's only
`<form>` went with it. The pass reported no create form on a surface every
previous run had photographed, with nothing about the app changed. It had simply
never declared the one precondition it depended on. Fixed by pinning the
geometry and saying why in the code. **Ambient state inherited from iteration
order is still ambient state** — and a filtered run is the cheapest way to find
out that a pass has been passing for a reason nobody chose.

**DC-100 — A timeout charged to a shared worker's LIFETIME fails whichever
request happens to be in flight, and names the wrong subject (2026-09-02).** The
`database` job went red twice in three days on two unrelated assertions —
„neither endpoint is callable from a browsing context" on one run, „an oversized
body is refused before it is parsed" on the next, with a green run between them
— each a `504 !== 400`, each at almost exactly 150 000 ms. Neither failure was
about the endpoint in its message. `supabase/config.toml` never declared
`[edge_runtime]`, so the local stack ran the CLI's default policy `per_worker`,
which keeps ONE user worker alive across requests; the edge runtime's 150-second
wall clock is charged to that worker, not to the request, so it counts the
worker's whole lifetime. The live suite runs about 160 seconds. The worker was
torn down mid-suite and whatever call was open at that instant returned 504.

*Fix, once, where it belongs.* `policy = "oneshot"` — a fresh worker per
request, so no lifetime accumulates and the 150 seconds are always the request's
own. The cost is a cold start per call, which this suite should want anyway:
each test then meets the function in the state a deployment does.

*Tell, for the next instance:* **a retry would also have made it green, and that
is what makes a retry the wrong fix.** The sentence „this test proves the
function refuses an oversized body" would have been false whenever the clock ran
out, and silently. When a failure names a different subject each time it
appears, and the same NUMBER each time — a round timeout, a fixed byte count, a
pool size — the number is the finding and the subject is noise. Look for the
resource the number belongs to, and ask whether its budget is charged per
request or per lifetime; a per-lifetime budget on a shared thing always fails a
victim chosen at random.

**DC-101 — A poll that runs its first probe before the change it is waiting for
can succeed on the STALE value, and a stale success is worse than a timeout
(2026-09-02).** The sweep's `OPEN_CREATE_FORM` walks a path of clicks and then
looks for the button it came to press. Its `waitFor` calls the finder BEFORE it
awaits a frame — right when the thing is already there, wrong the instant a
click precedes it, because the DOM it reads is the one the click has not been
applied to yet. On TASK the path selected a different scope, the pre-commit DOM
still held the previous scope's „Nova sekcija", and the probe pressed a button
React was about to unmount. The handler ran and opened the section editor; the
render that followed drew a scope in which that editor does not exist. The
report said the button opened no form, which is precisely what a broken button
looks like.

*Fix, once, where it belongs.* One commit boundary — `await frame()` — after
every click in the path, in the helper rather than in the four scenes that
happen to have a path, so the next lookup always runs against a DOM the click is
in.

*Tell, for the next instance:* a retry loop's contract is „wait until true", and
the first iteration of nearly every one ever written silently also means „or if
it is true already". After a mutation that is the wrong question — the loop can
return the very value it was written to wait for the disappearance of. Any poll
placed after an action needs one settle before its first read. Note the shape of
the report too: it accused the SUBJECT of a fault in the INSTRUMENT's timing,
the same inversion as DC-99 one layer down.

**DC-102 — A visibility guard on the target but not on the control that reveals
it (2026-09-02).** The sweep's write probe looks for the first visible text
field inside a form; finding none, it presses the first button whose label opens
with a Serbian create verb and looks again. The field test measured a box
(`getBoundingClientRect`); the button test measured only text. NOTE's organizer
stays MOUNTED when it is a closed drawer under 1345px — the rule that puts it
away is `display: none`, not an unmount — and it precedes the list pane in
document order, so the „first" create button was „Nova fascikla" inside a drawer
nobody can see. The probe pressed it, a form mounted with a zero-sized box, and
the module was reported as having no create form at all.

*Fix, once, where it belongs.* One `onScreen` predicate, used for the field and
for the opener. They were always the same question — „can a person act on this"
— asked of two nodes, and only one of the two was being asked it.

*Tell, for the next instance:* when a guard is written for one half of an
interaction, ask what the other half is guarded by; „it is the same check" is an
argument for sharing the predicate, never for omitting it. And `querySelectorAll`
answers about the DOM, not about the page — a `display: none` subtree still has
elements, still has text, still has handlers, and still answers a click. Any
code that takes „the first X" and acts on it is choosing from a set that
includes everything hidden.

**DC-103 — A class chosen for how something LOOKS is not a name for what it IS,
and selecting by it selects everything that looks the same (2026-09-02).**
`.tasks__rail-list` is worn by both kinds of row in TASK's rail: the five
Pregledi, which are queries, and the real lists, which are places. That is
correct as styling — to the eye and to the stylesheet they are one object — and
wrong as identity. A scene that needed „a list" wrote the short selector, got
„Danas", and so selected a smart view: the one state in which the button it had
come to press is not drawn.

*Fix, once, where it belongs.* Scope the selector to the structure that
distinguishes them — `.tasks__rail > .tasks__rail-row .tasks__rail-list`, since
the smart rows live inside `.tasks__rail-views` — rather than to the class they
share.

*Tell, for the next instance:* a BEM class names a block's PART, not that part's
ROLE, and two things with the same part name are the same shape rather than the
same thing. Before selecting by a class, ask what else in the tree wears it; if
the answer is „something that looks identical and behaves differently", the
class is the wrong handle and the structure or a `data-*` is the right one. The
tell is a selector that reads like a noun from the domain („the list", „the
card", „the row") — domain nouns are exactly what stylesheets do not encode.

**DC-104 — When only one half of a paired mark is on the keyboard, the half
that is gets typed, and the escape it needs makes it look deliberate
(2026-09-03).** Serbian quotes a word as „ovako“ — U+201E opening, U+201C
closing. Nothing on a keyboard produces the pair, so the copy was written with
the opening mark pasted and the closing one typed as an ordinary `"`; inside a
double-quoted TypeScript literal that has to be escaped, and `„1:45\"` reads
like somebody meant it. **172 of roughly 375 quoted phrases in the shipped copy
closed with the wrong glyph** — more than a third, across 29 files, in several
places both forms inside one sentence. Every one of them typechecks, lints,
passes `check:address`, is valid Serbian, and photographs as a quotation mark of
some kind.

*Fix, once, where it belongs.* A rewrite of all 172, and `check:quotes` — the
seventeenth gate, and the sixteenth class in this file to become executable. It
is a PAIRING rule rather than a ban, which is the part worth copying: a lone `"`
or `”` is never a finding, so `pro/tekst.ts` keeps its table of quote pairs and
an English quotation in a test stays English, with **no exemption list** — and a
rule with no exemption list has nothing anybody can widen. It also declines to
report an UNCLOSED „, because the copy is hand-wrapped near 100 columns and a
quotation routinely opens in one literal and closes in the next; it carries the
open state across a `+` and a `${…}` instead, which is where most of the real
ones were.

*Tell, for the next instance:* ask which half of a paired notation the tooling
makes easy. Anywhere the answer is „one of them", the other half is a guess the
author had to remember, and a third of the instances is what remembering is
worth. It generalises past quotes — en dash against em dash, the apostrophe
against the right single quote, a non-ASCII bracket pair — and the tell is
always the same: the wrong half needs an ESCAPE or a compose key, and the escape
is what makes a review read it as intentional. Also worth keeping: the gate that
found the last three was the gate's own TEST. `joins()` matched a bare „+" while
a concatenation's gap carries the two literals' delimiters as well, so it saw no
`+` chain anywhere and reported the tree clean — green for a reason nobody chose,
until a test built the shape by hand.

**DC-105 — A field nobody thinks of as input gets the check that asks whether
it exists, and the call then LOOKS validated (2026-09-03).** An identifier is
opaque, the app minted it, and it is „just a key“, so at both of this product's
trust boundaries every id was `nonEmptyStr(raw.profileId, "profileId")` in the
archive reader and `asNonEmptyString(payload.id, "id")` on the IPC wire. Neither
caps anything, and nothing downstream does either: every store writes through
prepared statements rather than through its own validators, and **no migration
CHECKs an id column past `NOT NULL`**. So the reader was the only bound between
an archive file and the database, the wire the only bound between a compromised
renderer and the same place, and a ten-megabyte `profileId` was a row that
landed, that every later query carried, and that no screen could draw. **784
call sites** — 146 in `importArchive.ts`, 638 in `main/index.ts`.

*Root cause, stated as the rule that was wrong:* „validated" was being read as a
property of the CALL rather than of the value. The call names the field, throws a
typed error, and reads like every other check beside it; what it does not do is
answer a question about the value. That is why review passes it — there is
nothing missing to see. Contrast a field with no check at all, which is visible
as an absence.

*Fix, once, where it belongs.* One constant (`MAX_ID_LENGTH`, `core/src/ids.ts`
— ELEC's `MAX_ELEC_ID_LENGTH` was the same arithmetic under a local name and is
gone), one helper per boundary asking the same three questions (non-empty, no
outer whitespace, inside the bound), and `check:ids` — the eighteenth gate, the
seventeenth class here to become executable, and the first that reads the **AST**
rather than the text. That last part is not fastidiousness: 69 of the 784 were
`asNonEmptyString(asRecord(payload).profileId, …)`, where „everything up to the
last comma“ stops being decidable without a parser, and a text rule would also
have fired on the gate's own documentation of the defect.

*The second shape, found by looking again with the rule in hand.* The same
reader validated an attachment's `fileName`, `mime` and `sha256` with the same
bare helper — while `sha256Hex`, exactly the right check, was already in the file
and used two functions away. `RestoreStore` bypasses `NoteAttachmentStore.add`,
so the store's rules reached an archive only if the reader restated them; the
file name is the one that bites, because it is what the app offers as a download
name, so a `..\` in it is a traversal the archive proposed and the user accepted.

*Tell, for the next instance:* find every value the code treats as OPAQUE — ids,
keys, hashes, file names, refs — and ask what bounds it. If the answer is „the
column“, read the migration; „the store“ is only an answer where the restore
path goes through the store, and it does not. Opaque is a statement about what
WE do with a value, never about where it came from.

---

**DC-106 — A warning whose threshold is also the bound applied to the value it
warns about is structurally always false, and nothing about it looks wrong
(2026-09-03).** ADR-085's E5 bench reports one thing a static rule cannot: that
a line is above the board's rated logic level *at this tick*, which only exists
as a question because the value moves. The first version took a volts channel's
ceiling from `board.logicVolts` and then set the flag when the value exceeded
`board.logicVolts`. Two facts about the data closed the gap: `validateComponent`
REQUIRES `logicVolts` on every board, and **no peripheral in the catalogue
declares `Pin.volts` at all** — the field is optional precisely because breakout
boards do not commit to a level. So every analogue channel would have been
clamped to exactly the number it was compared against, and the flag could not
have fired on any circuit anybody can build.

*Root cause, stated as the rule that was wrong:* the ceiling and the threshold
were taken from the same fact because they were both „about the board", when
they answer different questions — how high the line can GO is decided by
whichever end DRIVES it, and how high it may go before it is a fault is decided
by the end that READS it. Conflating them is easy precisely where a single tidy
number is available for both.

*Why nothing catches it.* The flag is well-typed, it is exercised by tests (the
tests assert `false`, which is what it correctly returns for every input they
give it), it is rendered by a real branch with real CSS behind it, and the code
reads as a considered comparison. It is not dead code by any structural
definition — the branch is reachable, the boolean is just constant. Coverage is
100 % and says nothing. It was caught here only because the ranges were
re-derived by hand against the actual catalogue rather than against the type,
and the catalogue is where „no peripheral states a level" lives.

*Fix:* take the bound and the threshold from different ends of the wire, on
purpose and with the reason written down beside them, and put the reachable case
in a test that asserts `true` — a 3V3 board with an analogue sensor on it. **A
warning with no test that makes it fire is a warning nobody has checked exists.**

*No gate, and this one is honest about why.* „This boolean is structurally
constant" needs value-range reasoning across a data file, which no text or AST
rule here can do. The check is a habit instead: for every flag you derive, name
the input that makes it TRUE and then go and find one in the real data.

*Tell, for the next instance:* any comparison where the same expression appears
on both sides of the pipeline — as a clamp somewhere upstream and as a
threshold here. Also any warning added in the same commit as the range it is
measured against, which is when one number is most tempting to use twice.

**DC-107 — A rule the shared component already got right is not inherited by a
bespoke drawing beside it, and the drawing looks finished (2026-09-03).** E5's
per-channel waveform preview maps a value onto a 24-unit-tall `viewBox` and
strokes it as a `<polyline>`. A value at the floor of its range therefore landed
on y = 24 — the boundary — where an `<svg>` clips the half of the stroke that
falls outside it, and the one pixel that survives sits directly on the
container's own border. Every channel opens AT REST, and rest is the floor, so
the first thing the user saw of every preview was an empty box with a slightly
thick bottom edge. On a square wave it was worse in a way that is harder to
name: the top rail drew at full stroke width and the bottom rail at half, so the
shape was drawn asymmetrically and nothing on screen said why.

*Root cause, stated as the rule that was wrong:* the band the plot may occupy
was taken to be the box. It is not — a stroked line is centred on its
coordinate, so the band is the box inset by half a stroke, and by more than that
when the box has a border the eye can mistake the line for.

*Blast radius, and the part worth keeping:* every other plot in this tree
already knew. `packages/ui`'s `SeriesPlot` has `PAD_Y = 6` and a comment about
ticks hanging half a line outside the box; `FitMeasurements` has `CHART_PAD = 6`
on both axes. The rule was neither new nor forgotten — it had been written down
twice and then not carried into the third drawing, because the third drawing was
small enough to write by hand. **The defect is not a missing constant; it is
that a new bespoke SVG starts from an empty file instead of from the one place
that already answers this.**

*Fix:* `SIM_PREVIEW_PAD`, with the value axis mapped into `[PAD, HEIGHT - PAD]`
and the time axis deliberately left running edge to edge, because that window
wraps rather than ending and insetting it would draw a gap that is not there.
The test names the invariant rather than the number: no sample, for any value
including ones outside the channel's range, lands outside the band.

*No gate, for DC-106's reason.* Deciding which numeric constants in a component
are coordinates, and which of those can reach an edge, is value-range reasoning
over arbitrary arithmetic. The tell is cheap instead: **any new `<svg>` that is
not a `ChartFrame`.** Ask what its extreme values draw as before asking whether
it looks right — at rest, it will look right.

**DC-108 — A picture of a value and the value itself, computed by two different
calls (2026-09-03).** E5's channel row draws a waveform strip and prints the
number the channel carries, side by side, twelve pixels apart. The strip called
`waveAt` — the declared shape — and the readout called `quantize(channel,
waveAt(…))` — what the pin can actually hold. On a `percent` or `volts` channel
those agree to a hundredth and nobody would ever know. On a DIGITAL channel they
do not: a declared ramp drew a smooth diagonal while the number beside it jumped
0 → 1, so the instrument showed a quantity the hardware does not have, in the
same row as the one it does.

*Root cause, stated as the rule that was wrong:* the strip was treated as a
picture of the WAVE and the readout as a picture of the CHANNEL, when the user
reads both as pictures of the same line. Two consumers of one quantity had two
paths to it, and the second path had a rule on it.

*Why nothing catches it.* Both calls are correct in isolation and both are
tested. There is no type error — `waveAt` returns a number and so does
`channelValueAt`. The disagreement only exists for one of three units, and only
for a shape a user has to go and pick; every screenshot in the sweep before this
one showed a constant, where the two paths agree exactly. Coverage says nothing:
the branch that disagrees is the branch that is drawn correctly.

*Fix:* `channelValueAt(channel, wave, ms)` — one closed form, quantization
included — with `simulateFrame` and the preview both going through it, and
`waveAt` dropped from the package barrel so a caller cannot reach the raw value
by accident. The strip now draws a digital ramp as the staircase it is, which is
a truer picture AND a more useful one: it tells the user, at the moment they
pick the shape, what their own pin will do with it.

*No gate.* „These two expressions should be the same call" is a semantic
judgement about intent. The tell is cheap and worth keeping: **any drawing whose
number appears somewhere else on the same row.** Ask which call each of them
made, and if the answer is two calls, make it one — the divergence will be in
whichever case you have not photographed.

*Family.* [[DC-107]] is the same afternoon and the same surface, and the two are
worth reading together: there, a drawing re-derived GEOMETRY the shared chart
already owned; here, a drawing re-derived a VALUE the model already owned. A
bespoke visualisation is where both classes live, because it is the one place
that gets written from scratch beside code that has already answered the
question.

**DC-109 — A hand-kept list mirroring a generated one guards against the wrong
failure (2026-09-04).** The Makefile's `GATES` named the static gates for `make
verify`, written by hand with a comment saying why: a RENAMED gate would then
break here loudly instead of dropping out of the loop in silence. Sound
argument, wrong failure. The thing that actually happens to a gate list is that
a gate is ADDED — `check:address`, `check:quotes`, `check:elec`,
`check:controls` and `check:ids` all went into `package.json` and into `ci.yml`
and never into the Makefile — so `make verify` ran thirteen of eighteen and
reported „all 13 static gates are green“, a true sentence about the wrong set.

*Root cause, stated as the rule that was wrong:* the list was defended against
the failure that is loud (a rename breaks the pnpm script and every caller at
once) and left open to the one that is silent (an addition breaks nothing).
When two lists must agree and only one of them is authoritative, hand-keeping
the copy protects nothing it was not already protected from.

*Why nothing catches it.* Both lists are valid, both run green, and the
under-running one PRINTS ITS OWN COUNT — which is what let it survive: the
message was `all $(words $(GATES)) static gates are green`, so it was derived,
accurate, and describing the wrong universe. CI is unaffected, because CI reads
the other list.

*Fix:* derive it — `$(shell node -p "… scripts … startsWith('check:') …")`, the
way `VERSION` two lines above it was already derived from the manifest. That
keeps the rename safe too, because the names now ARE the script names. And the
recipe refuses an empty derivation, since „all 0 gates are green“ would be the
same defect wearing a new mechanism.

*The tell, which generalises past make:* **a list written down beside a list
that could be read.** Ask which one a new entry gets added to first. If the
answer is „the other one“, the copy is already stale or shortly will be.

**DC-110 — A narrowing config key that REPLACES the list it appears to refine
(2026-09-04).** `electron-builder.yml` excluded seven of the native module's
eight prebuilds by adding a `files:` under `win:` and under `linux:`, on the
reading that a platform section refines the top-level one. It does not: a
platform `files` REPLACES the root `files` outright, so the four entries above
it — `out/**/*`, `package.json`, the two icons — stopped applying and
electron-builder fell back to its `**/*` default. The build succeeded, printed
nothing unusual, and produced a **388 MB** installer instead of a 169 MB one,
carrying the whole source tree and every devDependency inside the asar.

*Root cause, stated as the rule that was wrong:* „platform-specific options are
merged with the general ones“ was assumed from how the rest of the file behaves
(`win.icon` genuinely does refine) and applied to a key whose type is an array.
For a scalar, override and merge are the same thing; for an array they are
opposites, and the config format does not distinguish them.

*Why nothing catches it.* There is no schema error — the key is valid in that
position. The build produces a working app, so a smoke test passes. The only
signal is the artifact's size, and nothing was reading it.

*Fix:* one list, with the platform variance expressed by electron-builder's own
`${platform}`/`${arch}` macros inside the pattern rather than by a second list.
Verified in both directions — the deliberately inverted probe excluded exactly
`win32-x64.node`, which is what proved the macros expand in `files` at all.

*The tell:* **an array-valued key that also exists on a narrower scope.** Before
using the narrower one, package the thing and read what came out.

**DC-111 — The last build stage produces the only artifact nobody reads back
(2026-09-04).** Found while fixing [[DC-110]], and the more useful half of it.
`smoke` proves the app runs — against `out/`, which is not what ships. Between
`out/` and the installer sits electron-builder, whose `files` globs decide
whether the SQLite binary is in the package at all, and nothing in this repo had
ever opened the result. An app packaged with no binary starts, paints its unlock
screen, and throws at the first query; `pnpm test`, `pnpm build` and a
`SMOKE OK` are all completely silent about it, because none of them touches the
package.

*Root cause, stated as the rule that was wrong:* the verification set was built
around what the code does, and stopped at the last stage that has source in it.
Packaging was treated as transport rather than as a transformation with its own
failure modes.

*Fix, and it is now executable:* `dist.mjs` reads
`release/<unpacked>/resources/app.asar.unpacked/…/prebuilds/` after
electron-builder returns and refuses a build whose contents are not exactly the
target's one binary. It is a gate in the only place it can be — the check needs
the artifact, so it lives at the end of the script that makes one, not in
`scripts/`.

*The tell:* **the last step of a pipeline whose output no test opens.** Ask what
the final artifact would have to be missing for every green check to stay green.

**DC-112 — A shared config outside every package invalidates no cache, so the
tool replays a result computed against the version that no longer exists
(2026-09-06).** Turborepo hashes a task's own package. `tsconfig.base.json` sits
at the repository root, outside all fifteen of them, and every one of them
`extends` it — so adding `"types": []` to the shared compiler options re-ran
ONE of thirteen `typecheck` tasks and replayed twelve from cache. The run
reported **13/13 green**, and twelve of those ticks were about a compiler
configuration that had ceased to exist. Had the change been a bad one, the
first machine to find out would have been a cold CI runner, or nobody.

*Root cause, stated as the rule that was wrong:* „configuration is hashed with
the code it configures“. It is hashed with the code it SITS WITH, which for
shared configuration is nothing. The failure is not that the cache was wrong —
caches are allowed to be stale. It is that staleness is reported in the same
colour as correctness, so there is no signal to act on.

*Blast radius:* this is the second instance, and the first one was fixed
without being named. `turbo.json` has listed `eslint.config.mjs` in
`globalDependencies` since a rule change replayed instead of re-linting — the
comment above it even states the rule in general terms, and then applies it to
exactly one file. Every root-level file a task reads is in the class:
`tsconfig.base.json` (all thirteen `typecheck`s, all four `build`s), and
whatever shared config is added next.

*Fix, and it is derived rather than restated:* the missing file is now listed,
and `scripts/root-config.test.mjs` computes the list from the tree — every
`extends` in every package tsconfig that resolves OUTSIDE its own package must
appear in `globalDependencies`. A hand-kept list would have been [[DC-109]]
again. Its blind spot is stated in the test rather than left to be discovered:
a config reached by DISCOVERY instead of by reference (`eslint.config.mjs`, which
ESLint finds by walking up) cannot be derived, so it is pinned by a second
assertion that the list never shrinks.

*The tell:* **a file that changes behaviour for N packages and lives in none of
them.** For each one, ask what the build tool would have to notice for a change
to it to be seen — and if the answer is „nothing“, the green tick after editing
it is measuring the previous edit.

*Related:* [[DC-109]] (the hand-kept list), [[DC-01]] (a gate that silently
covers nothing still reports success — same disease, one layer down: here it is
the CACHE that covers nothing).

**DC-113 — A shared typographic TIER, retyped at every call site: every copy
uses tokens, every copy is locally correct, and only counting them shows
anything (2026-09-07).** [[DC-02]] one tier below the eyebrow, and the reason
it is a separate class is that the eyebrow's damage was visible in one rule
while this one's is visible only in the aggregate. `.nx-hint` — the app's
explanation paragraph — did not exist. Thirty-three classes across fifteen
stylesheets wrote out the same five declarations by hand. Each of them passes
`check:colours` (tokens throughout), passes `check:tokens` (every `var()`
resolves), typechecks, lints, and photographs correctly. By the time it was
measured the tier had drifted four ways: **four leadings** for one tier (17 of
29 rules set none, 4 snug, 6 normal, 2 loose), **three measures** (5 at
`--nx-layout-prose`, 2 at a literal `64ch` where the token says 68, the rest
uncapped), and **forty-eight paragraphs** on `.app__muted` whose class never
reset `margin`, so they carried the user agent's 1em block margins while their
neighbours did not.

*Root cause, stated as the rule that was wrong:* „a value is correct if it is a
token“. Tokens make each declaration correct; they say nothing about whether a
declaration should have been written at all. The unit of reuse is the TIER, not
the value — and a design system that ships only values has left the tier to be
remembered.

*Blast radius:* the tier itself, everywhere it is set — 659 call sites over 65
files, including two hand-copies inside `packages/ui`, the package that owns
tiers (`PageHeader`'s subtitle and `EmptyState`'s inline variant). Two more
tiers are in the same class and are NOT fixed, recorded rather than half-done:
**19 rules that set explanation prose at 11px** (the caption size — the
settings page's own note says why that is wrong, „prose set in it is not READ,
it is skipped"), and **65 uppercase-label rules** that hand-write the eyebrow
tier across three inks (`--nx-text-subtle` 36×, `--nx-text-muted` 17×,
`--nx-text-faint` 1×) where `.nx-eyebrow` names one.

*Fix:* the tier is declared once and adopted. A surface needing looser prose
adds `.nx-hint--prose`; a surface with a real extra — a widget's own inset, a
gap above a status line — keeps its class for that extra and nothing else.

*What made it gateable, when the eyebrow's equivalent still is not.* The
signature is not sufficient: a disclosure BUTTON borrows the same ink and size
on purpose (`.tasks__archive-toggle` at the time, `.nx-disclosure` since
[[DC-114]] folded the four copies into one), and a `<span>` carrying a
timestamp borrows them too. A rule fired on those earns an allowlist within a
month, and an allowlist is how a gate stops being read. **The discriminator was
not in the stylesheet at all — it was the ELEMENT.** A class whose every call
site is a `<p>` is a paragraph tier, whatever it is named, and that pairing
needs no exemptions. `check:tiers` therefore reads both sides, CSS and TSX, and
fires only where they agree. The general form is worth keeping: *when a
signature over one artifact is ambiguous, the disambiguator is often in a
second artifact that nobody thought to read.*

*Its own tests then found three defects in it,* which is the argument for a
gate having tests at all rather than only a green run: every finding's line
number pointed at the top of the comment above the rule (the rule regex's
`[^{}]+` swallows blank lines back to the previous `}`); `border-color:
var(--nx-text-muted)` contains the ink test as a substring; and the element
scan ended at the first `>`, which in real markup is the arrow in
`onChange={(event) => …}` — so a class written after its handler was invisible.
That last one is [[DC-39]]'s family from the other direction (there an
unanchored pattern reached far past the construct; here it stopped short of it,
because the language's boundary is not the character the regex was told to stop
at) and it was `check:controls`'s already-solved bug, so the scanner moved to
`scripts/jsx-elements.mjs` and both gates adopted it — [[DC-02]] applied to the
tooling rather than to the product.

*The tell:* **a set of rules that are each unarguable and collectively a
system.** When a review can find nothing wrong with any single instance, stop
reviewing instances and count them.

*Related:* [[DC-02]] (the eyebrow tier — the same class, one tier up),
[[DC-01]] (a rule that covers nothing reports success; here every gate the
repo had covered these rules and passed them all).

**DC-114 — „Summary before detail" applied without MEASURING the summary: a
landing that photographs perfectly while showing none of its own subject
(2026-09-07).** Five module landings drew a stat row, a full-width graphic, a
three-line caption and a legend above the list. Each was a correct application
of a real rule, and the sum of them at the enforced 900 x 600 floor — and at the
1120 x 720 the app opens at — was a notes page with no note on it, a task page
with no task, UČENJE with no subject and NAVIKE with no habit.

*Root cause, stated as the rule that was wrong:* „the summary comes first" is a
rule about ORDER that was used as if it were a rule about SPACE. Order is free;
space is not, and nothing in the rule says what happens when the summary is
five hundred pixels tall in a five hundred and sixty pixel window. A design
rule that names a sequence and not a budget has left the budget to be noticed.

*Why nothing could see it.* The screenshot sweep had photographed it every run
since the bands were added. Nothing is clipped, nothing escapes its parent,
nothing overlaps, no target is small — **every geometric rule passes on a page
that is not showing its own subject.** That is the general shape worth keeping:
*a defect can be invisible to an instrument not because the instrument is weak
but because the property is not geometric at all.* „The notes are the point of
the notes page" is not a fact about any rectangle.

*Blast radius:* every landing that puts a graphic above its content. Four had
the defect (NOTE, TASK, NAVIKE, UČENJE); DOKUMENTI has the same SHAPE — band,
`FileSpace` proportion bars, caption, then the list — and is unmeasured, because
the sweep's profile has no attachments (recorded in `STATUS.md`). FOKUS has the
shape inverted and was already right, which is what establishes the rule as the
app's own rather than an import.

*Fix:* the graphic folds, **closed by default**. The direction is the whole fix
— a disclosure defaulting open reproduces the defect for everyone who never
touches it, which is most people. The choice persists (`overviewPrefs.ts`), so
the cost to a reader who wants the picture is one click ever rather than one per
visit.

*What made it enforceable, and why it is not a `check:` script.* The rule needs
a rendered page and a window size, so it lives in `shots/audit.ts` as
`below-fold` over a `data-nx-content` marker. **Intent has to be stated,
because geometry does not carry it** — the same admission `OVERLAY_SELECTOR`
already makes in that file, moved to a better place: the element itself, in the
file that renders it, rather than a selector list a new surface has to be added
to by somebody who knows the list exists.

*And the first version of the rule reported its own fix as a defect.* The sweep
after the fold landed named three regions below the fold, and every one of them
was the fold being OPEN — a reader who clicks a triangle has asked for the thing
that pushes the list down. A rule that fires on its own remedy is a rule nobody
reads twice ([[DC-15]]). The guard is a rule and not a list: an expanded control
PRECEDING the region suppresses it, `compareDocumentPosition` separating an
ancestor from a descendant. That separation is load-bearing —
`noteToggle.tsx` renders `aria-expanded={!collapsed}`, **true by default**,
inside a note editor that lives inside `.note`, so a document-wide test would
have silenced the rule on the very page it was written for.

*And the fix took four surfaces out of the sweep.* Folding a graphic that used
to be permanently drawn means nothing photographs it any more. A fix that
quietly stops four surfaces being audited has traded a defect for a blind spot,
so four scenes now open each fold, verify `aria-expanded` rather than clicking
and hoping, and close it again. The general form: *whenever a fix HIDES
something by default, ask what was watching it while it was visible.*

*The tell:* **a page where every element is correctly placed relative to the one
above it, and the reader still has to scroll to find out what the page is.**
Read the first screen, not the DOM.

*Related:* [[DC-113]] (the shared `Disclosure` this needed came out of the same
pass), [[DC-15]] (a warning nobody reads — here a finding nobody would),
[[DC-74]] (a frame filed under a name that says something the run did not
establish; the four `*-overview` scenes verify `aria-expanded` for that reason),
[[DC-01]] (a rule that covers nothing reports success — which is exactly what a
zero-finding sweep looks like, and why the 6 and 14 findings of the two earlier
runs are written down as the negative control).

**DC-115 — a ladder that exists only in prose: seven z-index values, each
chosen at its own call site, and five comments keeping the order in step by
hand (2026-09-07).** Twenty-two `z-index` declarations across eleven files. `1`
meant „a header pinned over its rows" in seven places and „the lower of two
pinned ranks" in an eighth; `2` meant „the ghost being dragged" in two files
and „a pinned header" in two others. The app had a stacking order and it was
written down nowhere.

*Root cause, as the rule that was wrong:* a stacking order is a property of the
WHOLE document — the language says so, since two positioned boxes in one
stacking context are ranked against each other whatever files they were written
in — and it was being decided one file at a time. Every other cross-cutting
value in this app had already been through this ([[DC-113]] for a type tier,
the `layout` token group for rail widths); stacking was the axis nobody
converted, because it is invisible until two boxes actually meet.

*Why nothing could see it.* Every value is a valid integer. `check:colours` and
`check:tokens` have no opinion on a number. And the screenshot sweep — the one
instrument that looks at rendered pixels — **photographs a correct order and an
accidental one identically**, because the two only differ where two layers
overlap, which on most frames they never do. Same shape as [[DC-114]] from the
other side: there the property was not geometric, here it is geometric but only
on the frames nobody has.

*The tell, and it is a documentation smell rather than a code one:* **a comment
that restates a global ordering.** Five in `notes.css` alone listed the whole
ladder — „over `.note__find`'s sticky 3 and under every portalled panel
(50–70)". A comment that has to name four other files' values is doing a type
system's job in prose, and prose is the one artifact in the tree that nothing
can contradict. Both failure modes duly followed: one comment still cited a
layer `40` that nothing had carried for months, and one described a hazard that
had NEVER been real (see [[DC-116]]).

*Fix:* `--nx-layer-*`, from `under` to `menu`, adopted at all twenty-two sites,
every swap value-identical so nothing rendered differently. Two names may
resolve to the same number on purpose — a pinned header and a figure over its
ground are both 1 — because **a token names an intent**, and moving one intent
later must not silently drag the other with it.

*What made the gate exemption-free, which is the part worth reusing.* The
tempting rule is „a positive z-index must be a token", with `0`, `-1` and
`auto` carved out as special cases. Instead the scale itself was given names
for those two (`ground`, `under`), after which the rule is simply „every
z-index is `auto` or one `var(--nx-layer-*)`" and **there is nothing left over
to exempt**. Widening the vocabulary removed the need for a list; an allowlist
is how a gate stops being read, so the cheapest allowlist is the one the design
makes unnecessary.

*And it checks the scale, not only the spelling.* All twenty-two call sites
would go on passing if `dialog` were edited to sit under `drawer` — the sites
name layers, so they cannot notice the layers moving. The declaration order in
`global.json` IS the stacking order, so it is asserted to be strictly
increasing: the file states the ladder and is checked against itself.

*Related:* [[DC-113]] (the same shape one axis over — a shared value retyped at
every call site, invisible because each copy is locally correct), [[DC-116]]
(the false hazard this uncovered), [[DC-01]] (a rule that covers nothing
reports success — this gate went green on its first run, which is why its
tests exist to show it FIRING).

**DC-116 — a stacking claim written from the COMPONENT tree, describing a
document that does not exist (2026-09-07).** `notes.css` carried a documented,
carefully hedged hazard for a month: that the three typed-name confirmations
`NoteOrganizer` renders would be trapped in the organiser drawer's stacking
context (5) instead of reaching the dialog layer (60). It was never true.

*Root cause:* the reasoning read the JSX, where `<TypedConfirmDialog>` does sit
inside the drawer's returned tree — and `createPortal` is precisely the
construct that makes the React tree and the DOM tree disagree about who
contains whom. A stacking context is a DOM relationship. The component tree is
not evidence about it.

*The dates are the finding.* `NoteOrganizer` adopted the portalled
`TypedConfirmDialog` on 2026-08-06 (`30e7b5b`); the hazard was written down on
2026-08-07 (`4be456b`, a commit whose whole purpose was „write down what the
notes drawer's z-index costs"). It was false the day it was authored, by one
day, and then survived a fifteen-file stylesheet split that moved it verbatim.

*Why nothing could see it.* It is a comment. It compiles, it lints, it
photographs as nothing at all, and it is written in the register of somebody
who has thought carefully — which is exactly what stops a reader checking it.
**A hedged, specific, well-argued comment is harder to doubt than a vague
one.** It even ended with the right recommendation („the real answer is a
declared layer scale"), so it read as a known-issue note rather than as a
claim.

*Fix:* the comment now states what is true, including that it was wrong and
why. There is no gate here and the honest reason is that the checkable version
of this rule — „no comment may assert a DOM relationship" — would fire on every
useful comment in the tree. What replaces it is structural rather than
enforced: with [[DC-115]]'s scale in place, a comment that needs to restate the
ladder has nothing left to say, so the genre this defect lived in is mostly
gone.

*The tell:* **a comment that reasons about the DOM from a file that cannot see
it.** A stylesheet arguing about what React renders inside what, or a component
arguing about what a stylesheet stacks above what, is a claim nobody re-derived
— check it against the actual `createPortal` calls before trusting it.

*Related:* [[DC-115]] (the pass that found it), [[DC-74]] (an artifact filed
under a name that says more than the run established).

**DC-117 — a document stating a fact the test suite already asserts the
NEGATION of, green, on every run (2026-09-07).** `STATUS.md` carried
„`cents-ratio` (muzika) is registered in the catalogue with no screen" under a
heading reading „Known single loose end in a shipped module", and `roadmap.md`
repeated it. The tool was built on 2026-08-14 (`2aad366`), three and a half
weeks earlier, complete with strings, a registry entry, and a source comment
recording exactly why it kept its own screen.

*Root cause, and it is not „somebody forgot to update the doc":* the same
sentence that made the item trackable also made it checkable, and nothing
joined the two. The STATUS bullet even NAMED its own contradiction:
„`modules.test.ts` asserts the two sets are equal, so it must be built or
de-registered".
That test has been passing ever since. **The document cited the assertion that
falsifies it.**

*Why nothing could see it.* The test suite has no reader that is also a reader
of prose, and prose has no reader at all. Every gate here checks code against
code; `docs/` is deliberately outside every walk (it is private and gitignored),
so the one artifact the founder actually reads is the one artifact nothing
verifies. A stale code comment ([[DC-116]]) misleads whoever opens that file. A
stale STATUS misleads the person deciding what to work on next — and it did:
this item sat in the queue as work to do, and the work was already done.

*Blast radius, and it is the useful question:* every STATUS or roadmap claim
of the form „X does not exist yet" where a test asserts X's completeness.
Checked by hand on this pass; `cents-ratio` was the only live one. The two
other „loose end" bullets in that section were already marked CLOSED or fixed
in place, which is what the section is supposed to look like.

*Fix:* the bullets now say what is true, and the §5 question is deleted rather
than answered, because it was answered by building the thing. No gate. The
checkable version — „no sentence in docs/ may contradict a test" — is not a
rule a machine can apply, and `docs/` is outside the tree gates walk by design.
What actually prevents this is the project's own rule, which was simply not
followed: **when a piece of work finishes, its narrative moves to `docs/log/`
and STATUS keeps only what is still true, in the SAME pass.** The tool shipped
in a commit that touched 274 tools; the queue entry for one of them was not
part of that pass.

*The tell:* **a STATUS bullet that names the test which would settle it.** If
the entry can say „`x.test.ts` asserts this", then the entry is not a status,
it is a question with a known answer — go run it. Any open item that cites its
own oracle should be resolved by reading the oracle, not by being re-read.

*Related:* [[DC-116]] (the same shape in a comment, and the same cause — an
assertion nothing re-derives), [[DC-01]] (a rule that covers nothing reports
success; here a rule that DID cover it reported success into a void).

**DC-118 — a test establishing a precondition by ASSERTING through it: the
first request to a lazily-booted service was also a claim about what that
service returns (2026-09-07).** `main` went red on `database` at `196cd9a`, on a
step that had passed on both PRs that produced it and on the merge before.
`device-register.test.mjs`'s `before` hook enables sync for real, and that call
was the FIRST request any Edge Function received in the job: HTTP 503 with an
empty body, `mint failed: ""`, ten cancelled tests. The twenty-four calls after
it all succeeded, including the fourteen in the other suite seconds later.

*Root cause, and it is not „the runtime is flaky“:* the suites treated „a
function can be served“ as an assumption. `config.toml` sets
`policy = "oneshot"`, so the edge runtime builds a worker per request, and the
first one for a given function also fetches its module graph over the network —
unbounded work that has nothing to do with what either suite tests. The race had
been won on every previous run, which is the only reason the assumption looked
like a fact.

*Why the failure named the wrong thing.* A precondition asserted through reports
as whatever it was asserted through. The message said the MINT failed, so the
first three places to look are the function, the migration and the auth server —
none of which had anything to do with it. The cost of this class is diagnosis,
and it is paid in full every time.

*Blast radius.* Both live suites (whichever runs first pays the boot; today
`device-register`, only because `d` sorts before `s`). **And the product:**
`packages/sync-transport` has no 5xx handling and no retry anywhere, so a cold
boot on hosted Supabase reaches the desktop as `refused`, `reason: "unknown"`,
`httpStatus: 503`. Recorded in STATUS rather than fixed, because sync is on hold
by the founder's 2026-08-31 direction and the honest answer to step 4 is that
first-contact latency was never designed for — not that one call site needs a
loop.

*Fix:* `supabase/tests/live/ready.mjs` states the precondition positively —
**the runtime is ready when the FUNCTION answers** — and both `before` hooks open
with it. Deliberately not „retry on 5xx“: a function's own 503 is
`unavailable()`, a server running degraded, which these suites exist to catch.
The probe is a GET carrying the anon key, which every endpoint refuses on its
first line with `bad_request` before reading a header, touching the database or
provisioning anything. It went in the SUITES rather than in `ci.yml` because the
trap is identical for a developer running `pnpm test:live` against a stack they
have just started, and a workflow step would not cover that reading.

*Executable, as a test rather than a gate.* `supabase/tests/static/ready.test.mjs`
drives the helper against a scripted http server — no Docker, so `pnpm test` runs
it — and a further test reads every live suite and requires the wait to be its
`before` hook's first statement. One directory of two files is too small a
reachability set to be worth a twenty-first gate, and `pair-complete` — the third
function, with no live suite yet — is the file that will forget.

*The tell:* **a `before` hook whose first network call is also its first
assertion.** If a suite's setup can fail in a way that names something the suite
is not about, the setup is asserting through a precondition it never
established.

*Also worth keeping:* the discriminator that made a bounded wait safe was a
BODY, not a status. The runtime's 503 is empty; the function's carries
`{"error":"unavailable"}`. A rule written on the status code alone would have
swallowed a real fault — and it passed nine of the eleven tests written for it.
The two that catch it had to be added after a mutation survived.

*Related:* [[DC-01]] (a check that covers nothing reports success), [[DC-117]]
(the previous entry, and the same week: a claim nothing re-derived).

**DC-119 — a lookup table made TOTAL over an enum, where totality was mistaken
for completeness (2026-09-07).** `strings.electronics.sim.units` gave every
`SimUnit` a noun. Two of the three did not need one: `formatSimValue` already
renders „3,3 V“ and „100 %“, so the caption said volts twice — and on the percent
channel it said „radni ciklus“ under a number three rows below the FIELD
„Radni ciklus (%)“, which shows the square wave's own duty. Two different
numbers, both correct, one label, one card.

*Root cause:* `satisfies Record<SimUnit, string>` asks „has every key been filled
in“, which is a question about the TYPE. The question that mattered is „does this
key need a value at all“, which is a question about the formatter — and the type
system's answer looked like the answer to both. A total record is the shape that
makes a missing entry impossible AND an unnecessary one invisible.

*Why nothing else could see it.* Both strings are valid Serbian, tokenised, and
correct in isolation; `check:address` and `check:quotes` pass them, and the sweep
photographs a collision and a legend identically, because both are text in a box.
Only reading the card as a sentence shows it.

*Fix:* `Record<SimUnit, string | null>` — still total, so a new unit must still be
made to choose, but the choice now includes „the number already says it“. The
rule: **the caption names the quantity only when the number cannot.**

*Executable, and the test asks the oracle rather than restating it:* a unit is
captioned exactly when `formatSimValue(unit, 1)` still reads `1`. Iterating the
record iterates every unit, so a new one cannot pass by being forgotten.

*The tell:* **a `Record<SomeEnum, string>` of labels sitting beside a formatter
for the same enum.** Ask, per key, whether the formatted value already carries
the label. Where it does, the label is not redundancy — it is a second name for a
number, and it will eventually be the same name as some other field's.

*Related:* [[DC-113]] (a shared value whose copies were each locally correct),
[[DC-117]] (a statement whose own oracle already answered it).

**DC-120 — a contract decided for one primitive and never carried to its
sibling, plus the class name that lets callers skip the primitive entirely
(2026-09-07).** `Select` exists because an audit found **39 of 74** selects with
no visible label; it takes a REQUIRED `label`, renders it, and `Omit`s
`aria-label` so the escape hatch cannot be reached. Its doc-comment states the
rule in one line: „a control whose only name is invisible is the exact defect
this replaces". `TextField` predates that decision and never received it —
`label` is optional and `aria-label` passes through — so of **143** call sites,
**38** are named invisibly and **14** carry no visible name at any time. Two
adjacent `type="date"` fields in TASK's quick-add render as two identical
`dd-----yyyy` boxes, and CalendarPage's start and end `type="time"` fields are
the same shape.

*Root cause:* the decision was recorded in the component that received it, and
a component's doc-comment is read by whoever opens that component. Nothing
asked the same question of the primitive next to it. **A rule stated inside one
artifact is scoped to that artifact** — which is the same reason the layer
ladder ([[DC-115]]) survived as prose in `notes.css` while eleven other files
picked their own numbers.

*The second half, and the one that makes it structural:* `nx-textfield__input`
is written by hand at **35 call sites outside the component**. Those inputs
wear the component's appearance and answer to no component, so a rule added to
`TextField` reaches five sixths of the app's inputs and misses the rest without
saying so. A shared CLASS is an interface with no compiler behind it — the
opposite of `check:controls`, which exists precisely because a native control
that skips the shared class is invisible, and which does not ask this question.

*Why nothing could see it.* All of it typechecks, lints and passes twenty
gates: `aria-label` is a legitimate attribute, `placeholder` is a legitimate
attribute, and a hand-written `<input>` with the right class is
indistinguishable from the component's output in the DOM. The sweep
photographs a labelled and an unlabelled field identically — both are a box —
so 2 753 frames at zero findings say nothing about it.

*The tell:* **two primitives that do the same job, where only one of them has a
doc-comment arguing about it.** The argument is evidence that somebody thought
about it once; the sibling with no argument is where the same defect is still
representable. Ask the sibling the same question, and ask whether the
primitive's CLASS is reachable without the primitive.

*Fix:* recorded and ordered in STATUS. **Step 1 is closed — all 14, on
2026-09-08 and 09 in `51f95ca`, `340e089` and `20d2fe3`.** Twelve took a name that is drawn:
TASK's „Rok", „Počinje" and its bulk-due field, CAL's date and its
„Od"/„Do" pair, DOKUMENTI's „Ističe", UČENJE's three, and FIT's grams and
muscle fields. Two of those twelve are named by a span that was already on
screen rather than by a label of their own, which is legitimate and is why
`TextField` first gained the `inline` layout `Select` has had for months
(`340e089`) — without it the field and the text naming it did not sit on one
line. The other two of the fourteen were measurement artifacts and not
defects, each with its reason written at the call site: UČENJE's per-weekday
minute boxes sit under a drawn day name and already carry a superset
`aria-label`, and a topic row's field is named by the „TEME" heading it is
filed under, where a per-row label would be noise.

**Step 2 (a name that leaves on the first keystroke) is most of the way
through, worked SURFACE by surface rather than by defect, so every intermediate
commit leaves a form self-consistent.** Closed: CAL, DOKUMENTI, LJUDI, UČENJE
and FIT's routine editor — 61 findings down to 26. Two by-products, both the
usual „fix it once where it belongs" and neither optional: `TextField` gained a
`ref` (React 19's plain prop, to the INPUT), which nine call sites had gone
around it to get, and `TextArea` was written, which seven hand-written
multi-line fields had been standing in for — four of them re-declaring the same
three CSS declarations in four stylesheets.

**The load-bearing distinction, and the reason this cannot be a mechanical
sweep: a label labels, an example demonstrates.** A placeholder that repeats
its own label word for word is the defect; a placeholder that is a WORKED
EXAMPLE — UČENJE's cloze template, a problem card's statement and its steps,
FIT's „npr. Potisak sa klupe uskim hvatom" — is content and stays. UČENJE is
the only surface with instances of both, which is why it is the one that
settled the rule.

**The second rule, which step 2 also had to settle: a field takes a drawn label
when its NEIGHBOURS have one; it takes its POSITION when its neighbours are a
headed list.** That is what rules out eight further findings in TASK — one
`InlineNameForm` standing for new list, rename list, new sub-list, new section,
rename section, new tag, rename tag and save-as-template, every one of them
appearing inside a headed list in the exact place the thing being named will
sit. The same rule is what made CAL's event-template line a real finding: a
naming box on a row of labelled fields.

**A census that counts `aria-label` under-reports, and by a lot.** Eight of
TASK's findings are behind one component that forwards its `label` prop to
`aria-label`; a reader counting call sites sees one. Any future gate over this
class has to resolve the prop, not match the attribute.

**What remained, and how it closed — all of it, on 2026-09-22 (`0ac1a31`,
`951f0e2`).** The last four call sites took the required name and the union that
makes an anonymous field a type error; `check-fields.mjs` became the gate, and it
asks what an element IS rather than what class it wears, because the first version
of the rule („no call site writes `nx-textfield__input`") had two live fields
invisible to it in `noteFindBar`. Its census today: nine bare `<input>` elements
remain outside the primitive and all nine are `radio`/`checkbox`/`range`/`file` —
**no text field is drawn by hand** — and the naming census, re-derived with that
gate's own walker, is 142 visible `label`, 23 `aria-label`, 4 `aria-labelledby`,
**0 unnamed**. The 23 are not leftovers: seven search boxes, two markdown-grid
cells, and the rest headed-list positions and compact inline forms, each with its
reason at the call site — the fourth kind of place a text field arrives in, which
is what `TextField`'s own contract comment said there were three of until it was
counted.

**And this entry's closing line said „what remains: 26 … 22 …" three hours after
all of it had closed.** So did the section in `STATUS.md`, from the same census —
[[DC-117]] exactly, and the second time in one day: **the pass that closes a step
is rarely the pass that wrote the step down**, and both documents had nothing to
notice their own closure with. The recurring shape is worth more than either
instance: a *plan* is prose, its steps are claims about code, and a claim about
code that no instrument reads is the same defect as a stale figure — which is why
the gate here asks the question the census was trying to ask, and why the answer
is now produced by a script rather than by a reader.

*Related:* [[DC-115]] (a rule that lived as prose inside one file while every
other call site chose for itself), [[DC-119]] (the same week, and also a
question the type system answered instead of the one that mattered),
[[DC-122]] (what step 1 exposed: the labels changed a child's HEIGHT, and four
rows had been aligning boxes that until then were all the same size).

**DC-121 — a mitigation that made the remaining call sites invisible: a
fallback rule drawing what the component draws, minus the part that could not
be faked (2026-09-08).** `Select` replaced the native `<select>` for three
reasons — a rendered label, `appearance: none` with a drawn `Icon` in place of
the Windows arrow, and the right-hand padding that reserves room for it. Ten
call sites never adopted it, in five files: six inside `RecurrencePicker`
(shared by the task form and the event form), the dashboard's per-widget count
picker, the private section's auto-lock knob, the CSV importer's per-column role
picker, and the tools drawer's only dropdown. Every one of them rendered the
operating system's grey triangle inside a form whose other controls did not,
and the task form put one directly beside a `Select`.

*Root cause:* not that ten call sites were forgotten. When the component landed,
`packages/ui/styles.css` grew `.nx-app select:not(.nx-select__control)` — a
rule that gave every raw select the component's box, to the pixel, and
DELIBERATELY left the native arrow, because a suppressed arrow with nothing
drawn in its place is a worse defect than the one being fixed. That reasoning
is correct and the rule was the right thing to write. What it also did was
remove every symptom a reader could act on: the ten had a box, they had a name,
they lined up with their neighbours, and the one thing still wrong with them was
a 9x5 triangle that nobody photographs and no gate reads. **A mitigation that
removes the visible half of a defect converts the rest of it into work nobody
will schedule** — the rule's own comment even said „the remaining call sites
move to `Select`“, and it said so for four months.

*Blast radius, and the shape of the fix:* all ten adopted the component. Four
of them were named by text already on screen — a menu label, a settings
heading, a table column — which the component's doc had described as „that call
site's own decision“ while giving it no way to make it. So they had paid for the
CORRECT decision with the OS chevron. `Select`'s props became a union of
`{ label }` and `{ "aria-labelledby" }` with `?: never` on the other arm, which
is the same rule the class started with (a name, and a visible one) with the
second legitimate way of satisfying it now expressible. The fallback rule is
deleted rather than emptied, and `check:controls` — which already refused a
native radio or checkbox that skips the shared CLASS — grew the case where the
replacement is a COMPONENT. Its `ALLOWED` set became a Map from file to the one
native that file may spell, because with two components a file-level pass would
let `Select.tsx` write a bare checkbox.

*Why nothing else could see it.* The gate that exists for exactly this question
did not ask it: `check:controls` was written about a class, and „use the
component“ has no class to look for. It typechecks — a `<select>` is the most
ordinary JSX there is. It declares no colour and no token. And the screenshot
sweep photographs an OS arrow and a drawn one as two arrows: five of the ten
lived in the Prilagođeno editor, which is three steps inside a form the sweep
had never reached, and two more behind a menu that only exists in edit mode.

*The tell:* **a stylesheet rule whose comment names the call sites it is waiting
for.** A rule written as an interim measure is a defect with a date on it, and
the date is never kept. When one is written, the same commit should make the
remaining set finite and checkable — otherwise the mitigation is the last thing
anybody will do about it.

*Fix:* the ten adoptions, the union type, the deleted fallback, `check:controls`
extended — its first rule about a component rather than a class — and three new
sweep scenes so the surfaces are photographed at all: `tasks-recurrence` opens
the Prilagođeno editor, `dashboard-widget-config` enters edit mode and walks the
cards to the first config form with a count field, `settings-priv` scrolls to
the private-notes card.

*Related:* [[DC-120]] (the sibling primitive that never received `Select`'s
contract — the same component, read from the other side), [[DC-57]] (a rule
enforced by photography holds only where the camera goes), [[DC-98]] (the
native control that skips the shared class, which is this class one layer down).

**DC-122 — a flex row that aligns its BOXES where the user aligns by its
CONTROLS: `align-items` chosen for a row whose children are two different
shapes (2026-09-09).** Four forms — CAL's event form, DOKUMENTI's, and
UČENJE's exam and plan forms — put a labelled `TextField` next to a bare
`<input>` or a `<Button>` in one wrapping flex row and said
`align-items: center`. A labelled field is two boxes tall, label above control;
a bare input, a button, a checkbox and an `inline` select are one. Centring the
BOXES therefore separates the two CONTROLS by half a label — and the controls
are the only part of a row the user reads or touches, so the one thing that had
to line up was the one thing that did not, at every window size.

*Root cause:* not four copied declarations. `center` was CORRECT on the day
each was written, because while every child of a row is one box tall `center`,
`end` and `start` draw the same picture. The rows became wrong the afternoon
[[DC-120]]'s labels arrived — a change three files away, entirely right in
itself, that altered a child's HEIGHT and therefore the meaning of a property
declared in a stylesheet nobody touched. The rule that is actually wrong is
„a row picks its alignment once": alignment is only a free choice while the
children agree about their shape.

*The tell:* **a flex row whose direct children are not all the same shape.**
Where they are — a toolbar, a chip row, a segmented group, of which this app
has fifty-odd — `center` is right and stays right. Where they mix, `end` is not
a preference but the answer: it aligns the bottoms, so the controls share a
line and the labels float above the children that have them. `baseline` sounds
right and levels a LABEL with the bare input's text; a missing `align-items` is
worse than `center`, because the default `stretch` makes the bare input as tall
as the whole labelled field.

*Why nothing in the tree could see it.* `center` is a valid value; every length
around it is a token; it typechecks because it is CSS. The screenshot sweep
photographs a centred row and an aligned one as two rows of correct-looking
boxes — two layers differ only where they meet, and these two differ by a few
pixels on one control. And neither half of the source carries the
discriminator: the stylesheet cannot say what is IN the row, the markup cannot
say how the row is LAID OUT.

*Blast radius:* twenty containers in the tree mix the two shapes; fifteen of
them declare a flex row; four were centred and eleven already said `flex-end`.
All four fixed.

*Fix:* `align-items: end` on the four, and the class turned into the
twenty-first static gate, `check:rows`, which reads the markup to decide which
rows are mixed and the CSS to decide whether they are aligned. It needs no
exemption list, because it is a statement about what a row CONTAINS rather than
about what it is called; fragments are transparent, which is the correct
reading and not an oversight (CAL's two `type="time"` fields live inside
`{!allDay && (<>…</>)}`). It accepts `end` and `flex-end` both — they compute
identically in a flex container, and requiring one spelling would have been a
preference wearing a defect's clothes, worth eleven edits to eleven correct
rows.

*The suite asks what the gate cannot.* An empty finding list is both the right
answer and the answer a broken walk gives, so the census is a separate export
and one test names the four rows the rule was written for. Mutating the lexer
guard back is the proof: the gate prints its success line and exits 0, and the
only thing that turns red is that assertion. **Every gate whose clean state is
silence needs one test that the subject is still being SEEN.**

*Two sub-findings, each of which cost a measurement and is therefore written
down.* The first: `/\blabel=/` also matches `aria-label=`, because `\b` sits
happily between `-` and `l` — five rows counted as labelled that were the
opposite, and a field's OWN label versus a name only a screen reader can hear
is the entire subject of the rule. The second is the more useful one and is a
class in its own right: **a shared scanner is only as correct as its most
demanding caller.** `scripts/jsx-elements.mjs` read a TypeScript type argument
as an element — `ChangeEvent<HTMLInputElement>` is not self-closing and is
never closed, so it sat on the nesting stack and swallowed every following
sibling as its child. `check:controls` and `check:tiers` ask for one specific
tag and never met it, `input` and `select` not being generic type names; the
first caller to walk EVERY tag did, and reported nothing on a form written to
catch it — [[DC-36]]'s shape exactly, a gate that reports nothing being
indistinguishable from a gate that finds nothing. Fixed in the shared lexer
rather than in the gate, and its cost written down as a test: an identifier
running straight into a `<` is now skipped, which is a real false negative for
JSX text (`<p>foo<b>bar</b>`) and is the right trade here by measurement —
every one of the eleven such places in the renderer is `typeof` or `keyof`.

*Related:* [[DC-120]] (the labels that made the heights differ; this class is
what those labels exposed, not what they caused), [[DC-36]] (the gate whose
silence reads as a clean tree), [[DC-57]] (a rule enforced by photography holds
only where the camera goes).

**DC-123 — two independent checks as consecutive steps of one job, so the
second is only ever reported when the first passes: a red check that hides a
red check (2026-09-09).** The `Dependency audit` job runs „Shipped
dependencies" (`pnpm audit --prod`, no exceptions) and then „Build toolchain"
(`audit-toolchain.mjs`, an allow-list). They answer different questions about
different halves of the tree and neither depends on the other's result. On
2026-09-09 one new `js-yaml` advisory failed the first, GitHub skipped the
second by default, and **eight more advisories on `@xmldom/xmldom` were never
reported at all** — they exist in this repo's history only because both halves
were run by hand while fixing the first.

*Root cause:* not the advisories. A job's steps are sequential and a failed
step ends the job, which is the right default for a PIPELINE — build, then
test, then package — and the wrong one for a PANEL of independent checks. The
rule that was wrong is „these two belong in one job", stated by putting them
there and never revisited when the second was added.

*The tell:* **a job whose steps could be reordered without changing what any
of them means.** That is the definition of independence, and it is visible
without knowing anything about what the steps do. If step B would give the same
answer with step A deleted, then a failure in A must not silence B.

*Why it costs more than it looks.* The failure is not „we learn about the
second problem later" — it is that fixing the first produces a NEW red check on
the next push, which reads as a regression caused by the fix. One advisory's
round trip becomes two, and the second one arrives disguised.

*Fix:* `if: '!cancelled()'` on the second step — not `always()`, which would
start an audit inside a run somebody has cancelled. The job still fails on
either half; both now say so in the same run.

*Not a gate, and the reason is the usual one:* the rule is about which steps
are INDEPENDENT, which is a judgement about meaning rather than about text, and
this repository has exactly one job with two of them. A script would be
encoding a reading of two YAML steps and would have to be told about every
future job that legitimately is a pipeline.

*Related:* [[DC-36]] (a check whose silence is indistinguishable from a pass),
[[DC-122]] (the same week, and the same shape one layer down: a gate that
reported nothing looked exactly like a clean tree).

**DC-124 — an instrument pointed at a fixture whose DEFAULT state exercises
nothing, so every frame it takes is of an empty case (2026-09-09).** The
screenshot sweep opens ZADACI, which lands on „Inbox". The demo profile files
all forty of its tasks into the five lists below it, and no scene ever moved
the rail. Lista, Tabla, Kartice, Kalendar and Izbor are one fan-out of that
landing, „Detalji" is a pane over it and the recurrence editor is three steps
inside its form — **eight scenes, every frame a photograph of „Nema
zadataka"**, in the module the product is most about. A task row, a section
heading, a grip, a priority chip, a subtask, the board's columns and the card
grid had between them never been in a frame. The first run that moved the rail
found an overlap at the enforced 900px window: `.nx-list-row__content` shrank
to 65px, which is narrower than the word „diplomski", and four lines of title
drew UNDER the chips.

*Root cause:* not the seed, and not the scene. Both are individually right —
an inbox that is empty is what a kept system looks like, and a scene that opens
a module and photographs it is doing its job. The rule that was wrong is the
unstated one joining them: **a fixture is only a fixture for the state you
actually navigate to.** Seeding data and photographing a module are two
different guarantees, and having both does not compose into „the module is
photographed with data in it".

*The tell:* **a frame whose own summary contradicts its body.** Every one of
these eight frames carried „OTVORENO 40" across the top and „Nema zadataka"
underneath. The instrument had the counter-evidence inside the picture and
nothing compared the two — which is the general form: where a surface draws
both an aggregate and the rows it aggregates, a fixture that reaches one and
not the other is visible in a single frame, to anyone who looks.

*Why nothing else could see it.* The run said „SHOTS OK — 0 findings", and it
was telling the truth: an empty state has no clipped text, no overlap and no
sub-24px target, so a module the camera never really visited scores exactly as
well as one that is perfect. **An audit over frames cannot report the frame it
did not take**, which is [[DC-57]]'s reach argument one level up — that class
is about surfaces behind a click, this one is about surfaces behind a
SELECTION.

*Fix:* `OPEN_FIRST_TASK_LIST` walks the rail until a list draws a row and
reports when none does, and it runs on the landing scene alone because a module
already open is not remounted. Deliberately not „click Fakultet": a scene that
hard-codes a seed's copy breaks when the seed is edited, and is right for the
wrong reason until then. The overlap it found is fixed in the row
(`flex-wrap` plus a 240px title floor), not in the checkbox.

*Not a gate.* The question „does this scene reach a populated state" has no
static answer — the state is produced by clicking, and the only oracle is the
frame. The nearest executable form is the tell above, and it is now built:
`hollow-fixture` in `shots/audit.ts`.

*What the tell caught, and what it cost (2026-09-10).* Its first full sweep
returned three findings, and the split is the useful part. **One was a second
instance of this very class**: `tasks-new-section` reached „Nova sekcija" by
clicking the first real rail row, which is „Inbox", which is empty — so the
path UNDID the selection `OPEN_FIRST_TASK_LIST` had made one scene earlier,
and the one TASK form that needs a populated list had been photographed
against „Nema zadataka" for its whole life. A fixture fixed at the module does
not stay fixed for a scene that navigates afterwards.

The other two were the rule being wrong: it asked whether the page held ANY
page-sized empty state, which fires on BELEŠKE (an editor pane saying
„Nijedna beleška nije izabrana" beside a list of 52) and on FIT („Moje vežbe"
empty because the catalogue covers most of it, and the copy says so). **An
empty BOX inside a populated page is what an empty state is FOR.** The claim
is about a module's CONTENT REGION — `data-nx-content`, which `below-fold`
already reads — holding nothing but that empty state, and a populated pane
beside the empty one now fails the test by construction rather than by
allowlist.

*And the lesson that cost the most.* The first sharpened version was **dead**
— `tasks-new-section` photographs the rows box with the section composer open
inside it, so „the region's only content" was false at the very frame the rule
existed for. It reported zero findings, and zero findings is what success
looks like. It was caught by pointing the scene back at the empty list on
purpose and DEMANDING the finding. A rule that cannot fire is worse than no
rule, because it also occupies the place where a working one would go —
[[DC-36]] one layer up, and the reason `audit.test.ts` carries a test that
shows its own mechanism going red. The fix is the same shape as the rule
itself: a `<form>` and a `<button>` are stepped over, because an affordance to
ADD something is not something a region is SHOWING.

*Related:* [[DC-57]] (a rule enforced by photography holds only where the
camera goes), [[DC-125]] (found in the same run, one layer down: of the frames
the camera DID take, two were filed under the wrong name), [[DC-36]] (an
instrument whose silence and whose pass look identical).

**DC-125 — a name read at one moment and dereferenced at another, through an
address that is only stable if nothing moved (2026-09-09).** The sweep's
fan-out read every switcher option's LABEL once, up front, and then clicked
options by INDEX into a fresh `querySelectorAll` for each one. Two addresses
for one thing. TASK's switcher offers „Izbor" on the list view and nowhere
else, so the first view change shortened the list and every later index was off
by one: the run wrote `tasks--kartice.png` and photographed the CALENDAR, wrote
`tasks--kalendar.png` and photographed the calendar with the detail fold open,
and „Kartice" — one of the module's four shapes — was never in a frame at all.

*Root cause:* an index is a position, not an identity, and the code held it
across a re-render it had itself caused. The label was the identity all along
— it is what the frame is NAMED after — so addressing by it makes the name and
the picture the same fact rather than two facts that happen to agree.

*The tell:* **a value captured before a mutation and used after it, where the
value is an offset into the thing that was mutated.** Reading the list again
before each click LOOKS like the careful version and is exactly what hid this:
the query was fresh, so the node was real, so the click worked, so nothing
threw. Freshness of the container is not freshness of the address.

*Why nothing could see it.* Every frame was a correct rendering of a real
view. There is no visual defect to find, no exception, no empty result — the
only evidence is a filename compared against the picture inside it, which is
precisely the comparison an automated audit over frames does not make and a
human skimming 2 700 images does not make either. It survived every full sweep
this instrument has ever run.

*Fix:* `clickFanout` takes the label and finds the option carrying it, and
returns whether it found one — a label that has gone is now REPORTED rather
than silently clicking nothing. The option skipped as „already on screen" is
the one that is `aria-pressed`, not the first: „Izbor" is drawn first and the
landing opens on „Lista", so the sweep had been skipping a mode it had never
photographed and photographing the list twice. The scene still returns the
switcher to where it found it, and that click now names the same option too
rather than trusting position 0.

*Related:* [[DC-124]] (found in the same run, one layer up), [[DC-115]] (a
ladder whose positions were chosen at each call site and meant different things
at each), [[DC-36]] (a wrong answer that is indistinguishable from a right
one).

**DC-126 — a control's unavailable state reaching content that merely sits
inside it (2026-09-09).** `Checkbox` renders its label as a sibling of the box
inside one `<label>`, and the shared rule
`.nx-checkbox input:disabled ~ .nx-checkbox__label { opacity: 0.45 }` mutes the
two together. That is right at seven of the eight call sites, where the label
is the control's own NAME („Klasični početak", „Prvi red je zaglavlje") — you
cannot change this, so its name goes quiet with it. TASK's row is the eighth:
the label there is the task's TITLE, put inside the box so a screen reader
announces „Sastanak sa mentorom, checkbox, checked" as one thing. „Izbor", the
batch mode, disables the box on every row — so entering the one mode whose
whole job is reading rows to pick them drew the entire list at 45%, and the
pick target, which is the row, looked unavailable.

*Root cause:* the component has one disabled treatment and it assumes the label
NAMES the control. The assumption is unstated and true almost everywhere, which
is what let the one call site that breaks it pass review: nothing in the JSX
says „this label is content", and nothing in the CSS asks.

*The tell:* **a state that is true of a control, applied to a box that also
contains something the control does not own.** The general form is not about
checkboxes: wherever a component wraps caller-supplied children and then styles
them from its own state, it has assumed what those children are.

*Why nothing else could see it.* Every layer is individually correct — the rule
is token-free opacity, the markup is a valid `<label>`, `disabled` is the right
HTML for a box the mode has made inert, and `check:controls` is satisfied
because the class is there. Only a photograph of a POPULATED list in that mode
shows it, and until [[DC-124]] was fixed the same day, TASK had never been
photographed with a row in it at all. This is DC-124's dividend: the first
populated frames produced a real defect within minutes.

*Fix:* one rule in `tasks.css`, at the page that passes the unusual label:
`.tasks__row--picking .nx-checkbox input:disabled ~ .nx-checkbox__label
{ opacity: 1 }`. Deliberately NOT taken out of the component — the component's
rule is correct for a label that names its control, and weakening it for seven
correct sites to accommodate one exception would put the defect somewhere
harder to see.

*Related:* [[DC-124]] (the frame that made it visible), [[DC-120]] (the other
half of „what is this label FOR" — there, a field with no name; here, a name
belonging to something else).

**DC-127 — a set enumerated by the class its members share for LOOKS, and
walked as though every member were exclusive (2026-09-09).** The sweep's
fan-out addresses a switcher with `.nx-segmented__option`, which is a
typographic treatment rather than a group: three unrelated controls in TASK's
header wear it so they read as one row of type. Two of them are not views.
„Izbor" is an independent MODE; „Detalji" is the capture composer's disclosure.
The walk clicked all of them, then „returned the switcher to where it found it"
with a single click on the option that had been active — which restores a view
and does nothing at all to a toggle. So both stayed switched on for the rest of
the pass, `tasks-detail`'s probe found a button reading „Sakrij detalje" where
it expected „Detalji", missed, and the scene named after TASK's detail form
photographed the list — in a mode — for as long as it has existed.

*Root cause:* two assumptions, both unstated. That everything wearing a class
plays the same role, and that clicking one member of a group deselects the
others. Neither is a property of a CSS class; both are properties of a role,
and a role is what `aria-*` states.

*The tell:* **a restore step that names one thing where the walk changed
several.** „Put it back" written as a single click is a claim that the walk's
every step was mutually exclusive with its every other step — a claim worth
checking whenever the set was gathered by appearance.

*Why nothing else could see it.* Each frame is a correct rendering of a real
state, so the audit reports nothing; the extra frame `tasks--detalji.png` looks
like a bonus rather than a leak; and the damage lands in a LATER scene, which
is the part that makes it invisible to anyone reading one frame at a time.
[[DC-125]] hid in the same place for the same reason, and this is the layer
under it: that one was the wrong address for a member, this one is the wrong
membership.

*Fix:* the enumeration skips anything carrying `aria-expanded` — a control that
reports whether something is OPEN is not one that reports which of several
things is SHOWING — and no frame is lost, because `tasks-detail` is the scene
for that surface. The walk then asks the page after every click: if what was
showing before is STILL active, the option added a state rather than replacing
one, and it is clicked again to put it back. `tasks-detail`'s own first step,
which said `.nx-segmented__option` meaning „the first view", now names „Lista"
— it was making [[DC-125]]'s mistake in a second place.

*Related:* [[DC-125]] (the same instrument, one layer up), [[DC-124]] (a scene
that photographed a state nobody had navigated to), [[DC-98]] (a class that is
a LOOK being asked to carry a meaning).

**DC-128 — a flex item whose minimum is zero, under something that can grow: it
is crushed rather than pushed, and a crushed box is not a scrolled one
(2026-09-10).** `.note` is the three panes BELEŠKE is made of, and it is
`flex: 1; min-height: 0` — the zero is load-bearing, because a flex item's
automatic minimum is its content and the panes could not scroll internally
without it. Above the grid sits „Pregled", a disclosure holding a stat band and
a writing heatmap: about five hundred pixels drawn out. At the 900x600 window
the app ENFORCES, that leaves the grid a computed height of ZERO — and the
comment beside the disclosure said the note list was „entirely below the fold",
which is the wrong picture of the same arithmetic and the reason nobody chased
it. Below the fold means there is a scrollbar and something to scroll to. There
was neither: in a notes app, at the smallest supported window, with a panel the
user opened once and the machine remembers, the note list was not on the page.

*Root cause:* `min-height: 0` is not a layout decision, it is the removal of
one — and it was made for the CHILDREN (so the panes scroll) while its cost
falls on the PARENT (so the grid can vanish). Those are two different
questions, and one declaration answered both. The floor answers the second on
its own: below it the item stops shrinking, the column overflows, and
`.app__main` — which is a scroller — takes over.

*The tell:* **an element that is `flex: 1; min-height: 0` and has a sibling
that can change height.** A tab strip or a header cannot grow, so the shape is
harmless; a disclosure, a wrapping filter row and an error banner can, and
every one of them takes its pixels out of the same item.

*Why nothing else could see it.* Both declarations are correct in isolation and
both are what the documentation recommends. There is no invalid value, no token
misuse, no contrast failure, and the geometric audit cannot see it either — a
box of height zero has no clipped text, no overlap and no escaping child. The
only instrument that reported it was `hollow-fixture`, and only at `min`: the
region says „Nijedna beleška nije izabrana" while the band above it counts 52.
That the finding appears at ONE of three window sizes is not noise, it is the
shape of the class.

*Fix:* a measured floor, `min-height: 320px` — the new-note button, the view
switch, a section head and three rows at the pitch a two-line title actually
draws at. Deliberately not „make the page scroll always" and not „cap the
disclosure": the first breaks the height contract every module obeys (a page
fills the height it is given and scrolls INSIDE itself), and the second hides
half a heatmap to save a list.

*Blast radius, measured:* one. The other three pages with an overview panel —
ZADACI, UČENJE, NAVIKE — put their content in normal flow, so an expanded panel
pushes it down and the page scrolls, which is the ordinary behaviour. `.cal__grid`
had already met this class and already carries a floor with the same argument
written out; `.priv__body` has the shape and nothing above it that can grow.
Two independent instances is what makes this a class rather than a bug.

*Related:* [[DC-124]] (the instrument that found it), [[DC-115]] (a value
chosen at each call site, meaning something different at each), [[DC-36]] (a
defect whose evidence is the absence of something).

**DC-129 — a guard sized from the widest case the author had in mind, applied to
a population a CALLER chooses: it stops being a guard and becomes a budget, and
it truncates in silence because a loop that exits early looks exactly like a
loop that finished (2026-09-22).** The screenshot sweep walks each scene's
switcher one option at a time, re-reading the page after every click, so the loop
is bounded by a count rather than by a length. The count was 64, and the comment
beside it justified the number in one clause: *„the widest switcher in the
product offers eighteen"*. Every word of that is true — of
`.nx-segmented__option`, which is what `DEFAULT_FANOUT` names. It is false of the
selector a scene is free to declare instead, and one scene declares
`.tool__item`: „Stručne alatke", the professional catalogue, nearly four hundred
entries. The walk photographed the sixty-fourth tool, stopped, and the other
three hundred and sixteen were never looked at — on this machine, for as long as
the cap existed.

*Root cause:* **the guard's justification and the guard's population were
different sets.** A bound is safe precisely to the degree that its author knows
the maximum of the thing it bounds; here the author knew the maximum of one
selector and the loop served all of them. Nothing checked that the two agreed,
and nothing could, because the number was written as a literal beside a sentence
about a different selector entirely. The second half is worse than the first:
reaching the bound wrote a line to stderr, and a line to stderr is not a verdict.
The run went on to print `SHOTS OK — 1 162 frames, 0 findings` and exit zero.

*The tell:* **a bounded loop whose bound is a constant, where the thing iterated
is chosen by a caller or a config, AND the bound-reached path does not stop the
run.** Either half alone is survivable: a bound tied to its own population cannot
be exceeded by a caller, and a bound reached loudly cannot be mistaken for
completion. Both together are a silent truncation, and the sentence that gives it
away is a justification phrased as *the widest X is N* — because the moment
somebody adds a wider X, the sentence is still on the page and still reads as
true.

*Why nothing else could see it.* Every frame the sweep did take was correct, and
the audit's answer — „0 findings" — was true of all of them. A coverage failure
is invisible from inside the covered set: the report counts what was
photographed, never what was owed, and the two are the same file. Compare
[[DC-124]], where the instrument was aimed at a fixture that exercised nothing —
there the frames were empty, here they were simply absent, and an absent frame
leaves no row to be wrong.

*Blast radius, measured:* one. `MAX_FANOUT_ROUNDS` was the only coverage cap in
the harness — the other numeric bounds in `shots/` are 120-iteration polling
timeouts, and the `slice(0, N)` calls are slug and report-formatting helpers.
The number of frames the harness writes is the measure: **2 423 before the walk
was rewritten, 1 162 after, and 321 `pro--` frames in a bucket where there had
been 64.** Two independent numbers is what makes this a class rather than a
one-off.

*Fix:* the constant is raised to 4096 — an order of magnitude above any list this
product renders — but **the number is not the fix**, because a bigger literal
fails the same way the next time a catalogue grows. The fix is that reaching it
now THROWS, which the sweep already routes to `SHOTS FAIL` and a non-zero exit.
Taking the failure was part of the change: the cap was temporarily lowered to 8
and the run was made to die, because a rule that cannot fire is worse than no
rule. The sibling report — „lost the option … mid-fan-out" — deliberately stays a
report: there the page took the option away, so whether a frame was owed is a
question about the surface; here the page still offers it and the walk stopped
looking.

*Related:* [[DC-124]] (the same instrument, the failure one layer down: a
fixture that exercises nothing rather than a walk that stops early), [[DC-127]]
(the same walk, when its enumeration was wrong), [[DC-115]] (a value chosen where
it was needed, meaning something different at each site), [[DC-110]] (a config
key that replaces the list it appears to refine).

**DC-130 — a rule written for a CONTROL, moved onto the box around it: the
declarations that INHERIT change what they mean, and they do it silently,
because the rule is valid CSS and the thing they restyle is a label that renders
correctly (2026-09-22).** Six settings rows were one markup written out six
times, and the rewrite folded them into one component — which put four classes
that had styled an `<input>` onto `TextField`'s WRAPPER, because that is where
that component puts a caller's class by design (`Select` puts it on the control,
the opposite way, and both are documented). `.set__currency-input` carried
`text-transform: uppercase`, correctly, for three letters of ISO 4217 currency
code. On the box it stopped describing the input and started describing
everything inside the box, and the field's own label came out as
„PODRAZUMEVANA VALUTA“ — shouted and letter-spaced — beside siblings reading
„Novih kartica dnevno“.

*Root cause:* **a CSS rule has a SUBJECT, and the subject is not in the rule —
it is whichever element carries the class at the call site.** Every declaration
in a rule is therefore conditional on an element the stylesheet cannot see, and
the conditional ones are the properties that inherit: `text-transform`,
`font-variant-numeric`, `font-*`, `letter-spacing`, `text-align`, `color`,
`visibility`. `width` moves from an input to the box around it and means the
same thing, because `.nx-textfield__input` is `width: 100%`. `text-transform`
moves and means something wider. Nothing in the stylesheet distinguishes the
two cases, and nothing in the type system can, because the class is a string and
the element is a tag.

*The tell:* **a class that has moved element, or that two sibling components
place differently — re-read EVERY declaration for whether it inherits.** The
half that makes this a class rather than a tidy-up is the near miss beside it:
`font-variant-numeric` moved the same way, in the same commit, and inherits
identically, and is invisible on every label under it today. It was moved for
consistency rather than because anything looked wrong, and the reasoning is in
the comment: the day one of those labels reads „Najviše 200“ beside its own
input, tabular figures on the label are the whole reason the property is there,
and by then nothing will remember which element it was written for.

*Why nothing else could see it.* The frame is correct in every respect the audit
measures: the box is the size the rule asked for, the label is inside it, and
the geometry is clean. `check:css`, `check:colours` and `check:tokens` are
indifferent — the rule is valid CSS, uses real tokens, and declares no raw
colour. TypeScript sees a string passed to `className`. The only instrument that
could see it was an eye on the PNG, and the PNG had to be taken first: the
settings cards themselves were in **no frame at all** until the same piece of
work added one per registered module, so the defect landed on a surface with no
photograph to compare against. See [[DC-124]] for the same instrument failing at
the opposite end.

*Blast radius, and the part that went wrong the second time:* the correction
swept for `set__*-input`, found three, and **missed the fourth — STUDY's
`.set__study-number` — because it is not named that way.** So the pass that
existed to fix this class committed the same shape of error as [[DC-109]]: a
search keyed on the FORM of a name rather than on the fact being looked for
(which classes now sit on a `TextField` wrapper). The four rules live in two
stylesheets and only three share a naming pattern; the right enumeration was
four call sites of `className=` in the one file that builds these rows.

*Fix:* all four rules were split by subject — the box property on the class, and
everything that reaches text on `.nx-textfield__input`. The argument is written
once, in `finance.css`, and `settings.css` points at it rather than repeating it,
for `check:tiers`' reason: three copies of a rule already drift to four leadings
and three measures.
The same reading of the row found its other half. The new row is a `TextField`
nested inside `.set__study-field`, so the gap from the name to the control came
from `.nx-textfield` (6 px) and the gap from the control to the hint came from
`.set__study-field` (4 px) — one row, two rhythms, and it is the only field in
the app with either. The outer gap is 6 px now. **Nothing measured that, and
nothing could have**: 4 and 6 are both tokens, both boxes are the right size,
and the audit has no opinion about whether a row is evenly spaced. What found it
was a sentence in the commit message for the rewrite that stated the change —
and the change had not been made. Read the message against the diff.

*Related:* [[DC-109]] (a list kept by hand beside a generated one, failing by
omission — the second half of this entry is that defect in a grep), [[DC-120]]
(the name of these same fields, written twice), [[DC-115]] (a value chosen at a
call site, meaning something different at each), [[DC-107]] (a rule the shared
component already answered, not carried into the bespoke drawing beside it).

**DC-131 — a wrapping `<label>` takes the element's entire text content as the
control's accessible name, so anything else inside the label joins the name —
and the arrangement that puts it there is the one the design asks for
(2026-09-22).** PRIVATNO's four credential choices are each a `<label>` wrapping
a radio, the name of the choice, and the sentence explaining it. Every one of
them was read out as a single utterance: „Zasebna šifra za Privatno Zasebna
šifra ostaje na ovom uređaju…". The gate written for it then found the same shape
already fixed elsewhere — UČENJE's two daily caps, which until `a4f4a8c`
announced themselves as „Novih kartica dnevno Najviše 200 novih kartica
dnevno" — and that is the second instance that makes this a class rather than an
incident.

*Root cause:* **a wrapping label's accessible name is not the span that looks
like the name — it is the label's whole text content**, and a hint explaining the
field is text content. The feature is intentional and load-bearing: it is why
`<label>Email <input></label>` needs no `for`. The defect is that nothing
distinguishes „the label contains the control and its name" from „the label
contains the control and everything said about it", because in the markup those
are the same shape. And the shape they are is name-above-control-above-hint,
which is what every field in this app is supposed to look like.

*The tell:* **a `<label>` with no `htmlFor` that contains more than the control
and the text that names it.** The specific form worth grepping for is a
`nx-hint` (or any `__error`) descended from one.

*Why nothing else could see it.* This is the rare defect whose every visible
property is correct. It renders as designed, `check:css`/`check:colours`/
`check:tokens` are satisfied, it typechecks and it lints. And the screenshot
sweep photographs a correct accessible name and a wrong one as the same PNG,
because an accessible name is not in the picture at all — so the PRIV frame
taken after the fix shows what the frame taken before it showed, which is
nothing to do with this rule either way. The failure exists only for a reader
who cannot see the screen, and nothing in this repository is that reader.
Compare [[DC-120]], which is the same attribute failing the opposite way (a name
that exists nowhere on screen); the two together are the argument that
`aria-labelledby`, `htmlFor` and a wrapping label are three different mechanisms
answering one question, and that only one of them was ever checked.

*Blast radius, measured:* ten wrapping labels in the tree that hold a control;
four were findings, all four in one file, and the other six are correct — four in
`RecurrencePicker` wrapping a name and a number, `ElecChassisDialog`'s shape
picker, and `FinancePage`'s amount field. The census is exported beside the
verdict so a later run can tell „found nothing" from „looked at nothing".

*Fix:* both ways out are correct and the choice is the layout's. The explanation
can move out of the label — which is what `TextField`, `Select`, `TextArea` and
`Checkbox` do by construction, each drawing a `<label for>` BESIDE its control,
and the reason the six settings rows stopped having this defect the day they
adopted one. Or the control can be named by reference, `aria-labelledby` at the
span the user reads — which is what PRIVATNO takes, because the row must stay a
`<label>` for the whole box to stay clickable: `cursor: pointer` on
`.priv__choice-row` is the interaction, and it is why the label was wrapping at
all. Enforced by **`check:names`**, which is allowlist-free because it is a
statement about what a wrapping label contains.

*Related:* [[DC-120]] (the same attribute, the opposite failure: a name that is
nowhere on screen rather than everywhere), [[DC-130]] (the other half of this
window's markup work, and the same lesson that a rule's SUBJECT is chosen at the
call site), [[DC-98]] (a native control that skips the shared component, whose
gate this one sits beside), [[DC-124]] (an instrument that photographs without
reading).

**DC-132 — a citation that names its evidence by a number two namespaces both
carry (2026-09-22).** `packages/sync-transport/src/signal.ts` fixes the realtime
topic namespace and cited „migration 006" for it. This repository has **two**
migration series and **both number from 001**: the local SQLite schema in
`packages/db/src/migrations/NNN-slug.ts`, which has reached 068, and the server
series in `supabase/migrations/<timestamp>_slug.sql`, which has thirteen members
and carries no 006 at all. The policies the sentence was about are in that
series' **004**. The only 006 in the tree is the LOCAL series' flashcards table,
so a reader who grepped the number landed on a table with nothing to do with the
sentence — and a reader who did not grep took the citation as evidence about the
server.

*Root cause:* **a bare number is not an identifier when two series share the
numbering.** The sentence was true, and its arithmetic was true; it named its
evidence by the one thing that could not distinguish the two.

*The tell:* **a citation of a migration by number, in a tree with more than one
series.** The form is hardest to see exactly where it is most dangerous — in
`packages/`, where a file may legitimately mean either series — which is why the
fix is to cite by FILENAME and never by number.

*Why nothing else could see it.* A prose citation has no type, no import and no
call site. Typecheck cannot read it, no lint rule looks for it, and the number
resolves to something real — just not to the thing it means. Compare [[DC-117]],
which had to be written down for the same reason: a fact recorded in prose is
checked by whatever checks that prose, and nothing was checking prose at all.

*Blast radius, measured:* the gate counts what it can see — **123** citations
across `supabase/` on the day it was written — and exports the count so a later
run can tell „found nothing" from „looked at nothing". **And the gateable half is
only half.** `check:migrations` is scoped to `supabase/` because that tree has
one series; in `packages/` there are two, and no directory-scoped rule can say
which one a citation means: `packages/sync/src/push.ts` cites the server while
its sibling `collections.ts` cites the local schema — one directory, one idiom,
opposite subjects. That is stated in the gate's own header rather than left for
a reader to discover.

*Fix:* cite **by filename** where a number could be ambiguous, which is what
`signal.ts` and its test now do. Enforced by **`check:migrations`**: the server
series is declared once per file, numbered uniquely, in filename order, and every
citation under `supabase/` resolves to a declared member; the README's hand-kept
tree listing must also be complete, because it had already lost four of thirteen
migrations by omission. The gate found a live instance on the day it was
written — in the README paragraph explaining the numbering, which itself said
„Migration 006" — which is the evidence that it is not vacuous.

*Related:* [[DC-109]] (a hand-kept list beside a generated one), [[DC-117]] (a
fact stated in prose that nothing could check), [[DC-133]] (the same shape one
layer up: a rule whose SUBJECT is not in the file that states it).

**DC-133 — a sentence written for a slot nothing draws (2026-09-22).**
`waveValuesHint` — „Razdvoj vrednosti tačkom i zarezom: 0; 1,5; 3,3" — is the
only place in the product saying that a list of readings is separated by
semicolons. It was written for the Elektronika simulation dialog's readout and
the dialog never drew it, so `0, 1,5` was one reading and no error: the person
typed a list, the app read a single malformed value, and neither said anything.

*Root cause:* **the copy table is checked by everything and read by nothing.** A
string in `strings.sr.ts` is reachable by `check:strings`, `check:address`,
`check:quotes`, `check:tokens`, the colour gates, typecheck and lint — and not
one of them asks whether anything ever puts it on a screen. The defect is not „a
string is unused", which a compiler would call dead code and happily report; it
is „a sentence exists for a slot that was never built", which is a statement
about the MARKUP and has no compiler at all.

*The tell:* **a leaf of the copy table that nothing NAMES, and whose parent
subtree nothing INDEXES or HANDS AWAY.** The four clauses are the four ways a
leaf can legitimately be read. A leaf with none of them is a QUESTION and not yet
a verdict, because the two ways to have no clause are opposite defects — a copy
that was never wired up, and a copy that was never needed.

*Why nothing else could see it.* An unread leaf typechecks, lints, carries no
colour and no token, declares nothing for `check:tokens` to resolve, and
**photographs as nothing at all, because it is not on screen.** Every instrument
that reads the code passes; the one instrument that reads the rendered app cannot
photograph an absence.

*Blast radius, measured:* the gate walks **15 907** copy leaves and finds **none**
unread as of 2026-09-22, having found **24** when it was written. They were not
one defect. Four wanted RENDERING: `onboarding.packsNoChoice` (what happens if no
pack is chosen, on the screen that asks you to choose one, where it is the only
place it can be said), `devtools.design.gradient.stops` (a section heading over a
section that had none), and `fitness.training.start.error` and
`fitness.training.set.actionError` — both written for exactly the failures they
describe and both unreachable, because `fitTrainingError` had a default that
answered for every caller. The other twenty wanted DELETING: copy left behind by
a screen that was rewritten, `study.title` chief among them, saying „Predmeti"
for a page whose rail and header both say „Učenje". **206** leaves sit under a
subtree handed out of the walk's sight and are printed as NOT JUDGED rather than
counted as clean — `pro.biznis.iban-check.bban2` is one, because the app reads
`s.bban`, a key that was not always spelled that way, and the gate will not be
the one to say so.

*Fix:* **`check:copy`**, allowlist-free because the rule is a statement about
what a leaf is reached by rather than a list of exceptions — and it reads the
MARKUP as well as the CSS, for [[DC-109]]'s reason. It forced one structural fix
beside it: `fitTrainingError`'s default is GONE, replaced by a required
`fallback` parameter, so the compiler is now the census of who must decide. A
default is what let two written sentences ship unread; deleting it makes the same
silence unrepresentable rather than merely absent.

*Related:* [[DC-109]] (a hand-kept list mirroring a generated one),
[[DC-117]], [[DC-124]] (an instrument that photographs without reading — and this
is the defect that has no picture at all).

**DC-134 — an asynchronous entry point with no failure route (2026-09-22).**
`app.whenReady().then(async () => { … })` carried a `try`/`catch` INSIDE the
callback that begins after the sandbox wipe, the proxy switch and the spellcheck
switch, and no `.catch` on the promise. Everything before that `try`, and every
listener registration after it, had nowhere to fail to: a throw became an
unhandled rejection, which Electron reports to a console nobody is reading, and
the application stopped **half started** — a window at 0 % CPU, no message, no
exit. It has cost three runs and the shape is identical every time: twice through
`setSpellCheckerDictionaryDownloadURL('')`, which refuses an empty string by
rejecting a promise it created internally while the method itself returns `void`
— so there is nothing to await, nothing to `.catch()`, and nothing for a `try` to
catch — and once through a sandbox `rmSync` throwing `EPERM`.

*Root cause:* **a `try` inside a callback does not cover the callback.** It reads
as „startup is guarded" and it is not: it guards a REGION, and the code before
and after it is as unguarded as if the `try` were absent. The reader who sees
`try {` near the top of a long startup callback has been told something false.

*The tell:* **a `.then(async () => {` with no `.catch(`, and a `try` that begins
partway down the callback.**

*Why nothing else could see it.* No test reaches `whenReady`'s failure path, and
the symptom is a process that does not exit — which CI calls a hang and a person
calls a slow start. The one instrument that could have caught it, the smoke run,
is the instrument it broke.

*Blast radius, measured:* three `.then(` chains in `src/main` outside tests. Two
are caught at the call site — `runSmoke` and `runShots`, each ending in a named
FAIL line and a non-zero exit. The third is the entry point itself, which is the
one place a failure is LEAST visible, because there is no window yet for a
message to appear in.

*Fix:* `.catch(…)` on the `whenReady` promise, printing the error and exiting
non-zero — **and** a named refusal around the sandbox wipe, which is not
redundant: it says which sandbox could not be cleared, and the generic line
cannot. The `try` inside the callback stays, because it is where a failure can
still be recovered from; the `.catch` is where one cannot.

*Related:* [[DC-135]] (the defect that found this one), [[DC-01]] (a check that
covers nothing and still reports success — the same shape, one layer up).

**DC-135 — an exclusive resource two runs both own and neither locks
(2026-09-22).** `--smoke` and `--shots` each resolve the sandbox
`app.getPath("userData")/<kind>` and each wipe it on start. Two `shots` runs on
one machine therefore do not merely collide: the second one's wipe deletes the
first one's `keychain.json` mid-run, and the first one's next unlock refuses —
honestly, and for a reason that is not true of the app. **A sweep whose evidence
says „the app would not unlock" is worse than a sweep that did not run**, because
it looks like a finding.

*Root cause:* **a resource with no owner.** Nothing in the tree said that a
harness run owns its sandbox for its duration, so nothing enforced it, and every
process that wanted the path computed it for itself.

*The tell:* **two runs of one verb on one machine, over a directory that is
wiped on start.** The second half is what makes this a class rather than an
accident: „wipe it, so the run is deterministic" is precisely the sentence that
makes a resource exclusive, and it was written for a good reason.

*Why nothing else could see it.* Both runs exit zero, or one of them exits on a
filesystem error, and from the outside those are indistinguishable from a clean
run and an unrelated crash. The Windows form is worse: `rmSync(…, {recursive:
true, force: true})` throws `EPERM` against a directory another process holds a
file open in — `force` forgives a MISSING path, not a BUSY one — and that throw
is what [[DC-134]] turned into a silent half-start.

*Blast radius, measured:* three harness verbs (`smoke`, `shots`, `demo`), one
sandbox each, and one `out/` shared by all three. The `out/` half is the same
rule one directory over — two runs build into the same paths — which is why the
lock is taken before the BUILD and not before the launch.

*Fix:* **`apps/desktop/scripts/run-lock.mjs`** — ONE lock for the whole harness
in `os.tmpdir()`, created with `wx` so two processes starting in the same
millisecond cannot both win, carrying the pid so a lock left by a killed run is
taken over rather than deadlocking the machine until somebody finds the file, and
released ONLY while it still names the process releasing it, because a run that
was killed and a run that took its lock over both reach the release path and the
first must not delete the second's lock. `launch.mjs` acquires it and now runs
the build itself, so „a run" is one thing from the build to the exit. The sandbox
wipe refuses loudly if it is reached anyway. Executable as a PIN and not a gate:
`scripts/run-lock.test.mjs` reads `apps/desktop/package.json` and fails if a
harness verb exists that is not in `HARNESS_KINDS`, because a verb added without
a lock behaves exactly like a verb with one.

**The lock was one-per-verb for part of a day, and the correction is half the
entry** — one lock per kind was written first, and a kind per verb reads as
though the resource were covered while leaving the half neither run owns alone
uncovered. `--smoke`, `--shots` and `--demo` build into the SAME `out/` and then
run the same binary out of it, so a `smoke` and a `shots` starting together
corrupt the build rather than the sandbox, which is a different symptom of one
rule. The kind now travels INSIDE the lock, so a single file can still say which
verb is in the way, and `HARNESS_KINDS` is the vocabulary the refusal message
prints rather than the list of what gets locked — everything the launcher knows
takes the lock, a bare launch included, because every one of them builds.

*Still open, recorded and not decided:* two instances of the REAL app share
`%APPDATA%\Nexus` the same way, and nothing locks it. WAL makes the database
itself safe under concurrent access — that is what WAL is for — but the account
registry's `lastActiveId` is written by both, and `--demo` adds an account to the
developer's own userData while their app is running. Whether a user may run two
instances at all is a product question (ADR-044's registry says nothing about two
PROCESSES), so it is the founder's, and this entry records it rather than
answering it.

*Related:* [[DC-134]] (the silent half of the same incident), [[DC-111]] (the
other rule that lives at the end of the script that builds something),
[[DC-115]] (a rule that existed only in prose — which is what this one was).

**DC-136 — a control's empty state, spelled in the DOM's vocabulary rather than
the contract's (2026-09-22).** A `<select>` spells „nothing is selected" as
`value=""`, because that is the only thing an empty `<option>` can produce. The
IPC contract behind an OPTIONAL field spells the same state as `null`, and its
validator refuses the empty string by name — an empty id is a bug on the wire and
not a way of saying „no id". So `onChange` passing `event.target.value` straight
through sends `""` to a validator that accepts `null` or a real value and neither
is `""`: **the one option that exists to UNDO the field is the one option that
always comes back as an error.**

*Root cause:* **two vocabularies for one state, meeting at an attribute rather
than at a type.** Nothing is mistyped — `event.target.value` is a `string`, the
channel takes a `string | null`, and the empty string is a `string`. TypeScript
cannot see it, the linter cannot, and the screenshot sweep photographs the option
being picked and an error appearing, which is a correct-looking screen.

*The tell:* **a placeholder option, a null-able contract field, and no
translation at the boundary.** The fix is one clause — `value === "" ? null :
value` — and it has to be written at every such site, which is what makes it a
class rather than a bug: the pattern is invisible precisely where it is correct.
`ElecRunnerDialog.tsx`'s WSL distribution picker is the live instance; the
distribution is stored verbatim because it is the name `wsl.exe -d` will be
asked for, so the empty string was also the one value that could never be a name.

*Blast radius, measured:* sixteen `<option>` elements in the renderer whose value
is empty, and **fifteen of them are correct** — each either translates at the
handler, translates at the submit boundary, or never lets `""` reach the wire
because a guard or an `undefined`-returning parser stands in front of it. That
ratio is the finding, not a footnote: a rule written as „no `<option value="">`
without a translation" would fire on fifteen correct lines and be turned off
within a week, which is the argument `check:tiers` makes about its own
allowlist-free construction. Two of the fifteen are correct only because a GUARD
stands between the draft and the wire (`FinancePage`'s counter-account select,
`SettingsPage`'s two deck pickers) — latent rather than immune, and recorded here
so that a second submit path on either page is recognised as this class rather
than as a new bug. Four more sites spell the same state with a NAMED sentinel
(`UNFILED_VALUE`, `NEW_SUBJECT_VALUE`, `NEW_LIST_VALUE`, `NO_ATTACHMENT`) and are
handled at their own boundaries; **a future grep for `value=""` will not find
them**, which is the point of naming them here.

*Fix:* the translation at the boundary, in the renderer, because main is right to
refuse `""` — a name that is not a name must not be stored, and main's own test
asserts that refusal and stays. Main's side of the contract is unchanged by this
class; the defect is always the caller's.

*Related:* [[DC-131]] (a value refused for the wrong reason or accepted without
one — the same boundary read from the other side), [[DC-98]] (a native control
that skips the shared component, the other way a `<select>`'s rendering and its
contract drift apart), [[DC-137]] (the audit that measured this class was itself
too narrow).

**DC-137 — the blast radius measured with the construct AS IT WAS WRITTEN at the
first site (2026-09-22).** [[DC-120]]'s doctrine says to grep for the CONSTRUCT
and not for the file, and this is the shape of getting that wrong while
believing you have done it. The construct is „an `<option>` whose value is
empty". The grep was `'<option value="">'` — the construct as it happened to be
spelled at the one broken site, including the closing `>` and the attribute
order. It found fifteen sites and missed the sixteenth, because that one is
written `<option value="" disabled>`: the empty value is there, and the pattern
demanded that `>` follow it immediately.

*Root cause:* **a pattern that encodes the INCIDENT rather than the RULE.** The
broken site's own text became the template, so the audit inherited the broken
site's incidental shape — attribute order, a following `>`, single versus double
quotes, a literal versus a `{""}` expression — and every variance became
invisibility rather than a finding.

*The tell:* **a count that matches the earlier grep exactly.** Fifteen sites found
by the ordered literal and sixteen by the regex is a warning sign, not a
confirmation of diligence, because a blast radius that comes back the same size
as the first pass has usually not been enlarged at all — it has been re-read.

*Why nothing else could see it.* A blast-radius search has no oracle. Nothing
fails when it is too narrow; the extra site simply is not in the report, and the
report is the only thing anyone reads. The doc says „grep for the construct" and
does not say what the construct looks like when it is a JSX attribute, which is
where the freedom lives.

*Fix:* the pattern has to be written as the RULE — here,
`<option[^>]*value=(""|\{""\})` — which tolerates any attribute order, any
trailing attribute and both spellings of the expression. The general form is
worth more than this instance: **a pattern is a claim about a class, so it must
be written from the class's description and then CHECKED AGAINST THE FIRST SITE
that produced it** — if it does not match the incident that named the class, it
is not the class.

*Related:* [[DC-120]] (the same shape one layer up: a census keyed on a name
rather than on the thing), [[DC-136]] (the class this audit measured, and the
sixteenth site it was for), [[DC-124]] (an instrument whose subject is not
present is an instrument that reports nothing — the same failure direction).

**DC-138 — a summary computed from what the run PRODUCED cannot report what it
FAILED to produce (2026-09-22).** The screenshot sweep ends on one line:
`SHOTS OK — <n> frames, <m> findings`. Both numbers are counts of frames that
were TAKEN — `n` is the length of the frame list, `m` the findings inside it —
and the sweep is documented as „three window sizes plus maximised". That fourth
capture is a REQUEST rather than a setting: `win.maximize()` asks the window
manager, and it lands by luck — one of four runs on 2026-09-03 wrote it, both of
the two before the retry refused, the four after it wrote it, and the next one
refused again. A refusal takes no frame
and writes its reason to stderr, which is the honest answer from the layer that
knows. The headline above it was byte-identical to a clean full pass's, and the
headline is what a reader takes away: a run that covered three of its four
declared sizes reported success in the one artefact built to report.

*Root cause:* **the denominator came from the output rather than from the plan.**
A count of what was produced is silent about production that did not happen,
because the missing frame is missing from the numerator *and* from the total —
there is no shortfall to be short BY. Nothing was miscounted; every number in
that line was true. The claim it appeared to support — „the sweep ran over its
full sweep" — was made by the sentence wrapped around the numbers, and nothing
derived that sentence from the frames.

*The tell:* **a summary whose every number counts an artefact, standing in for a
statement about coverage.** The question to ask of any such line is where its
DENOMINATOR comes from. `14/14` for the linters is safe because the fourteen is
`package.json`'s and is read before the run; `2 839 frames` is not safe, because
2 839 is whatever came back.

*Fix:* assert the claim from the artefact. `missingCoverage(frames)` reads the
frames themselves and answers which declared size is absent, and the headline and
`report.md` name it (`, NO maximized frame (the window would not maximise)`). It
is deliberately quiet about a subset run — one scene or one size, chosen by env
var, never claimed the fourth capture — because a warning that fires on every
forty-second subset run is the noise [[DC-124]] records being switched off. The
same principle is why `check:copy` exports its CENSUS beside its verdict: „found
nothing" and „looked at nothing" must not be the same green line.

*Related:* [[DC-17]] (a skip and a pass byte-identical to a reader — the same
blindness one layer up, where the thing that did not happen was a scan rather
than a capture), [[DC-57]] (a fixture that cannot reach a state, so the surface is
never photographed — the same absence, reached by a different route), [[DC-99]]
(an instrument whose coverage follows something other than its declared subject),
[[DC-129]] (a coverage cap spent in silence — the same shortfall arriving through
a budget).

**DC-139 — a marker written on the arms that have something in them, so the state
with nothing in it is the one the instrument cannot see (2026-09-22).**
`data-nx-content` names the region a module IS: `shots/audit.ts` measures it
against the window (`below-fold`) and asks whether it holds nothing but an empty
state under a non-zero figure (`hollow-fixture`). The first of those rules was
written FOR a page whose list had been pushed off screen, so it is easy to read
as a claim about a LIST — and on DOKUMENTI it was written on the list: the
attribute sat on `.doc__list` and `.doc__grid`, and both elements are returned
only when there ARE entries. A profile with no file in it therefore carried no
region at all, and the emptiest state of the page was the one state of it the
audit could not see. STUDIJA had the same shape one arm over — the marker on
`.study__subjects`, drawn only when a subject exists, so the landing a profile
with nothing in it actually opens was the unmeasured one.

*Root cause:* **the claim was attached to the arms that had content rather than
to the region across all of its arms.** Every arm of that conditional draws the
SAME thing — the module's content area: the rows, or the empty state standing in
for them. Writing the marker once per row SHAPE, and never on the stand-in, made
the attribute a property of „has rows" instead of a property of the page, and the
two states it left out are the two nobody would ever screenshot for a bug report.

*Why nothing could see it.* The failure direction is silence — the shape this
ledger keeps meeting ([[DC-36]], [[DC-17]]): a sweep over the empty page
photographs a well-formed landing, scores it clean, and prints exactly what a
sweep over a correct page prints. `contentMarkers.test.ts` exists for the other
half of that blindness, a DELETED marker, and it did not catch this one either —
the marker was there, and it was counted. **The census is a count of WRITINGS,
and DOKUMENTI's number did not move when the fix landed** (two row shapes in one
arm became one box written in two arms, 2 → 2), which is the honest statement of
what a count can hold: the reason beside each file carries the claim, and the
number only says that somebody edited a line on purpose.

*Fix:* **one box per content region, written in every arm, with the populator
outside it** (`.doc__rows`, and `.study__subjects` in its second arm). Outside is
not tidiness: a region that CONTAINS the band can never be `hollow-fixture`'s
sole-empty one, so a wrapper drawn around the figures and the rows alike would
have bought `below-fold` at the price of the other rule. `.tasks__rows` was the
pattern; the three pages now read the same way.

*And the boundary, which is worth more than the fix.* NAVIKE is NOT in that list
and must not be: its marker is on „Danas", drawn behind `!noHabits`, and with no
habits the page drops its whole middle and answers in the register's landing — a
box that exists in both states and is deliberately left unmarked, because it is
the module's archive and is legitimately below the fold. Nothing there is
unprotected: `below-fold` has no subject to measure on a page that has none, and
the band is guarded on the same condition, so `hollow-fixture` has no figure to
contradict. **So the rule is not „mark every empty state". It is: a region the
page draws in every state keeps its marker in every state, and a state that
abandons the region is a DECISION — which has to be written down**, in the file
that carries the census, because „deliberate" and „forgotten" are otherwise the
same three missing lines.

*Related:* [[DC-138]] (a true number standing in for a claim it does not support
— the same lesson about counts, one layer up), [[DC-109]] (a hand-kept list
beside a generated one; this census is hand-kept on purpose), [[DC-124]] (the
rule the marker exists for: a figure contradicting an empty region),
[[DC-36]] (silence and a pass looking identical).

---

**DC-140 — a required step that every site performs by hand is a step the site
written from scratch omits, and a missing line is the one thing a reader cannot
compare against its neighbours (2026-09-22).** `nx_fold` is a SQL function the
search index cannot be written without — every projection view calls it to fold
Serbian diacritics — and a connection that has not registered it cannot insert a
row. **Twenty** test helpers opened a database and registered it on the next
line. The twenty-first, `upgrade()` in `migrations.test.ts`, did not, and it had
been right when it was written: no migration above 64 used the function. The
migration that added the tenth search kind made that false, and the failure
arrived as `SqliteError: no such function: nx_fold` from five tests about 065 —
the tests where the search LANDED, not where the defect was.

*Why this is not [[DC-113]], which it looks like.* A copy can be counted; a
missing line cannot. Each of the twenty had been copied from a neighbour, so
each carried the line without anyone deciding to. The one written from nothing
inherited nothing, and its defect has no shape — the body is not wrong, it is
SHORTER.

*Root cause, as the rule that was wrong:* „opening a database" was treated as
`new Database(path)`. It is not: it is that, plus the pragmas, plus the
registered functions, and only the first third was in a constructor.

*Fix:* `prepareConnection(db)`, exported from `packages/db`, is the whole of that
preparation, and `openDatabase` is its first caller rather than its only one.
The wrong answer is not caught, it is unrepresentable — the app's database is
opened in one file and that file calls the one function.

*Why no gate, and this is the judgement rather than an omission.* A gate would
have to forbid `new Database(` outside `packages/db`, and `apkgReader.ts` opens
an untrusted archive's SQLite image with `{ readonly: true }` — a genuinely
different job, for which that constructor is the right one. A rule that needs an
allowlist on the day it is written is the wrong shape on [[DC-113]]'s reasoning,
and the structural fix has already removed the exposure it would guard.

*Related:* [[DC-02]] (a rule written twice begins to drift), [[DC-05]] (a
decision repeated at every call site belongs in a component), [[DC-113]] (the
same duplication where the copies ARE countable).

**DC-141 — a closed vocabulary declared twice, where the second declaration
carries a comment vouching that the copy cannot drift (2026-09-22).**
`SearchKind` lived in `@nexus/core` and again in `apps/desktop/src/shared/ipc.ts`
under a note saying the copy „cannot drift silently". It can, in one direction —
and it is the direction nobody reaches by accident. A kind added to the WIRE and
not to core compiles: the wire's union is what the renderer's `switch` narrows,
while core's is what the store ranks and what the alias table is keyed by, so
the app would answer searches with a kind its own ranking had never heard of.
The reverse, core widened and the wire not, fails at the first assignment — which
is the direction that cannot happen quietly and the only one the comment was
describing. **The copy was load-bearing exactly where it was redundant, and
invisible exactly where it mattered.**

*The rule:* [[DC-02]] one turn further — **the sentence that asserts a
duplication is safe is the thing that stops anyone checking it.** „These two
must stay in step" beside two declarations is a promise no compiler reads;
importing the type is the same intent with nothing left to keep in step. This is
why the entry is not simply „declare it once": the defect needed the comment.

*Fix:* `ipc.ts` re-exports core's type (`export type { SearchKind }`), and it was
proved by the tenth kind — adding `circuit` to core alone compiled everywhere,
and the narrowing the old copy would have forced is exactly the `TS2322` that
appeared in `main` the moment core grew.

*Related:* [[DC-03]] (a mirror of a private number), [[DC-142]] (the union that
grew while this copy sat beside it), [[DC-69]] (a comment stating a guarantee
that only an invariant nothing declares can keep).

**DC-142 — a `switch` over a closed union with no arm at the end, so a member
added later is handled by falling out of the statement (2026-09-22).**
`onSearchResult` in `App.tsx` opened a search hit by its kind: nine `case` arms,
no `default`. Nothing about that is wrong while the union has nine members. A
tenth arrived, every arm still compiled, and a hit of the new kind would have
been a result the user can SEE in the palette and cannot open — the failure
direction this ledger keeps meeting ([[DC-36]]). The type system's
exhaustiveness guarantee is a property of an EXPRESSION position, a function
that must return a value; a `switch` used for its side effects is a statement,
and falling out of it is legal.

*The rule:* where a closed union is switched on for its effects, the last arm is
`default: assertNever(x)`. One line converts „a kind nobody wrote an arm for"
from silence into a build failure — and it is the only place the compiler can be
made to say anything, because a `case` that is missing is not an unused symbol,
an unused import or an unreachable branch.

*Fix:* `assertNever(value: never): never` at module scope in `App.tsx`, and the
switch's `default` calls it.

*Related:* [[DC-43]] (a union widened without its table being widened compiles),
[[DC-141]] (the duplicate union that hid the same growth), [[DC-36]] (a failure
whose shape is silence).

**DC-143 — a lazy boundary that one static import defeats, and nothing fails
when it does (2026-09-26).** Splitting the renderer by page made every page an
`import()` in `routes.tsx`. Two static imports would have kept the work from
doing anything, and neither would have failed a build, a test or a screen.
`App` and `NotesPage` imported `PRIV_LOCKED_EVENT` — one string constant — from
`PrivPage.tsx`, and a value import of a module is an import of all of it, so the
private-notes page would have ridden along with whichever chunk the importer
landed in. And `Onboarding` imported two functions from `@nexus/core` that it
calls once per profile, ever, which kept Yjs and the markdown importer — about
270 kB — in the startup chunk after every page had left it. Vite warns about
the first shape, a module both imported and `import()`ed, in a build log nobody
is made to read. About the second it says nothing at all, because nothing is
imported both ways: it is a dependency the startup path reaches for a reason no
one would guess from the name of the file doing it.

*Root cause, as the rule that was wrong:* „this module is loaded lazily" was
read as a property of the `import()` that names it. It is a property of the
whole static graph from the entry — a module is lazy only while nothing on the
startup path imports it by value, and a constant is an import.

*Fix:* the constant lives in `privEvents.ts`; the welcome note reaches its two
functions through `import("./markdownNote.js")`, a module of the app's own,
because `@nexus/core` is already imported statically and a dynamic import of it
moves nothing. `routes.test.ts` is the gate for the first shape and the named
half of the second: it walks the static value-import graph from `main.tsx` in
source (`import type` is not an edge) and fails if that graph reaches any module
the renderer `import()`s, if any `…Page.tsx` file is not loaded lazily — derived
from the directory, not listed — or if the startup path imports Excalidraw,
KaTeX, TipTap, ProseMirror or Yjs directly. What it cannot see is a package
reached THROUGH `@nexus/core`'s barrel, which is exactly how Yjs arrived; that
one was found by attributing the built chunk's bytes through its sourcemap, and
that measurement is the instrument for the unnamed half.

*Related:* the type-only `LicenceEntry` import in `SettingsPage.tsx`, which
stated this rule in a comment the day the licence notices became a chunk — a
comment and not a gate, so it covered one file; [[DC-36]] (a failure whose
shape is silence).

**Still open in C, and the only part of it that is:** item 14 (Tasks' capture
form — its four bare selects are fixed, see DC-05), item 15 (Focus's two side-by-side primaries,
the calendar's byte-identical stacked switchers, Files' two contradictory
selection idioms — the canvas board bar was fixed with the board library in
`9cd3267`), and item 16 (spacing: Settings' uniform 12 px gap, four different
values for „space between page sections" — **fixed in `5ba4ecf`** — and the
caption class, which the audit below corrects).

**ITEM 16'S CAPTION CLAIM WAS OVERSTATED, and an inaccurate record is worse than
an open one.** „One caption class doing four jobs across ninety call sites" was
written from a grep. Counted properly on 2026-08-07, `set__section-caption` has
**122 uses across four files** — and **116 of them are `<p>` elements doing ONE
job**: a hint paragraph under a heading or a control. Of the six `<span>` uses,
four are hints beside a field and **two were the real defect**: the CSV
delimiter block, duplicated verbatim in `SettingsPage` and `FinCsvImport`,
wrapped its select in a `<label>`, put the name in a caption `<span>` inside it,
AND repeated the same string as an `aria-label` — three declarations of one name,
two of which could drift from the third. Both are `Select` now. What remains is
not four jobs; it is one job with a name that describes a section rather than a
hint, which the overhaul can rename in one pass.

**THE FONT QUESTION IS NOW THE FOUNDER'S** (2026-08-07). The scale is fixed, and
the family it renders in is a deterministic system stack — which is honest, and
which is also the most generic possible choice on Windows. Bundling a
self-hosted OFL family would cost nothing procedurally (ADR-080 already
generates notices by reading each licence off disk, and the installer already
ships eight families through Excalidraw), but it needs either his `.woff2` files
or his authorisation to fetch one. Recorded rather than decided.

**What is deliberately NOT in this plan:** a redesign. The founder's verdict was
that the app reads raw, not that it reads wrong. Every item above is a defect
against the design rules already written down, so none of it needs a new
direction, and none of it should wait for one.

**Not blocking (being managed):**
- **CANV's open items, from the engine landing** (2026-08-01, ADR-079 §11.8):
  1. ~~**The eight bundled font licences were never verified**~~ — **done
     2026-08-01** (`29bb6c7`, [ADR-080](architecture/adr/080-third-party-notices.md)):
     the notices are generated by reading each one off disk, seven families
     resolve from their own `.woff2` metadata, and **Liberation Sans is dropped**
     because its licence cannot be established at all. 320 packages get their
     notices too. This was the last release blocker ADR-079 left open.
  2. ~~**Excalidraw sits in the eager chunk**~~ — **closed 2026-09-26**: every
     page is its own chunk and Excalidraw arrives with the canvas route; see
     [log/2026-09.md](log/2026-09.md), „Every page is its own chunk". The
     original note, as written: +1.67 MB at app start, on a page
     most users open rarely. `React.lazy` would defer it; the cost is a loading
     state on a route that currently has none, so it is a deliberate follow-up
     rather than an oversight. The renderer's eager chunk is **6,080,364 bytes
     — 5.8 MiB raw, 1.25 MiB gzipped** (measured on the 2026-08-06 build; the
     build emits 129 JS chunks, but every one of them comes from a dependency's
     own dynamic imports — Nexus's renderer contains exactly one `import()`).
     Route-level splitting would be one lane's work for the whole app rather
     than only for CANV.
  3. **~9.9 MB of lazy mermaid chunks ship in the installer.** They load only
     when a diagram is actually converted, so they cost disk and download rather
     than startup. The founder chose to keep mermaid (*„treba nam i za dev
     tools"*), and this is what that choice weighs.
  4. **The canvas toolbar has not been seen running** (2026-08-01, `278e6ad`).
     It is a wrapping horizontal bar under the board bar, and with eleven Serbian
     tool names — „Pravougaonik", „Pomeranje", „Strelica" — it will take two rows
     on a typical window, which makes three stacked bars above the drawing.
     Every part of it was reasoned about and tested; none of it was looked at.
     If it reads heavy, the left-hand rail every canvas application uses is the
     obvious next move, and nothing in the code resists it — `CanvasToolbar` is
     one component with its decisions in a separate pure module.
  5. ~~**Electron's Chromium/Node notice path is unconfirmed**~~ — **confirmed
     2026-08-16** (ADR-080 §7). The „Licence" card states that Chromium's and
     Node's own notices ship as `LICENSES.chromium.html` beside the executable.
     That was true of how electron-builder packages an Electron dist, but no
     `pnpm dist` run had ever been *watched* to confirm it. One was:
     `release/win-unpacked/` holds `LICENSES.chromium.html` (19 890 KB) and
     `LICENSE.electron.txt` next to `Nexus.exe`, and NSIS ships that directory
     whole. The notice text is a claim the product is entitled to make.
- **The Ctrl+1–9 sidebar family now has more modules than digits** (noted
  2026-08-01, when HABIT registered as the ninth visible module). ADR-040
  reserves Ctrl+1–9 for the sidebar in its own order, so a tenth enabled module
  — which happens as soon as a user turns PRIV on — simply gets no chord. This
  is derived, not printed: the F1 reference, the sidebar badge and the search
  hint all render the LIVE bindings, so nothing on screen ever names a chord
  that does not work. It is a limit rather than a defect, recorded because the
  module count crossed it this week and the next module will make it ordinary
  rather than exceptional.
- **Electron pinned to v42** — v43's ABI has no prebuild for the encrypted-SQLite
  native module. Managed (Dependabot ignores electron majors). Revisit when a
  prebuild exists.
- **Native-ABI flip dance** — Vitest (node ABI) and the dev/smoke/dist app runs
  (electron ABI) still need different builds of the SQLite binary; repo scripts
  handle the flip (now shared by `dist` too, which always restores node ABI on
  exit — success or failure). The **packaged installer** bundles a fixed
  electron-ABI binary fetched once at package time, so end users never see this;
  it stays a repo-local dev/test detail.
- ~~No ESLint baseline yet~~ — **done 2026-07-30** (`8e83854`, Lane J): one
  root flat config (eslint 9 + typescript-eslint *recommended* — deliberately
  not the type-checked presets, lint stays a fast syntactic pass beside
  `typecheck` — plus only the two classic react-hooks rules; v7's full preset
  is the React Compiler family, its own arc), per-package `lint` scripts, a
  turbo task with the config as a global dependency, and a `pnpm lint` step in
  CI verify. `no-explicit-any` is ON everywhere — the tree contains not one
  `any`. Three documented `exhaustive-deps` warnings stand as designed
  (per-profile subscription, intent effect, re-measure-every-render layout
  effect). eslint 10 is a deliberate one-line follow-up when wanted.
- **Encryption-at-rest is ON** (2026-07-26, ADR-018 + ADR-019) — the database
  opens only under a passcode-derived key, and attachment blobs are AES-256-GCM
  containers keyed off that same data key. The **export archive is encrypted
  too** since 2026-07-28 (ADR-022, `NXA1` under an export-time passphrase), which
  closed DEV-002. One thing remains plaintext, deliberate and recorded rather
  than hidden: a file **opened in an external program** (a decrypted copy under
  `<userData>/tmp-open`, wiped on every lock and at every launch — Word cannot
  read anything else).
- **Doc fix** — the CAL PRD §8 acceptance example ("registracija, 45 days → 'soon'")
  assumes an old 60-day reminder ladder; the founder-confirmed ladder is 30/14/3, so
  45 days out is correctly "ok". The code follows the confirmed ladder; the PRD line
  should be corrected.

**Resolved by the founder (2026-08-06 — the three questions the polish arc was
blocked on):**

- **Icons: we draw a small set ourselves (~24), and no library.** The app is
  today almost entirely typographic — the ✦ brand glyph and nothing else — which
  is part of what reads as unfinished. The answer is an inline-SVG set in our own
  tokens, scoped to **navigation and primary actions only**, not a general icon
  system: a third-party set (Lucide, Phosphor) was rejected because it is both an
  exception to the no-new-dependency rule and the fastest way to make Nexus look
  like every other app. This is its own piece of work inside P1-C and it is
  sized deliberately — 24 icons that are right beat 300 that are generic.
- **The canvas background always follows the theme.** *Dan = light, Noć = dark,
  with no per-board override at all.* `viewBackgroundColor` therefore stops
  being a persisted scene value: it is **never written into a saved board** and
  is always derived from `--nx-bg` at render time. The user cannot choose a
  board background, which is the point — a stored colour is exactly what made a
  board built in Dan stay white under Noć. Closes defect 3 above.
- **Space Grotesk: the founder supplies the files.** *(BLOCKING for the type
  scale — everything else in P1 proceeds without it.)* The design brief
  committed to self-hosting it and it was never done; there is no Space Grotesk
  anywhere in the repo, and it cannot be fetched (no network, and it would be a
  new asset). What is needed, exactly:
  - `packages/tokens/assets/space-grotesk-{400,500,600,700}.woff2`
  - **`latin-ext` subset, not `latin`** — plain `latin` has no š/č/ć/ž/đ, and
    every string in the app is Serbian.
  - the family's licence file (SIL OFL 1.1) beside them, so the generated
    third-party notices can read it off disk the way ADR-080 requires.

  Until they land, the type scale is fixed *as a scale* (item 11) against the
  current stack, and swapping the family in later is a token change, not rework.

**Resolved by the founder (2026-08-01 — currency):**
- **Nexus never converts between currencies.** *„Što se tiče valuta, nema
  konverzije, beleži se posebno svaka valuta."* Raised because the UTIL brief
  told a lane to build a currency converter „on the NBS rates the user already
  entered in FIN" — and **FIN holds no rates and refuses to**, deliberately and
  loudly: migration 051 (*„a stale invented rate is worse than no total at
  all"*), `transactionStore`'s throw on cross-currency transfers, a wire that
  „makes asking for one impossible rather than merely discouraged", and the
  Serbian copy the user actually reads — „Prenos ne može da pređe iz jedne valute
  u drugu — **Nexus nema kurs**." The lane refused to overturn that quietly and
  was right to. The founder's answer makes FIN's inherited refusal a **product
  decision**: multi-currency means each currency tracked on its own terms, and
  there is no rate table, no FIN entry screen and no converter coming. The
  currency converter is therefore **permanently out of the tool drawer**, with no
  seam left for one — no placeholder tool kind, no disabled entry, no „uskoro" —
  because a future reader must not mistake a decision for an unfinished feature.
  The SPECIFICATION line promising UTIL „unit and currency converters" is
  corrected to match.

**Resolved by the founder (2026-08-01 — the wave-40/41 batch):**
- **The Ctrl+1–9 limit stays as it is.** *„Ma ne moraš da širiš."* The family is
  not extended to a tenth chord, no `Ctrl+0`, no `Alt+digit` overflow row. The
  limit above therefore stops being an open question and becomes a documented
  property: the first nine sidebar modules get chords, the rest are reached by
  clicking or by search. Nothing on screen names a chord that does not exist, so
  there is nothing to fix.
- **CANV uses Excalidraw if it is technically possible.** *„Excalidraw ako je
  moguće."* This is an explicit, scoped exception to the no-new-dependency rule
  — for this one library, for this one module. It is conditional on a spike
  (run 2026-08-01) proving four things: React 19 compatibility, that it can be
  made to fetch **absolutely nothing** from the network, a licence with no
  attribution obligation binding a commercial closed-source product, and that it
  does not force `unsafe-eval` into the CSP or raw hex into our own `src` tree
  (the colour grep gate). If any of those fails, the fallback is a custom canvas
  and the founder is told which fact killed it.
  **The spike ran the same day and returned GO WITH CONDITIONS** — see
  [architecture/adr/079](architecture/adr/079-canvas-engine.md). All four
  conditions pass: React 19 is a real peer (not a lag), MIT with no attribution
  obligation, no `unsafe-eval` on the render path, and no hex in our source. Two
  findings reshaped *how* we take it, and neither needed a founder ruling
  because binding rules already decided them: **Excalidraw has no Serbian locale
  and cannot be given one** (a closed, hard-coded import map; `setLanguage` is
  not even exported), and **its colour picker hard-codes violet/blue/orange**
  with no palette prop. Both are answered by shipping it in zen mode **with our
  own Serbian toolbar** — Excalidraw becomes a canvas engine, not a user
  interface. That is the cheap direction: the engine (arrow binding, transforms,
  freedraw, undo, hit-testing) is the hard part and we keep it; a toolbar is
  buttons in our own tokens and strings. **Two open risks carried into the
  build:** `security.yml`'s `pnpm audit --prod --audit-level low` blocks on
  *every* severity with no ignores, and the transitive dependency count could
  not be measured without installing — so a single low advisory anywhere in the
  tree becomes a founder decision, and it is the first thing the CANV lane
  reports. And the `file://` + custom-scheme font load is reasoned from code,
  not observed; it gets smoke-tested before anything is built on it.
- **FIT's food data: we build it ourselves and licence nothing.** *„Nećemo ništa
  da licenciramo, šta oni nađu to je, pa korisnik može da unosi svoje podatke ako
  mu nešto fali."* So: parallel agents assemble the catalogue from **public-domain
  sources only** — USDA FoodData Central is the backbone — with every entry
  carrying its provenance (`usda` / `official` / `derived`, the latter publishing
  its full recipe and per-component sources so the arithmetic is re-checkable).
  Open Food Facts is deliberately **excluded**: ODbL's share-alike is exactly the
  licence obligation this answer rules out. Whatever cannot be sourced is
  **dropped and reported**, never guessed — the no-fabricated-data rule bites
  hardest here, because these are numbers people eat by. Branded Serbian retail
  products are not scraped; the catalogue ships the generic food and the user
  adds their exact brand, which the founder named as the intended behaviour
  rather than a gap. This unblocks FIT, which §4 had recorded as blocked on
  licensing.
- **Order of the remaining modules is mine to plan.** *„Isplaniraj se i kreni
  redom, maksimalna paralelizacija posla, nema praznog hoda… nemoj ništa ofrlje,
  sve mora da bude maksimalno ispolirano."* Planned order: **FIT** and **UTIL**
  in parallel (both start as pure data layers, so they collide only on the
  migration index and the interchange version — both pre-assigned), then their
  UI slices, then **CANV** on the spike's verdict, then **VLT** last (it is the
  spec's only *Later* item among these and it rides PRIV's existing crypto).
  UTIL leads with the **focus timer**, because "sustainable productivity" is a
  *Must* in the spec and STUDY explicitly deferred its Pomodoro here — the
  converter/calculator drawer is the *Could* half and follows it.

**Resolved by the founder (2026-07-31 — the full 23-question batch, answered by
number; verbatim answers kept in the session log):**

1. **No-PIN account deletion (ADR-048)** — confirmed as shipped.
2. **Windows Hello** — "investigate; add only if it is not a big deal." The
   feasibility recon ran the same day; verdict: **it is a medium-sized deal
   today, so skipped**, with named revisit triggers recorded under DEV-003 in
   `docs/deviations.md` (WebAuthn-PRF is the one real route; it becomes cheap
   the day the renderer moves to an https-style origin for the web).
3. **DEV-004 (Anki media stripped)** — confirmed; the per-kind named counts
   already answer the founder's one ask (user must see what was skipped).
4. **SEC-FILE-01 tension (in-main .apkg parsing)** — founder did not engage
   ("Ne znam sta me pitas"); decision delegated to engineering, recorded as
   DEV-005 (accepted, with revisit trigger).
5. **PRIV private notes** — GO, and it must work both offline and later on the
   web app → the crypto design must be WebCrypto-portable. Terrain recon ran
   2026-07-31; ADR next.
6. **Business profile** — a SEPARATE profile kind, reusing whichever existing
   modules make sense. Needs its own recon + ADR arc.
7. **DASH-008 named dashboards** — "idi ADR": write the ADR and build it.
8. **Task priorities** — stay 4 (none/low/medium/high).
9. **Završeno auto-archive** — YES, completed tasks age out of Završeno into an
   archive. Design + ADR-lite, then build.
10. **Semester view** — FIXED semester dates (a setting), not the sliding
    window. Design + build.
11. **21-day card-maturity threshold** — confirmed.
12. **blockTotals vs adherence exam join** — unify BOTH through active exams
    (dispatched as a fix 2026-07-31).
13. **Anki schema-18 (.anki21b)** — build it (dispatched 2026-07-31).
14. **LLM-import gaps** — "upgrade whatever you think is smart" → persisting
    kind/language, a „Novi špil" path, and a real duplicate-events choice
    (dispatched 2026-07-31).
15. **SET-011 scheduled backups** — design delegated ("kako ti mislis tako
    uradi"). ADR next.
16. **Gold as the warning hue in callouts** — confirmed (visual check still
    welcome in both themes).
17. **Week-number label** — „ned." (dispatched 2026-07-31).
18. **ICS: no VALARM + UID domain `@nexus.stojiljkovic.rs`** — both confirmed.
19. **Gendered copy** — answer was a bare "Da" to an either/or question;
    INTERPRETED as "masculine stays as the unmarked form" (matches precedent
    and the least-work reading). Flag: if the founder meant "rewrite neutral",
    this line is the record to overturn.
20. **BF placements (root-view control on Beleške card; duration under
    Izgled)** — confirmed.
21. **Deck chip shown on „Uči sve"** — confirmed.
22. **Foreign import must NOT rearrange the dashboard** — copy-the-layout
    behaviour removed (dispatched 2026-07-31).
23. **Releases repo + code signing** — later, when the feature set is fuller.

**Resolved by the founder (2026-07-26):**

- **Forgotten passcode → a Recovery Kit code, not the OS credential**, and the
  **minimum passcode is 8 alphanumeric characters** (raising AUTH-004's "4
  digits"). Both are implemented; the reasoning, and why this is a deviation
  from SEC-LOC-03, is in [deviations.md](deviations.md) **DEV-003**.
- **Product name: `Nexus` stays** — "za sada ostaje Nexus". Vesper is no longer
  the working candidate; the name is settled for the current phase, and a
  trademark/domain check only becomes a question if distribution starts.
- **`nexus-releases` repo and code signing: "videćemo"** — no change; both stay
  where the 2026-07-12 decision left them (later / not yet).
- **FIT food database: open data only, nothing licensed.** The direction is now
  explicit: **ingest every open-source food dataset we can** (as many as
  cover our needs, combined), and **self-scrape only what no open dataset
  covers** — the Serbian retail assortment. Nexus will **not buy or license**
  a commercial food database. *To settle at FIT kickoff, not now:* which open
  sets we actually take and under which terms — open ≠ unconditional, and
  Nexus is a commercial product, so each set's licence has to be read before
  it is ingested (a public-domain government set and a share-alike community
  set impose very different obligations on a paid app). The 2026-07-05
  retailer-ToS scraping risk below still applies to the self-scraped part.

**Resolved by the founder (2026-07-12):**

- **NOTE editor direction: "like Notion, but with simpler UX so the user finds
  their way more easily."** This is the design brief for the block editor —
  Notion-family block model, deliberately reduced surface (fewer block types,
  fewer affordances, obvious controls). Editor-kit choice and v1 block set are
  delegated to Claude within this brief (ADR to follow).
- **DEV-001 (token generator) and DEV-002 (unencrypted export until AUTH)
  confirmed** — statuses updated in [deviations.md](deviations.md).
  *DEV-002 was **closed** on 2026-07-28 when the encrypted export shipped; no
  deviation is open now.*
- **8-accent palette delegated to Claude** ("ubaci šta misliš da treba") within
  the standing bans (no purple/violet, no blue, no orange).
- **Unbuilt modules are hidden** from the Settings module gallery (and the app
  generally) until they exist — approved; nothing in the app may lead nowhere.
- **Product name: still undecided** (Vesper remains the candidate).
  *Superseded 2026-07-26 — the name stays `Nexus`; see above.*
- **`nexus-releases` repo: later. Code signing: not yet.**
- **FIT food database (for later, when FIT starts):** founder direction is to
  self-scrape what we can for the Serbian retail list. Note when FIT begins:
  research (2026-07-05) flagged retailer-ToS/legal risk on scraping (Ryanair
  ToS-as-contract precedent) and recommended label-photo submissions + open
  datasets; reconcile the two at FIT kickoff. *Extended 2026-07-26 — open
  datasets are now the primary source and scraping the fallback; see above.*

**Resolved by the founder (2026-07-10):**

- **STUDY: catch-up replan → yes, with no daily cap.** Missed blocks' minutes are
  redistributed onto the remaining planned days when plans sync; a missed block
  later marked done (late completion) returns its minutes to the normal schedule
  on the next sync.
- **A failed plan restore gets a visible message** (Serbian, in the undo-toast
  area) instead of the console-only idiom the other restore paths use.
- **A study widget on the dashboard** (streak + today's focus minutes,
  deep-linking into the study page) is approved.
- Working mode confirmed: after this follow-up slice, remaining modules proceed
  **one at a time** (plan review done 2026-07-10; NTF first — see §3).

**Resolved by the founder (2026-07-07):**

- **Next module → STUDY** (built completely; see §3).
- **Notes storage substrate → Yjs/CRDT from the start** when NOTE is built (follows
  [architecture/adr/001](architecture/adr/001-local-storage-engine.md); no later
  migration). This is the plan of record for NOTE.
- **Encryption-at-rest → bundled with the AUTH module** (passcode-derived key +
  OS keystore). **Done 2026-07-26** per
  [architecture/adr/018](architecture/adr/018-local-account-passcode.md).

**Still open (non-blocking; awaiting founder):**

- Review the new **[../CLAUDE.md](../CLAUDE.md)** to confirm it captures preferences.
- **RELEASE: update-feed hosting** — the publish config already points at
  `lukastojiljkovic/nexus-releases` (GitHub provider) and the in-app update check
  ships, but that repo doesn't exist yet, so every check currently no-ops (logged,
  benign). Founder 2026-07-12: **later.** The founder-side checklist stays in
  [ops/github-setup.md](ops/github-setup.md).
- **RELEASE: Windows code signing** — the installer builds and runs unsigned;
  SmartScreen will warn on other machines. Founder 2026-07-12: **not yet** —
  ship unsigned until distribution matters.

---
