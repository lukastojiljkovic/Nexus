# ADR-086 — „Priprema": four organic questions that compose a different app

**Status:** accepted (2026-08-23) · **Owner:** supervisor · **Supersedes
ADR-065 §3–§4** (the „Tvoja nedelja" and „Šta ti treba?" checkbox screens),
which survive as the manual override rather than as the first-run path.

**Founder, 2026-08-23:** *„aplikacija FUNDAMENTALNO treba da izgleda drugačije
za različite korisnike, i da to ne dobijaju tako što će da idu kroz neograničeno
checkboxova… nego da su pitanja prirodna i organska… da stvarno kada neko popuni
formular bude app kao da je pravljena za njega, znači ako misliš da treba da se
doda neki feature, nešto da se izmeni promeni, uradi to."*

---

## 1. The finding that reframes the request

The complaint names the questionnaire, and the questionnaire is the smaller
half. ADR-065's flow asks **thirty-two checkboxes** — eighteen toolkits and
fourteen modules — of somebody who has not yet seen the product. That is real,
and it is fixable with better questions.

**The larger half is that better questions would have nothing to drive.**
Everything ONB can decide today is a `feature_flags` row: which modules are on,
which packs are on. Every other surface is a constant for every user on earth:

- `DEFAULT_DASHBOARD_LAYOUT` is five fixed cards, and two of them are
  `study:ispiti` and `study:ucenje` — **a bricklayer's home screen leads with
  two cards about exams.** Nothing in the questionnaire can change that, because
  nothing has ever written a `dashboard_widgets` row at profile creation.
- The sidebar is in registration order, always.
- Every module opens on the same sub-view for everybody.
- The per-profile accent (`nexus.accent.<id>`) exists and is never chosen.

So „the app looks the same for everyone" is not a consequence of the
questionnaire being coarse. It is a consequence of there being **no artefact
between the answers and the app**. This ADR introduces that artefact.

## 2. The plan is the artefact

A **`ProfilePlan`** is the complete description of one person's Nexus, derived
from a handful of signals by a pure function in `@nexus/core`:

```
signals ──buildProfilePlan()──▶ ProfilePlan ──apply──▶ flags · widgets · prefs
```

`ProfilePlan` carries the module decision, the packs, a composed board, a pinned
sidebar shortlist, a week shape for the accent, the calendar's opening view —
**and a `reasons` list, where every decision names the signals that caused it.**
The reasons are not documentation. They are the content of the „Evo tvog
Nexusa" reveal and the content of the Settings card that lets a user see why
their app looks the way it does. A decision with no reason is a decision the
product cannot explain, and this shape makes that unrepresentable.

It names a week SHAPE rather than a colour, because `@nexus/core` does not
depend on `@nexus/tokens` and must not learn to: which eight accents exist is
the design package's business, and the renderer looks one of them up
(`ACCENT_FOR_SHAPE`). Notification appetite is deliberately NOT in the plan —
NTF-008 owns that question and its own write path, and putting it here would be
a second author for one setting.

**Four laws, each a test:**

1. **No signals ⇒ today.** `buildProfilePlan([], registry, base)` answers with
   `base` — no packs, no board, no pins, no accent, no view. The base is passed
   in rather than imported, which is what keeps this honest: with nothing to
   merge the answer IS what the profile already had, so „the questionnaire was
   skipped" and „the questionnaire was never built" produce the same app.
   „Preskoči" therefore costs a user nothing.
2. **Total over the registry.** Every selectable module appears in
   `plan.modules`, decided — never inherited. This is ADR-065's
   `ESSENTIALS_MODULE_PRESET` rule carried forward: a module registered without
   anybody deciding its place fails a test.
3. **Every board entry is drawable.** A widget id that no manifest publishes, or
   whose owning module the same plan turned off, is a defect the builder cannot
   emit — the board is filtered THROUGH the module decision, not beside it.
