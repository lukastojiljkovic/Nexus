# Nexus Roadmap

**What order things happen in, and why.** For what is *true today* read
[STATUS.md](STATUS.md); this file is only about sequence. Re-cut **2026-08-16**
against what actually shipped — the previous cut was made on 2026-08-02 and had
gone stale on the one question that matters most, still saying the cloud half
was untouched after thirteen server migrations and four sync packages had
landed.

The original 2026-07-05 slicing (M0 / v0 / v0.x / v1) is preserved in
[log/superseded-status-sections.md](log/superseded-status-sections.md). It is
worth reading for the reasoning, and it was overshot in almost every direction:
everything v0 cut shipped, and so did most of what v0 explicitly excluded.

---

## Where we are

**497 commits, 67 local migrations + 13 server ones, 16 registered modules,
desktop at 1.1.0.** The
desktop app is a finished product in daily use and has been since 2026-08-02.
Nothing is released — no tags, no downloads, no signature.

Two founder sentences set the current sequence, and the second supersedes the
first on scope while leaving it in force on quality:

> *„generalno je ceo UI dosta jednostavan i bazican, samo su nabacani dugmici i
> sve, deluje sirovo app bas."* (2026-08-02, after the first real install)

Then, six days later:

> *„resi sve sto je ostalo… da bude clean slate potpuno, i onda da pripremis
> back i front za sajt… supabase za backend… da se pripremi sync desktop app i
> webapp, da bude ful usluga."* (2026-08-08)

So: **breadth is not the constraint and has not been since 2026-08-02** — finish
quality is — and **the web app and its backend are in scope** since 2026-08-08.

---

## Done

- **P1 — the polish arc.** Closed 2026-08-07. Every item in it was a failure
  against design rules already written down, which is why none of it needed a
  decision. Two code sweeps on the same day closed with it.
- **P2 — FIT training.** Closed 2026-08-07, and with it ADR-081. Slices b–d:
  the seven tables and five stores, „Trening" as the page's second section,
  „Napredak" derived from the sets themselves, and „Merenja" with measured
  energy expenditure.
- **P2.5 — the UI overhaul.** Three waves, ending in **v1.0.0** (2026-08-08).
  Wave 1's drawn-data layer was rejected by the founder (*„ovo nije ni 3%
  koliko dobro mora da bude"*) and rebuilt; the instruction that changed the
  method was *„nadji nacin da ti sam vidis screenshotove apsolutno svega u
  app"*, which is why `pnpm --filter @nexus/desktop shots` exists and why
  looking at the app is now a command rather than a favour. What P2.5 still owes
  is small and is listed in [STATUS.md](STATUS.md) §4.
- **PRO — the professional drawer.** Out of band, 2026-08-13/15, because the
  founder asked for it directly after seeing the developer drawer. 18 toolkits,
  274 tools, 1 991 hand-derived assertions, and disclaimers made a property of
  the contract rather than copy somebody has to remember. Core, surfaces and
  wiring all shipped — including `cents-ratio`, whose screen was the one open
  question here and was built on 2026-08-14.
- **The server side.** Thirteen Supabase migrations executed against a real
  Postgres 17, an RLS wall proved by 109 pgTAP assertions running in CI, three
  Edge Functions, and `@nexus/sync-transport` measured against a live PostgREST
  rather than written from the documentation.
- **Linux.** An AppImage, a tarball and a real Gentoo ebuild, all built and
  verified.
- **v1.1.0**, built 2026-08-16 after the pushes were green.
- **W1 — Recovery-Code adoption, end to end.** Closed 2026-08-16. The protocol
  layer had been finished for a week and no screen reached it; now the desktop
  can be recovered from the Recovery Kit, proved by nine tests that run two
  machines against one fake server.
- **W2 — the sync engine.** Closed 2026-08-16, and it went further than the
  slice this file scheduled. The apply path landed with its four rules
  (transactionally co-located state, no echo, refuse a stale object, write the
  state even when the row is unchanged) and DC-14's deterministic repair; then
  the loop itself landed on top of it, so **`@nexus/sync-engine` now carries a
  row between two real databases**.
- **The scheduler.** Closed 2026-08-17 (`8697a75`) — the first half of what W3
  was scheduled to be. What the second half turned into is W3 as it now stands.
