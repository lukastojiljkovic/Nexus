# ADR-040 — Keyboard shortcuts: reference + remapping (SET-013)

**Status:** accepted · 2026-07-30
**Drives:** SET-013 (S) "Keyboard shortcuts reference + remapping of the
core set" (PRD 07 §4; PRD 08 §5 "Hotkey remap (SET-013)"). Today the app has
exactly one global chord — the inline Ctrl+K palette listener in `App.tsx` —
plus per-context keys (Study grading, calendar arrows, Escape/Enter
conventions). This ADR defines the core set, makes it remappable, and gives
every shortcut one discoverable reference. **No schema, no migration, no
interchange, no IPC change** — bindings are a device-level UI preference.

## Decision

### 1. The core set (app-global chords, all remappable)

| Action id        | Default    | Does |
|------------------|-----------|------|
| `palette`        | Ctrl+K    | Toggles the search palette (open→close on the same chord) |
| `quickCreate`    | Ctrl+N    | Create in the active module via its existing create intent (tasks/calendar/notes); a module with no create intent = no-op, predictably |
| `lock`           | Ctrl+L    | Lock now (the sidebar action) |
| `settings`       | Ctrl+,    | Go to Podešavanja |
| `shortcutsHelp`  | F1        | Open the shortcuts reference overlay |

Deliberately **F1**, not Ctrl+/: on the Serbian QWERTZ layout `/` lives on
Shift+7, so Ctrl+/ is nearly untypeable on the app's home layout; F1 is the
OS-wide help convention and layout-independent.

**Ctrl+1…Ctrl+9** navigate to the Nth visible sidebar module (the sidebar's
own order: `registry.byCategory()` filtered by enabled flags, flattened).
This is a positional *family*, listed in the reference but **not
remappable** — its keys are reserved in conflict checking.

"Ctrl" in a stored chord matches `ctrlKey || metaKey` (the existing palette
rule); displayed as "Ctrl" on Windows.

### 2. Pure chord logic in `@nexus/core`

`packages/core/src/shortcuts/` (TDD): a `Chord { ctrl, alt, shift, key }`
with `key` normalized (single characters lowercased, function keys by name);
`parseChord`/`formatChord` (canonical `"Ctrl+Shift+K"` serialization, Serbian
display formatting stays in the renderer's strings); `matchesChord(chord,
event-shape)` over a plain `{ key, ctrlKey, metaKey, altKey, shiftKey }` —
DOM-free, clock-free, like `timeGridDrag`. **Bindable** means: at least one
of Ctrl/Alt is held, or the key is F1–F12 alone. Nothing else may be bound —
a bare letter or Shift+letter is what typing looks like, and must never be
capturable, which is also why the global handler needs no input-focus guard
for remapped chords. `event.key` (not `event.code`) is deliberate: it names
the key the user's layout actually prints.

### 3. Storage: overrides only, device-level

`localStorage["nexus.shortcuts"]` — a JSON record of **overridden** actions
only, `actionId → serialized chord` (the theme/weekStart precedent: bindings
are muscle memory of a device, not data of a profile, and they never travel
in an archive). Read once at App init into App-owned state handed to
`SettingsPage` with an onChange (the `autoLockMinutes` precedent). Unknown
ids and unparsable chords are dropped on read — never guessed at.

### 4. One global handler

One window keydown listener in `App.tsx` **replaces** the inline Ctrl+K
effect: same ready guard (unlocked, past onboarding), skips `event.repeat`,
resolves defaults+overrides, `preventDefault` only on a match. Firing any
non-palette action while the palette is open closes the palette first — a
navigation must not land underneath an overlay.

### 5. Settings card „Prečice" + reference overlay

- The card lists the core set: label, current chord in token-styled `<kbd>`
  chips, „Promeni" enters capture mode („Pritisni novu kombinaciju…" —
  Escape cancels, an unbindable combination is refused with the rule named,
  a chord already taken — by another action **or** the reserved Ctrl+digit
  family — is refused naming the holder: „Zauzeto: Komandna paleta"; no
  silent swaps). Per-row „Vrati" when overridden, plus „Vrati sve".
  Settings-search entries for the card and for each action label.
- The reference overlay (house dialog recipe, portalled, Escape closes)
  groups: **Globalno** (live current bindings — never a stale printed
  default), **Moduli** (the Ctrl+digit family), **Paleta** (↑↓, Enter,
  Escape), **Zadaci** (Escape leaves Izbor), **Kalendar** (←/→, Home),
  **Učenje** (Space/Enter reveal, 1–4 grades, U undo), **Beleške** (the
  markdown input rules, summarized). The per-context lists are a declarative
  data file with Serbian strings — the reference is documentation, so a
  context adding a key must add its row (recorded as the maintenance rule).
  Opened by F1, from the card („Prikaži sve prečice"), and by a palette
  command „Prečice".

## Consequences

- The palette's Ctrl+K hint badges (sidebar, page headers) read the **live**
  binding via `formatChord`, so a remap is reflected everywhere at once and
  no printed chord can go stale.
- Per-context keys stay hard-wired by design; SET-013 says "remapping of the
  core set", and remappable context keys would need per-context conflict
  scoping for no demonstrated need. Revisit on request.
- PRD 08 §9's web-hotkey question (browser owns Ctrl+K) is untouched — remap
  is per-device, so the web build can simply ship a different default.