4. **Every reason names at least one signal, and every non-default decision has
   a reason.** The reveal screen is then generated rather than written, and
   `profilePlanCopy.test.ts` asserts the other half: a plan built from every
   answer the flow can produce yields exactly as many sentences as it has
   reasons.

## 3. The questions, and why these

Six screens: a name, four questions about the PERSON, and the once-ever
notification question NTF-008 already owned. No screen names a module or a
pack. Every screen has at most six options.

| # | Screen | Shape | What it decides |
| --- | --- | --- | --- |
| 1 | **„Tvoj Nexus"** — name + theme | one field | nothing about the plan; the name is the completion gate |
| 2 | **„Na šta ti odlazi nedelja?"** | max 2 of 6 | the spine: which modules matter, board leads, the accent |
| 3 | **„Čime se baviš?"** | free text + 14 activity chips | packs, „Stručne alatke", trade widgets |
| 4 | **„Kako ti izgleda dan?"** | 1 of 3 | the calendar's opening view, which board card leads |
| 5 | **„Šta hoćeš da ti Nexus drži na oku?"** | multi of 5 | FIN / FIT / FILES / NOTES / PRIV, honestly |
| 6 | **„Podsetnici"** | 1 of 3 | notification sources (unchanged from NTF-008) |

Only screens 2–5 produce signals. Screen 6 answers a question the app has
always asked and writes through the channel it has always written to, and
screen 1's name is the gate `App` has always watched — so the plan is bounded
by the four questions that are actually about the person, and nothing else in
the flow had to change to accommodate it.

**Screen 3 is the one that replaces eighteen checkboxes, and it is not a
shorter list of checkboxes.** A first attempt grouped the eighteen packs into
eight cards; the founder refused it, correctly — *„nije to to."* Eight cards is
the same taxonomy with fewer boxes. It still asks a person to file themselves
under our headings, and its groupings are arbitrary the moment you read them
(„Transport i poljoprivreda" pairs a lorry driver with a farmer because we
needed the count to be eight, not because they have anything in common). Worse,
it fails closed for everybody outside the eight — a dentist, a hairdresser, a
shop manager pick nothing and learn that the product does not see them.

So screen 3 is **one line of free text with live recognition**. The person
writes „pravim nameštaj po meri" and watches the screen fill in what it
understood, as removable chips. Underneath, fourteen **activity** chips —
„Merim i sečem", „Pravim ponude i predračune", „Radim na terenu", „Držim
nastavu" — as the safety net, because an activity is something anybody can
recognise about their own week without classifying themselves.

**Recognition is a hand-written lexicon, and it has to be.** The 357 tools that
carry `keywords` carry them for settings search: they describe a tool's
FUNCTION („zadaci", „markdown", „interval"), never its user, so nothing in the
registry can turn „stolar" into `zanat`. The lexicon is therefore its own
reviewable table of Serbian trade terms mapped to packs, matched
diacritic-folded and by PREFIX — Serbian inflects on the suffix, so one entry
`stolar` covers stolara, stolaru, stolari, stolarski without four rows.

**There is deliberately no clinical entry and there must never be one.** The
`zdravstvo` pack was removed from the catalogue because intended purpose is what
makes software a medical device; a lexicon row saying „you are a nurse, here are
your tools" states the same intended purpose one level down. The ban is a test
(`recognises no clinical profession`) rather than a paragraph, because a helpful
future addition has to fail rather than merely be regretted.

## 4. What is being added to the app, and why each is required

The founder authorised feature work (*„ako misliš da treba da se doda neki
feature… uradi to"*). Each of these exists because without it the plan has
nothing to say.

1. **Four new dashboard widgets** — `files:nedavno`, `canvas:table`,
   `electronics:kola`, `pro:paketi`. The catalogue had twelve, and five modules
   owned none: FILES, TOOLS, PRO, CANVAS, ELEC. A tradesman whose Nexus is the
   tool drawer had nothing about it on his board, so his board and a student's
   overlapped far more than their lives do. PRIV deliberately gets no widget: a
   card that renders private content on the home screen is the one card that
   module exists to prevent.

   **TOOLS gets none either, and refusing it is the more useful half of this
   item.** All five manifests carried a written refusal — *a dashboard card
   draws a FACT about the profile* — and the four above turn out to satisfy it
   (a file, a board, a circuit and a set of toolkits are all rows of this
   profile). „Nedavno korišćene alatke" does not: it would draw the DEVICE's
   usage history, and it would be a second copy of the drawer's own „Nedavno"
   rail. So four manifests had their refusal rewritten to say the rule is met,
   one kept it, and `modules.test.ts` asserts all five outcomes — including the
   one that did not change, so the refusal cannot quietly erode later.
2. **A pinned sidebar shortlist per profile.** New, and a SHORTLIST rather than
   a reordering: the sidebar's categories are load-bearing (fourteen modules
   read as one flat list without them), so the plan promotes at most five and
   leaves everything else where the registry puts it. It joins the
   device-preference tier as `nexus.nav.pinned.<profileId>`, beside
   `nexus.calendar.view.<profileId>` — consistent with every other per-profile
   view preference, no migration. *Known limitation:* that tier does not sync,
   and is recorded as such.

   A full order was designed first and dropped. Five is the cap because a
   shortlist that reached seven would be half the sidebar restated above the
   sidebar — the „Alatke" mistake (a directory of the same eleven rows beside
   the eleven rows) in a different room.
