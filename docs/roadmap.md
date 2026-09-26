# Nexus Roadmap

**What order things happen in, and why.** For what is *true today* read
[STATUS.md](STATUS.md); this file is only about sequence. Re-cut **2026-09-26**
against what actually shipped. The previous cut, 2026-08-16, still said the
desktop was at 1.1.0, that the desktop sync wiring and electronics E3–E6 had not
started, that the founder had yet to choose between the two, and that the
Electron 42 deadline was open — all five had been settled for weeks, and on
2026-08-31 the founder had re-ordered everything. What that cut said is kept,
verbatim, in [log/superseded-status-sections.md](log/superseded-status-sections.md).

**This file carries no running figures.** Commits, migrations, frames and bytes
live in [STATUS.md](STATUS.md) §1, where they are measured; a figure copied here
is right on the day it is copied and wrong a week later, which is the defect
class that retired the last cut.

The original 2026-07-05 slicing (M0 / v0 / v0.x / v1) is preserved in the same
archive. It is worth reading for the reasoning, and it was overshot in almost
every direction: everything v0 cut shipped, and so did most of what v0
explicitly excluded.

---

## Where we are

The desktop app is a finished product in daily use and has been since
2026-08-02. Nothing is released — no tags, no downloads, no signature.

Three founder sentences set the sequence, each one on top of the last:

> *„generalno je ceo UI dosta jednostavan i bazican, samo su nabacani dugmici i
> sve, deluje sirovo app bas."* (2026-08-02, after the first real install)

> *„resi sve sto je ostalo… da bude clean slate potpuno, i onda da pripremis
> back i front za sajt… supabase za backend… da se pripremi sync desktop app i
> webapp, da bude ful usluga."* (2026-08-08)

> *„web/sync je za sada trajno na hold-u, dok ne završimo sve feature za
> desktop, lako ćemo ih posle portovati na sajt jer je electron osnova."*
> (2026-08-31)

So: **breadth is not the constraint and has not been since 2026-08-02** — finish
quality is. **The web app and its backend are in scope** since 2026-08-08, and
**they come after every remaining desktop item** since 2026-08-31. The reason for
the last one is the load-bearing part: the renderer is one React codebase and
Electron is only its shell, so a feature finished on the desktop is a feature the
web app inherits, and building the web surface first would mean building each
feature twice.

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
  looking at the app is now a command rather than a favour.
- **PRO — the professional drawer.** Out of band, 2026-08-13/15, because the
  founder asked for it directly after seeing the developer drawer. Profession
  toolkits, with disclaimers made a property of the contract rather than copy
  somebody has to remember.
- **The server side.** Supabase migrations executed against a real Postgres 17,
  an RLS wall proved by pgTAP assertions running in CI, Edge Functions, and
  `@nexus/sync-transport` measured against a live PostgREST rather than written
  from the documentation.
- **Linux.** An AppImage, a tarball and a real Gentoo ebuild, all built and
  verified.
- **W1 — Recovery-Code adoption, end to end.** Closed 2026-08-16.
- **W2 — the sync engine.** Closed 2026-08-16: `@nexus/sync-engine` carries a
  row between two real databases.
- **The scheduler and the profile's content key.** Closed 2026-08-17.
- **W3 — the desktop wiring.** Closed 2026-08-30. A round is built, run and
  reported from the main process, the scheduler opens on unlock and closes on
  lock, and „Stanje sinhronizacije" in Podešavanja shows it — all behind the
  cloud-off boundary. What it has never done is run against the deployed
  project; that is the head of the paused queue below.
- **ELEC — the electronics workbench, E1 through E6.** E1 and E2 closed
  2026-08-21; E3 and E4a on 2026-08-31; E4b and E4c on 2026-09-01; E5, the
  in-app simulation, on 2026-09-03; and E6, the external ROS 2 runner, on
  2026-09-22. E6 is the app's second capability boundary — the first that
  starts a process — and it was built the way the cloud-off boundary was:
  before the feature, with its own gate (`check:runner`).
- **Electron 44.** 2026-09-06, six weeks before Electron 42 left support.
- **Installers 1.2.0 (2026-08-31) and 1.3.0 (2026-09-23)** — built, unsigned,
  untagged.
- **The first desktop loose ends.** 2026-09-26: every package declares its side
  effects, every page is its own chunk, and Excalidraw left the startup path.

---

## Now — the desktop, until it is done

[STATUS.md](STATUS.md) §4.1 is the queue, in the order to take it, and it is not
repeated here: a list kept in two files is two lists within a week. What this
file adds is the rule the order follows — **cheapest and highest-leverage
first, and none of it a new feature.** It is the set of loose ends recorded
while the product was being finished, and the desktop is done when it is empty.

## Next — web and sync, paused since 2026-08-31

Paused, not cancelled: everything built for it stays built, tested, green in CI
and off by default, and nothing new is added until the desktop is done. When it
resumes, the order is fixed by dependency and carried in
[STATUS.md](STATUS.md) §4.2 — a first round against the deployed project, then
pairing (or the decision not to build it, a founder question in §5), then web
auth and the web `NexusApi`, then deployment on Cloudflare Workers. The last is
**where the unsigned-build rule stops being theoretical**: it is the first
release surface beyond the founder's own machines.

---

## Standing gates that outrank everything above

- **No public download before code signing and notarization** (SEC-SC-03/04).
  Today's installers are unsigned.
- **No performance claim before a harness measures it.** The budgets in
  [architecture/overview.md](architecture/overview.md) are targets nothing
  checks — which is why the 2026-09-26 split is recorded in bytes and not in
  milliseconds.
- **An Electron major is a founder decision, and the screenshot sweep is part
  of it.** CI cannot run `shots`, so a green check on a Chromium bump is green on
  the half of the verification that decides nothing here. 44 is supported until
  v47 ships — around 2027-02, derived from the published cadence rather than
  announced.

---

## Not in the sequence, and deliberately

The rest of the module catalogue — goals, time tracking, health, car, travel,
inventory, shopping, read-later, library, the password vault, entertainment,
sharing, analytics, automation, the AI assistant, plugins — is in
[SPECIFICATION.md](SPECIFICATION.md) §4 with its priorities. Several genuinely
depend on sync existing first. None of them is next.
