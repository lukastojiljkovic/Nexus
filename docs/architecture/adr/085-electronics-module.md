# ADR-085 — „Elektronika": a wiring board, its rules, and the machine it becomes

**Status:** accepted (2026-08-19) · **Owner:** supervisor · **Supersedes
nothing.** Adds the sixteenth module and, with it, the first capability in the
product that runs a program Nexus did not write.

**Founder decisions, 2026-08-19** — asked as four questions, answered in one
pass, then *„Ma ok je to, uradi kako ti misliš da je najbolje."*

1. **Real execution is in scope.** Not only an in-app simulation and an exported
   workspace — Nexus may spawn `ros2` / Gazebo / Docker on the user's machine.
2. **A new, sixteenth module**, not a pack in „Stručne alatke". The drawer stores
   nothing by design; here the stored board *is* the feature.
3. **~140 curated components**, hand-derived, plus an editor for one's own.
4. **Domain colours are exempt inside the canvas** — wire and silkscreen colours
   follow the trade's convention as new `--nx-elec-*` tokens; the rest of the UI
   stays strictly in the Dan/Noć palette. Recorded as DEV-006.

The originating request, verbatim: *„Arduino tabla… kako se ona povezuje na
board-ove i druge komponente preko žica i senzora, primarno da bude fokus na
svim različitim kompatibilnim senzorima… da može da se pokreću ROS 2 kodovi,
tako da korisnik ima opciju simulacije mašine koju je povezao na tabli, ili uradi
to za Raspberry i ROS… te table trebaju biti odrađene grafički kako bi bilo što
realističnije."*

---

## 1. What this module is, in one paragraph

A profile holds **circuits**. A circuit is a board (UNO, Nano, Mega, ESP32, Pi
Pico, Raspberry Pi 4/5) with components placed around it and wires running
pin-to-pin. The module knows what each component *is* electrically, so it can
say when the wiring is wrong before anything is plugged in; it can emit the
Arduino sketch and the ROS 2 package that the circuit implies; it can run the
whole thing as a deterministic simulation with no external software at all; and,
when the user has ROS 2 available, it can hand that generated workspace to a real
`ros2 launch` and stream the output back.

## 2. Six slices, and why in this order

| | Slice | Contains | Needs |
| --- | --- | --- | --- |
| **E1** | Catalogue and data model | the component library, the pin model, the circuit tables, store, sync, imex, the manifest | — |
| **E2** | The canvas | placement, wiring, realistic board graphics, both themes | E1 |
| **E3** | Electrical rules | the findings a wrong circuit produces | E1 |
| **E4** | Code generation | Arduino sketch, ROS 2 package, URDF/SDF, export to disk | E1, E3 |
| **E5** | In-app simulation | the deterministic tick, sensor → pin → topic → actuator | E1, E3 |
| **E6** | The external runner | runner profiles, detection, consent, process lifecycle, logs | E4 |

The order is a dependency order, not a preference. Two things about it are worth
stating because they are the parts a later reader would otherwise re-litigate:

**E3 comes before E4 and E5, not after.** Both of them consume the same derived
fact — which pin carries what, at what voltage, on which bus. A generator that
re-derives that for itself is a second implementation of the rules engine, and
the day the two disagree the user gets a sketch that contradicts the warning on
their own screen.

**E5 is not made redundant by E6.** The in-app simulation needs nothing
installed, runs offline, and works on every machine the app runs on. The external
runner needs ROS 2, a distribution, probably WSL2 or Docker, and several
gigabytes. One of these is a feature of the product; the other is a bridge to the
user's own toolchain. Shipping only the second would mean the module does nothing
at all on a machine that has never heard of ROS.

## 3. The catalogue is source, not rows

The ~140 components ship in `@nexus/core` as a frozen table, exactly as
`PRO_TOOLS` does, and are **never written into a profile's database**.

A catalogue entry is a fact about a part number — the DHT22's supply range, the
BMP280's two possible I²C addresses, which of the UNO's pins can do PWM. It is
versioned with the application because that is what it is: a build-time fact. Put
it in SQLite and every corrected datasheet becomes a migration, every profile
carries its own drifting copy, and two devices that sync can disagree about what
a resistor is.

What *is* stored is the user's own work: the circuit, its placed parts, its
wires, and any component the user defined themselves. A user-defined component is
a row, because it is data; a catalogue component is a constant, because it is not.

## 4. The circuit is normalised, and CANV is the argument

`canvas_boards.scene` stores one opaque Excalidraw document, and
`packages/sync/src/collections.ts` already carries the open question that
follows from it: whole-field LWW means two devices drawing on the same board
concurrently lose one side's strokes entirely, and the note ends *„Decide before
CANV syncs, not after."*

That decision is available here in advance, so it is taken here: **three tables,
not one column.**

- `circuits` — the board itself: name, target board component id, notes.
- `circuit_parts` — one row per placed component: instance id, catalogue id (or
  user-component id), position, rotation, label, and its optional ROS binding.
- `circuit_wires` — one row per wire: both endpoints as (part, pin), colour,
  waypoints.