3. **The board is seeded at completion.** `DEFAULT_DASHBOARD_LAYOUT` stays
   exactly what an unedited board resolves to; the plan writes explicit rows,
   which is the same „a stored fact of the profile rather than an accident of
   this build" argument ADR-065 made for module flags.

   **The writes ADD FIRST AND REMOVE AFTERWARDS**, and that order is not a
   style choice. A board with no rows IS the default arrangement, so removing
   the last placement puts the five default cards back and the next `add`
   materialises them as real rows before appending — clear-then-fill leaves
   eleven cards. Adding first never passes through zero, and the removals that
   follow take exactly the placements captured before the run.
4. **„Priprema" screen** — the few seconds the founder asked for, whose lines
   are the real write stages. `applyProfilePlan` takes an AWAITED `onStage`
   callback, so the stage being named is the stage being written and the floor
   (520 ms a line, five lines) is held around real work rather than instead of
   it. Collapsed to nothing under `prefers-reduced-motion`.
5. **„Evo tvog Nexusa" reveal** — generated from `plan.reasons` through
   `planReasonLines`, with „Uđi u Nexus" and a quiet „Podesi ručno".
6. **Settings: „Kako je Nexus podešen za tebe"** — the same reasons, always
   reachable, with the manual override and „Zaboravi odgovore" behind it. The
   „ponovo pokreni upitnik" row MOVED here from the foot of „Moduli": that row
   sat there on the argument that the questionnaire's third screen was that
   gallery, and it is not any more.

## 5. What this does not do

- **No seeded content.** Not one invented row. The rule against fabricated data
  is not suspended because the fabrication would be friendly.
- **No new profession taxonomy on screen.** The lexicon is an input, never a
  list the user is asked to pick from.
- **Nothing becomes unreachable.** ADR-065's two checkbox screens survive as
  „Podesi ručno" — a rerun is a user who knows what they want, and the plan must
  never be the only way to a setting.
- **The plan never turns a module OFF.** It only ever argues FOR. PRIV and the
  professional drawer are opt-in and are reached only by somebody saying yes to
  them; nothing else is ever taken away by answering a question.

## 6. Decided while building it

Seven things were settled by the code rather than by this document, and each is
load-bearing enough to record.

**The ANSWERS are stored and the plan is not.** `signalPrefs.ts` keeps a
profile's `Signal[]` under `nexus.profile.signals.<profileId>`; nothing stores a
`ProfilePlan`. A stored plan is a snapshot of what one build's registry could
compose, where stored answers replayed next year get the modules and cards that
exist then — and the explanation can never drift from the answers, because it is
derived from them rather than written beside them. It is also why the Settings
card and the reveal cannot disagree: both call `planReasonLines` on a plan built
the same way.