- **The profile's content key.** Closed 2026-08-17, both halves: the wire
  (`6b4fd25`) and the desktop's fetch-or-mint (`3f5f65b`). Found while
  wiring the scheduler — `syncOnce` wanted `contentKey`, `ckEpoch` and `keyFor`
  and nothing in the product produced any of them. **The server needed nothing**:
  the „missing insert grant" was a false finding from a line-grep against a
  two-line statement (DC-62), and the wall now carries a rule that would have
  answered it. The rule the module makes structural is that the only path to a
  usable key is unwrapping a wrap the server already holds, so a row can never be
  sealed under a key no peer can fetch.
- **ELEC E1 and E2 — the electronics workbench.** Closed 2026-08-21
  (`8fa6b25` … `4e20e26`). **Not part of the sequence above**: the founder asked
  for an Arduino/Raspberry module on its own terms, and it was built on its own
  terms — the model and its 153-part catalogue, then the bench, the drawer and
  the inspector. Slices E3–E6 (electrical rules, sketch generation, simulation,
  the external ROS 2 runner) are **not** started and are sequenced below.

---

## Now

### W3 — the desktop wiring

Every piece a round needs now exists — the engine, the scheduler, the wire, the
content key — and **nothing constructs any of them.** What is left is mechanical
and it is the whole of the distance between the mechanism and a user having sync:
`syncStoreFor` and an `HttpPort` in the main process, the content key opened per
round and closed when it ends, `createSyncLoop` driving them, a round and its
report over IPC, all behind the cloud-off boundary — a build with sync off
constructs no ports.

The Realtime signal lands on `SyncLoop.nudge` afterwards; it makes sync instant,
the interval is what makes it correct.

### W4 — pairing, or the decision not to build it

The two halves of the pairing subsystem implement two different protocols, and
the hole they were both aimed at now has a route that needs neither. Whether
desktop→desktop pairing is still wanted is a founder question and it is in
[STATUS.md](STATUS.md) §5. If it is, the rendezvous table gets reshaped to the
protocol that is actually implemented and tested.

### W5 — web auth and the web `NexusApi`

`apps/web` is a shell with a typed proxy that throws. Everything behind it is
unwritten, and it is the first work in this sequence that a user could see.

### W6 — deployment on Cloudflare Workers

The target is chosen and nothing is deployed. **This is where the unsigned-build
rule stops being theoretical**: it is the first release surface beyond the
founder's own machines.

### E3–E6 — the rest of the electronics module

Sequenced after W3 rather than beside it, because ELEC was an insertion into a
phase the founder opened first and W3 is the older commitment. The order inside
it is fixed by dependency: **E3** electrical rules (the catalogue already carries
`supply`, `current`, `logicVolts` and per-pin `volts` and nothing reads them),
then **E4** sketch generation, then **E5** in-app simulation, then **E6** the
external ROS 2 runner.

**E6 is the one slice that needs a design decision before any of it is written.**
A runner spawns a process and talks to it; the product's standing guarantee is
that a build with cloud off can reach neither. DEV-007 admits the spawn in
principle, and the boundary that admits it has to be built the way the cloud-off
packet boundary was — before the feature, not around it — with its own gate
(`check:runner`).

Which of W3 and E3 goes first is a founder question, in
[STATUS.md](STATUS.md) §5. The recommendation there is W3.

---

## Standing gates that outrank everything above

- **No public download before code signing and notarization** (SEC-SC-03/04).
  Today's installers are unsigned.
- **No performance claim before a harness measures it.** The budgets in
  [architecture/overview.md](architecture/overview.md) are targets nothing
  checks.
- **The Electron 42 pin has a deadline** — support ends 2026-10-20. Not started;
  it is the one item here that arrives whether or not anyone works on it.

---

## Not in the sequence, and deliberately

Route-level code splitting, the layer scale and the sizing contract are real
work that serves both the desktop app and the web build — they are in
[STATUS.md](STATUS.md) §4 rather than here because they are debts, not phases,
and they get paid inside whichever wave next opens the files they live in.

The rest of the module catalogue — goals, time tracking, health, car, travel,
inventory, shopping, read-later, library, the password vault, entertainment,
sharing, analytics, automation, the AI assistant, plugins — is in
[SPECIFICATION.md](SPECIFICATION.md) §4 with its priorities. Several genuinely
depend on sync existing first. None of them is next.
