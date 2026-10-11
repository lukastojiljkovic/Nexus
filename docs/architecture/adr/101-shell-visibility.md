# ADR-101 — Hiding and ordering modules: ONE setting for the whole app

**Status:** Accepted
**Date:** 2026-10-10
**Supersedes:** nothing, and it amends two decisions by consequence: ADR-058's
per-profile module preset and ADR-086's per-profile module plan are answered
from the device's arrangement from here on (see §3).

## Context

Nexus ships sixteen compiled-in modules plus the ones the module kit discovers
(ADR-090), and the plan is roughly forty. Two things stop working at that size,
and both are about the SIDEBAR rather than about the modules:

- a rail of forty rows is a scroll region with a heading on top, and
- a user who does not touch half of them has no way to say so.

ADR-093 grouped the modules, which fixes the first. This ADR is the second: the
user hides the modules they do not use, orders the groups, and orders the
modules inside each group.

**One setting for the whole app, not one per profile** (Luka, 2026-10-10). A
device with two profiles is still one person's app, and the per-profile switch
this replaces was the reason a module could be on in one profile's sidebar and
off in the next one's launcher.

## 1. The setting, and why it is a file

`visibility.json`, at the root of `userData`, beside `cloud.json` and
`network.json`:

```json
{
  "version": 1,
  "hidden": ["study", "electronics"],
  "shown": ["priv"],
  "groupOrder": ["plan", "life", "knowledge"],
  "moduleOrder": { "plan": ["tasks", "habits", "calendar"] }
}
```

- **`hidden` is the list the brief names** — the modules the user switched off.
- **`shown` is its other direction, and it is not decoration.** A manifest
  declares whether a module ships on (`defaultEnabled`; PRIV and PRO ship off,
  deliberately), so a setting that could only HIDE could not record an opt-in
  module that somebody switched ON — which is exactly what the migration in §3
  produces. Two lists keep the manifest's own default meaningful: a module added
  by a later build is on when it says it is, and off when it says it is, without
  the file having to mention it.
- `hidden` wins a contradiction, and normalization drops an entry that only
  restates a manifest, so the file holds decisions rather than a copy of the
  registry.
- The two locked rows („Kontrolna tabla", „Podešavanja", `LOCKED_MODULE_IDS`)
  cannot be hidden by any of it: the predicate answers `true` for them whatever
  a file says, and normalization — every write, and the migration — strips them
  out of both lists, so a file that claims one of them is not left holding a
  claim nothing can honour. Somebody has to render the switch.
- `groupOrder` and `moduleOrder` are OVERRIDES. Empty means „the order the
  registry declares", which is what a device that has never reordered anything
  runs on, and what the card's reset writes back. A group or module the order
  does not name keeps its registry place, after the ones the order does name —
  the rule that lets a module added by a later build appear without anybody
  editing this file.

**Read at startup, before any profile is unlocked.** The boundary files taught
this: the rail is drawn from this setting and main's own gates read it, and a
value stored inside an encrypted profile could not be read at either moment. It
is therefore world-readable and user-writable, like its two neighbours, and it
is **not** a boundary — so its parser fails OPEN. A missing file, an unreadable
one, malformed JSON, a shape this build does not write, or a version that is not
literally `1` all read as „nothing is arranged here", i.e. the app exactly as it
ships. That is the opposite of `cloud.json`'s fail-closed rule and for the
opposite reason: a corrupt network switch must not open a packet, while a
corrupt arrangement that read as „hide everything" would leave a user with a
rail they cannot explain.

**An unknown module id is KEPT, never dropped.** A module that leaves the build
keeps its place in these lists, so the day it returns it comes back hidden (or
shown) as the user left it, and a build without it does not silently rewrite
what a build with it wrote. The predicate ignores an id no manifest answers to,
which is what makes „a module that left the build" a no-op everywhere instead of
a special case at each call site.

The write is the network mode's: a sibling `.tmp`, fsynced and closed before the
rename, so a reader sees the old arrangement or the new one and never half of
one.

## 2. One predicate, and every surface through it

`shared/moduleVisibility.ts` owns the shape, the parser, the four writes a
gesture makes and **the one predicate**:

```
visible = the module is locked ? true
        : `hidden` names it ? false
        : `shown` names it ? true
        : the manifest's own `defaultEnabled`
```

`visibleModuleSet(registry, visibility)` is that answer as a set, and these
surfaces are all filtered by it:

| Surface | Where |
| --- | --- |
| the rail | `navPrefs.sidebarGroups`, which now also takes its order from the arrangement |
| the launcher (ADR-093 §4) | `moduleLauncher.launcherGroups` |
| the Settings filter (SET-014) | `settingsSearch.buildSettingsIndex` — section, rows and the controls of the module's card |
| the Settings module cards | `moduleSettings.moduleSettingsCards` |
| the dashboard's widget picker and its placed widgets | `DashboardPage`, through the same `enabledModules` set it already took |
| the palette's „Idi na" list | `searchCommands.buildSearchCommands` |
| the assistant's places to open | the same command list |
| search results in MAIN | `enabledModuleIds()` in `main/index.ts`, the ADR-058 §5 gate |
| notifications | `notificationSchedulerDeps.enabledModuleIds`, read on every scheduler cycle |

**A hidden module's notifications stop, and that is where.** The scheduler asks
for the enabled set on every check rather than capturing it once, so a module
hidden while the app runs falls silent on the next cycle — reminders of its
kind are neither generated nor delivered. What it already stored is untouched:
hiding a module is a statement about this device's app, not about the user's
data. Showing it again restores every surface in one write, and the data was
never anywhere else.

## 3. The migration: the union of what every profile had on

Until this build, modules were switched per profile (`feature_flags` rows,
SET-007). The app-wide setting replaces that, and the migration is a **window,
not a flag**:

1. **The window is the launch that finds no `visibility.json`.** The file's
   existence at launch is read once; after that launch it exists, so no later
   launch migrates anything. This is what keeps the union from re-showing a
   module the user hid by hand: creating a second profile is an ordinary act,
   and one that kept unioning would undo the user's own arrangement.
2. **Each account's profiles contribute as that account is unlocked**, which is
   the only moment their rows can be read at all: the profiles of an account
   become readable together, when its database is opened. Each profile is read
   once per launch. Its on-set is `resolveEnabled` over the shared manifests fed
   by its own rows — the very function the shell resolved them with, so the
   union means exactly what each profile's app showed on the last build it ran.
3. **The union decides every module of this build, in both directions**
   (`seedVisibleModules`): a module that no profile had on is recorded hidden
   even though its manifest ships it on. A helper that could only SHOW would
   leave such a module visible and lose the very decision the migration exists
   to carry over.
4. **The rows stay where they are.** They are not deleted, not rewritten and not
   read by anything after the migration — the DB is the user's, and a rollback
   to an earlier build finds its own state intact.

The union can grow between two unlocks within that first launch, so a module a
later profile had on comes back even if an earlier one had it off — and a module
the user hides by hand in that same window, before another profile is read, can
be re-shown by that profile's union. That is the window's only edge and it is
named here rather than hidden: it lasts for one launch, and it only ever shows.

**What this means for the two decisions that used to be per profile.**

- The **questionnaire's module screen** (ADR-065 §3–§4, ADR-086 §4) and its
  manual override write the DEVICE's arrangement now, because that is what
  „switch this module on for me" means when there is one arrangement.
  `flags:get` answers a module id from the arrangement (laid over the profile's
  own rows) and `flags:set` on a module id writes it, so every existing caller —
  the questionnaire, its manual screen, the profile plan — keeps working
  unchanged and keeps MEANING something.
- The **profile plan** („Priprema") therefore shapes the app-wide arrangement
  too, on a rerun as much as on a first run. A plan's other stages are
  untouched: the board, the pins, the accent and the calendar view stay
  per-profile (ADR-086's own list), and so does a business profile.
- The **business profile's module preset** (ADR-058: STUDY off) is a device
  write for the same reason. „A business profile does not show Učenje" cannot be
  a row of its own any more; the alternative was a preset whose rows nothing
  reads, which is a decision the build would then be pretending to honour. The
  preset's other half — an Inbox, a board, a look — is unchanged and stays per
  profile.
- **Toolkit packs stay per profile.** A pack is an answer about the person
  (`pack:<id>` under `feature_flags`, ADR-086), the profile next door has its
  own, and nothing about this ADR asks them to agree.

## 4. The card

**Settings → Moduli → „Prikaz"** (sr) / „Display" (en). It IS the module gallery,
grown rather than replaced: the same section, in the same navigation groups
(ADR-093), and the same `set__module-*` rows — so the rail and this list are one
arrangement drawn twice, and the settings filter that steers to a module's row
keeps the id it always had.

- **One switch per module**, writing the device setting. The two locked rows
  wear the „Uvek uključeno" chip they have always worn, because there is no
  switch that could be offered for them.
- **Groups and modules are reorderable by drag AND by keyboard**, and both go
  through `moveInOrder`: a drop asks for the DISTANCE between the row picked up
  and the row it landed on, a keystroke asks for one place, and one function
  answers both (`movePinned`'s rule, one level up). The two move buttons are the
  keyboard's half, and the grip is the mouse's.
- **„Vrati podrazumevani raspored"** clears the stored order, so the arrangement
  is the registry's again. It does not touch what is hidden: the order and the
  visibility are two decisions, and a reset that also unhid things would be a
  different button.
- **A module cannot be moved between groups.** A manifest declares its own group
  (`ModuleGroup`, ADR-093): which department a thing belongs to is a statement
  about the product, and one person's arrangement is not the place to change it.

## Alternatives rejected

**A per-profile setting.** It is what exists, and it is the thing that cannot
grow: the rail is one row per module on one screen, so two profiles disagreeing
about it means the SAME device draws a different app depending on who is signed
in — and the second profile's unlock would then have to re-arrange the first
profile's sidebar under their hands.

**Deriving visibility from `feature_flags` and calling it app-wide.** One
column's worth of work, and it makes „one setting for the whole app" a fiction:
the value would still be a row of a profile, and the next profile read would
have to decide whose answer wins.

**Failing closed on a bad file.** `cloud.json`'s rule, and wrong here for the
reason §1 gives: the strong answer for a boundary is „off", and for a preference
it is „as shipped".

**A second list beside the gallery.** Two lists of the same modules, one of them
kept in step by hand, is the defect this repository has paid for most often
(DC-109). The gallery became the card instead.

**A `visibility` entry in the migration series.** Nothing about this setting is
per profile or per schema version, and a migration that ran against a database
would put a device-level decision inside one account's file — the shape
`accounts.json` and `cloud.json` already exist to avoid.

## Consequences

- Adding a module stays what ADR-090 made it: a folder. The new module is drawn
  by default (or not, if its manifest says so), it appears at the END of its
  group's arrangement, and `check:copy` and the settings filter learn about it
  by being written rather than by being told.
- The rail, the launcher, the dashboard, the palette, the settings filter and
  the notification scheduler can no longer disagree about which modules this
  machine shows: they read one predicate over one file.
- `flags` on the wire now answers two questions instead of one (§3). That is a
  smaller change than re-teaching three callers a second shape, and it is
  stated where the type is declared (`shared/ipc.ts`, `FlagState`).
- A device that never touches this setting is the app it always was: the file
  says nothing, and the predicate answers with the manifests' own defaults.
