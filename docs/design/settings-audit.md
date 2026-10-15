# Settings audit: nothing from 1.4.0 was lost in the redesign

**Question.** Did the Settings redesign that shipped on 2026-10-08 drop any control,
channel or section that 1.4.0 had?

**Answer.** No, for what can be measured by reading the code. Every IPC channel
and every Settings section of 1.4.0 is still in the tree. The redesign added
channels and sections; it removed none.

**Date of measurement:** 2026-10-15, against `HEAD` of the branch that carries this
file, with `v1.4.0` as the baseline. Re-run the commands below to check it again.

## Method and results

### 1. IPC channels, by name

Every channel name is a string of the form `prefix:name` in
`apps/desktop/src/shared/ipc.ts`. The set of such names in `v1.4.0` is compared
with the set in the tree:

```sh
git show v1.4.0:apps/desktop/src/shared/ipc.ts | grep -o '"[a-z-]*:[A-Za-z:.-]*"' | sort -u > a.txt
grep -o '"[a-z-]*:[A-Za-z:.-]*"' apps/desktop/src/shared/ipc.ts | sort -u > b.txt
comm -23 a.txt b.txt   # channels in 1.4.0 and not in the tree
comm -13 a.txt b.txt | wc -l   # channels added since 1.4.0
```

Result: 348 distinct channel names in `v1.4.0`; **0 removed**; 26 added. The tree
has 374 channel names in total.

### 2. Settings sections, by id

Each Settings section is opened from the page with `sectionDomId("<id>")`. The
ids are counted in the renderer source:

```sh
git grep -h -o 'sectionDomId("[^"]*")' v1.4.0 -- apps/desktop/src/renderer | sort -u
grep -rh -o 'sectionDomId("[^"]*")' apps/desktop/src/renderer | sort -u
```

Result: `v1.4.0` has **15** section ids: `about`, `appearance`, `backup`,
`licences`, `modules`, `notifications`, `packs`, `privacy`, `profile`, `profiles`,
`risk`, `security`, `setup`, `shortcuts`, `sync`. The tree has **25**. All 15 are
still present, and the 10 added are `content-packs`, `export-ics`, `import-apkg`,
`import-archive`, `import-csv`, `import-fin-csv`, `import-ics`, `import-llm`,
`import-markdown` and `network`.

The `sync` section is present in the code and hidden in the app by
`SYNC_ON_HOLD` (`apps/desktop/src/shared/syncHold.ts`). That is the hold, not a
loss: its controls exist and are reached again by flipping the flag.

## What this does not measure

- **Behaviour of each control.** Reading that a channel exists does not show that
  a toggle still changes what it changed in 1.4.0. That needs the running app and
  the screenshot sweep (`pnpm --filter @nexus/desktop shots`), and it is not
  recorded here.
- **Stored preference keys.** A key that a 1.4.0 control wrote and the tree no
  longer reads would not show in the channel or section counts above. This audit
  did not diff the keys.

Both gaps are open. A reader who wants them closed should compare the 1.4.0 and
current Settings pages control by control in the sweep, and diff the preference
keys in `packages/db` against `v1.4.0`.