Each row is its own sync object, so two people wiring the same circuit merge
per part and per wire rather than one of them losing the afternoon. It is more
migration work than a JSON column and it is the difference between a document
that syncs and a document that only appears to.

CANV was right for its own case — an Excalidraw element is somebody else's
schema of some seventy fields, and re-modelling it would have been a copy that
rots. Here the schema is ours, and the rules engine has to read it field by
field anyway.

## 5. The runner, and the one rule that lets it exist

> **The runner's command line is never data.** It is chosen from a closed table
> of runner profiles written in source. The circuit contributes exactly one
> thing — the path of the workspace directory Nexus generated — and never a
> flag, an image reference, an environment variable, an interpreter, or any
> other fragment of a command.

The reason is not hypothetical. A circuit is a **syncable, exportable, importable
document**. If any string on it reached a command line, then importing somebody's
`.nexus.zip` would be remote code execution on the machine that opened it, and
the attack would arrive through the most ordinary act the product supports. The
rule makes that class unrepresentable rather than merely unimplemented, and it
gets its own static gate (`check:runner`) built the same way `check:egress` is —
because the rule that is only written down is the rule that is edited away in a
hurry.

Around that rule:

- **Three profiles, detected rather than assumed:** `wsl` (`wsl.exe -d <distro>`),
  `docker` (`docker run --rm -v <ws>:/ws <pinned image>`), and `native` (`ros2`
  and `colcon` on PATH). Detection is a fixed version probe; the UI reports what
  it found and nothing more.
- **Off by default, and a consent screen that prints the literal command.** The
  same shape as cloud: a user who never turns it on is in a build that spawns
  nothing.
- **One run at a time, an explicit stop, and killed on quit.** A simulation left
  running after the window closed is a process the user cannot see and did not
  keep.
- **Output is captured, capped and append-only**, streamed to the renderer over
  the existing typed IPC allowlist. The renderer never names a command; it asks
  to start the run *for a circuit id*, and main decides everything else.

**The cloud-off guarantee is untouched, and the wording matters.** Nexus still
sends no packet of its own. If a Docker profile pulls an image, that is the
user's Docker making the user's request after the user asked for it, and the
consent screen says so in those words. What this ADR does change is that the
product now has a second capability boundary beside the network one — process
execution — with its own switch, its own default, and its own gate.

## 6. Colour, and why the ban bends here but does not break

The design rules ban blue and orange as system hues, and they stay banned
everywhere a system hue would appear: navigation, buttons, panels, selection,
charts. Inside the canvas, colour is not decoration and not branding — it is
**data**. Red is 5 V, black is ground, blue is very often SDA, and an UNO is
teal. An engineer reads a wire's colour the way they read a number; remapping
those onto the eight-accent palette would produce a diagram that is wrong in the
one way a wiring diagram must never be, and useless the moment it is printed.

So a new token group `--nx-elec-*` carries the trade's colours, defined in
`packages/tokens` like every other colour in the product — still tokens, still
under `check:colours`, still with both themes designed rather than inverted.
Recorded as **DEV-006**.

## 7. What was rejected

- **Extending CANV instead.** Excalidraw draws freely; a circuit's objects are
  typed and carry pins, buses and voltages. The rules engine cannot ask a
  free-form stroke what it is connected to.
- **A pack in „Stručne alatke".** The drawer computes and stores nothing, on
  purpose. The board must persist, sync and export.
- **Shipping a ROS 2 runtime inside the installer.** One to two gigabytes,
  per-platform, and it would make Nexus the distributor of somebody else's
  robotics stack.
- **Photographic component art.** Licensing aside, it fights the design system
  and reads as clip-art. Vector silkscreen, drawn to the real board outline and
  the real header pitch, is both more honest and more legible at the zoom levels
  a wiring diagram is actually read at.
- **Letting the renderer name the command.** See §5. It is the whole reason the
  runner is allowed to exist.

## 8. Open, and deliberately so

- The catalogue's exact 140 are fixed in E1, not here; what is fixed here is
  that they are hand-derived and that each carries a full pin map.
- The URDF/SDF that E4 emits describes a machine, and a machine is more than its
  circuit — link geometry has to come from somewhere. **Decided in E4c
  (2026-09-01): a small set of parametric chassis, not a user-supplied mesh.**
  Two shapes (`diff-rover`, `four-wheel-rover`) and nine numbers the user types
  in centimetres and grams; the circuit contributes the SENSORS, and a sensor's
  place on the machine is a NAME (`front`, `rear`, `left`, `right`, `top`)
  rather than three coordinates, so its origin stays derived from the body that
  was already measured. A mesh was rejected for the reason the whole module is
  offline-first: it makes the description depend on a file Nexus neither ships
  nor can validate, and a mesh whose units or origin are wrong produces a
  simulation that runs and is silently wrong. Nothing is pre-filled — Nexus
  cannot measure, so a pre-filled field would be a dimension the user never
  took.
- Whether E6 ever grows a Gazebo *view* inside the app, rather than only its
  log, is left open until E6 exists and there is something to look at.