**Two of the three device preferences are SEEDED, not set.** The accent and the
calendar's opening view each have a chooser of their own, so a plan writes them
only where the profile has none: somebody who reopens the questionnaire a year
later to switch one module on must not find their calendar back on the month and
their app repainted. The pinned sidebar has no chooser and no prior author, so
it is written outright. The board is the deliberate exception — it is rebuilt
whenever the plan composed one, because the reveal names it in the same breath.

**The pinned order is decided by loop order, not by counting.** Evidence is
counted per module, but a tie is the common case — most answers argue for a
module exactly once — so what actually decides the shortlist is the order the
three loops run in: trade, then week, then „drži na oku", most specific first.
„Stručne alatke" is additionally hoisted to the front whenever a trade was
named, because counting alone put „Datoteke" first for a bricklayer.

**„Napredno" writes deltas in both modes.** „Priprema" has already put an
explicit row on every selectable module by the time the manual screen can be
reached, so what is left to write is exactly what the person changed there — the
first-run „write every row" pass must not run twice.

**The sweep can now reach the questionnaire.** Every `ShotScene` is anchored to
a sidebar row and the questionnaire replaces the shell, so eight new screens had
no photograph at all — the shape DC-57 named. `shots` now ends with a pass that
opens the rerun from Settings, ANSWERS each screen (an unanswered flow
photographs six screens in the one state none of them is interesting in), and
completes, so „Priprema", the reveal and „Podesi ručno" are all in the output at
three sizes in both themes.

**And the first thing it photographed was a flow that could not be finished.**
The sweep went from zero findings to 52 the moment those screens entered it: at
900×600 „Čime se baviš?" ran 121 px past the window with „Dalje" below the fold
and nothing to scroll, and „Podesi ručno" cut its pack grid in half mid-row.
Neither is a defect of this ADR's work — the shell has never been able to
scroll, and every list added to it since ADR-065 was given a `vh` cap instead,
three of them, each bounding only itself. The fix is DC-79: the CARD scrolls
(`max-height: 100%; overflow-y: auto`), the shell is made definite so that
percentage can resolve (`min-height: 0` on the flex item, `grid-template-rows:
minmax(0, 1fr)` on the grid), and all three caps are deleted. The lock screen
shares the construction and got the same treatment through the selector the two
already share. Two sub-24 px controls fell out of the same photograph:
`.onb__quiet` had copied `.set__reset`'s look and dropped its `min-height`.

**Law 4 was false in the file that declares it, and the suite could not see
it.** `wantedBoard` is written by four kinds of answer — a week shape, a keep, a
tempo, and a trade through `PACK_WANTS` — and the `board` reason's `causedBy`
concatenated three of them. Somebody who only names their trade therefore got a
board of three cards and a sentence explaining it that named nothing at all.
Every law-4 test supplied a FULL questionnaire, and with week, keep and tempo
present the list is non-empty however many kinds are missing from it: the hole
is only reachable from the sparse input such a suite never constructs. Fixed,
and recorded as **DC-81**, whose general half is the useful one — an invariant
is a claim about every set, so the case that proves it is the SMALLEST set that
can still trigger the rule, never the largest. The test that now guards it is a
plan built from trades alone.

**There is no `clearPinnedModules`, and there should not be.** The pinned
sidebar is the one plan output with no chooser of its own, which reads like a
one-way door until you notice that the way back is the ordinary write: a plan
with no signals has an empty `navPrimary`, and `persistPinnedModules(id, [])`
removes the key. So „Ponovo pokreni upitnik" followed by „Preskoči" restores the
sidebar the app has always drawn, through the same call and the same `navEpoch`
bump every other run gets. A `clear` function was written, tested, documented as
the escape hatch — and never called by anything; **DC-82**.
