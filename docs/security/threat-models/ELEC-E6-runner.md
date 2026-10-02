# Threat model — ELEC slice E6, the external ROS 2 runner

**Date:** 2026-09-22 · **Author:** Claude (Opus), for founder review
**Slice:** E6 of ADR-085 — the external runner (`ros2` / `colcon` / Gazebo, native
or through WSL2 or Docker).
**Authorising decision:** [DEV-007](../../deviations.md), confirmed by the founder
2026-08-19, including its four mitigations and its revisit trigger.
**Required by:** SEC-VER-01. **This is the first document in this directory** —
see §7, which is a finding about the rule rather than about this slice.

---

## 0. Why this slice gets a threat model and the other fifteen did not

E6 adds a **second capability boundary** to a product whose security argument
rests on having exactly one. Until E6 the main process contained no
`child_process` call at all: the network boundary was the only way out of the
app, `main/net/offline.ts` represented it as a switch, and `check:egress` made
"no new network construct" a rule rather than an intention.

E6 introduces process execution, which is strictly more dangerous than a network
call, because a network call can only exfiltrate what the app already has, while
a spawned process runs code with the user's own rights. So this is the one slice
where a design-level threat pass is not ceremony.

## 1. Scope, and what is out of it

**In scope:** everything between "the user presses Pokreni" and "the process is
dead and its output is on screen" — profile detection, command construction, the
spawn, the workspace path, output capture, the stop path, and the quit path.

**Out of scope, with the reason:**

- **ROS 2, Gazebo, Docker and WSL themselves.** Nexus does not secure them, does
  not configure them and does not ship them. A user whose Docker daemon is
  exposed to their LAN has a Docker problem, and this document does not pretend
  to solve it. What Nexus owes is that it does not *create* that exposure and
  does not widen it.
- **The generated workspace's CONTENTS.** What `E4` writes is code the USER will
  run on their own board. That is the product's purpose and it is covered by the
  "no output is ever driven" refusal in ADR-085, which is a correctness rule, not
  a security boundary.
- **In-app simulation (E5).** It spawns nothing; it is the reason the product is
  still useful with no ROBOTICS stack installed.

## 2. Assets

| Asset | Why it matters | Where it lives |
| --- | --- | --- |
| The user's machine and its rights | A spawned process runs AS the user | the OS |
| The user's other files | A workspace path is the one datum a circuit supplies | the filesystem |
| The profile's data | A runner that can read the DB file could read everything | `%APPDATA%\Nexus` |
| The key hierarchy | `DK`, `MK`, `CK_p` — a process that reaches them ends the design | main-process memory |
| The "sends no packet" claim | The product's honest claim about itself | `main/net/offline.ts` |
| The consent the user gave | Consent to a command that can change is not consent | the consent screen |

## 3. Trust boundaries

1. **Imported circuit → the command line.** The sharpest one. A `.nexus.zip` is
   an ordinary, supported, shareable artefact. Every string on a circuit is
   therefore **attacker-controlled** in the threat that matters: the attacker is
   whoever sent the user the file.
2. **Circuit → the workspace path.** The path is derived, not typed, so this
   boundary is about what the DERIVATION can be made to produce.
3. **Child process → the renderer.** Child stdout is untrusted content arriving
   in a privileged UI.
4. **Renderer → main.** Unchanged: the typed IPC allowlist, `assertTrustedSender`
   and per-field validators (SEC-EL-02).
5. **Main → the OS's process table.** The new boundary.

## 4. STRIDE

### S — Spoofing

- **S1. A profile that claims to be another.** Detection reports what it found;
  a `wsl` profile must name a distro from the probe's own output, never a string
  the user typed into a field. `wsl.exe -d <anything>` is a command line built
  from data if `<distro>` is free text.
- **S2. A pinned Docker image that is not the pinned one.** The image reference
  lives in the source table. It must be a digest or a fully-qualified tag —
  `ros:humble` resolves to whatever the registry serves that day, which means the
  thing executed is chosen by the registry rather than by us.

### T — Tampering

- **T1. Command injection through circuit data.** The rule that makes this
  unrepresentable is DEV-007's: the command line is chosen from a closed table in
  source; the circuit contributes exactly one value, the workspace PATH. The
  enforcement is `check:runner`, and its shape is `check:egress`'s — a static rule,
  because a rule that is only written down is the rule that is edited away in a
  hurry.
- **T2. Argument injection through the path.** The path is data, so it is the one
  place injection can still enter. Three conditions, all necessary: argv arrays
  and **never** `shell: true` (a space in a path such as
  `C:\Users\<user>\My Projects\robot` must not be a word split); no string
  interpolation of the path into a command string even
  where argv would have been safe; and a path that begins with `-` must be
  rejected rather than escaped, because a leading dash is an option to `ros2`,
  `colcon` and `docker` alike.
- **T3. TOCTOU on the workspace directory.** The path is validated, then spawned
  into. Between the two, a symlink could be swapped for something else. This is
  mitigated rather than eliminated: resolve with `realpath`, re-verify
  containment immediately before the spawn, and accept the residual window —
  closing it entirely needs `O_NOFOLLOW` semantics the platform does not offer
  for a directory argument.
- **T4. Container mount escalation.** `-v <ws>:/ws` must mount the workspace
  read-write (the build writes into it) and **nothing else**. In particular the
  Docker socket (`/var/run/docker.sock`), the user's home, and the Nexus data
  directory must never be mounted: a container with the socket has the host's
  root.

### R — Repudiation

- **R1. No durable record of what ran.** The log is captured, capped and
  append-only, and it does not survive the session. Accepted: this is a local
  developer tool, the user is the only party, and a durable audit trail of
  commands the user themselves initiated protects nobody. Stated here so that a
  later reader finds a decision rather than an omission.

### I — Information disclosure

- **I1. Output reaches the renderer and carries escapes.** Child stdout is
  attacker-influenced in the sense that a build can print anything. Rendered as
  TEXT, never as HTML, never through `dangerouslySetInnerHTML`, with control
  characters and ANSI sequences stripped. The renderer must not be able to be
  made to interpret output as markup.
- **I2. The process reads more than the workspace.** Inherent to spawning: the
  child runs as the user and can read anything the user can. Not mitigable and
  not pretended otherwise — it is the reason consent is explicit and the literal
  command is printed. What IS ours: the command must not *point* the child at the
  Nexus data directory or at the key material.
- **I3. Output leaks into the log file unredacted.** The workspace path may
  contain the user's name (it does: `C:\Users\<name>\…`). Cap and truncate; do
  not additionally transmit.

### D — Denial of service

- **D1. Unbounded output.** A build loop printing forever fills the disk. Cap the
  captured bytes, and stop appending (do not silently keep the first N and
  pretend the run was complete — say it was truncated).
- **D2. Many runs at once.** One at a time, enforced in main, not in the UI.
- **D3. A process that outlives the window.** Killed on quit, in `will-quit`
  beside `stopNotificationScheduler()`. A simulation left running after the
  window closed is a process the user cannot see and did not keep.
- **D4. A stop that does not stop, and a stop that lies about itself.** The
  graceful-then-forceful ladder is POSIX-shaped and this product is Windows-first:
  Node's `child.kill("SIGTERM")` on Windows calls `TerminateProcess`, so there is
  no polite signal to send and no wait worth taking. What must be true on every
  platform is narrower and checkable — the stop path reports the STATE it
  achieved (exited, or still running) rather than assuming success, and the UI
  says which. A „Zaustavljeno" printed over a live process is worse than a
  spinner that never stops, because the user stops looking. The other descendant
  case is real and platform-independent: a Docker or WSL profile's `docker.exe`
  exits while the container keeps running, so „stopped" must be established by
  asking the profile whether the work is gone, not by watching this process end.

### E — Elevation of privilege

- **E1. The runner as a way to run anything.** The composite of T1–T4 plus S1–S2:
  if any one of them holds, the runner becomes a general-purpose execution
  primitive reachable from an imported file. This is the threat the whole design
  exists to refuse, and it is why the mitigations are structural (a closed table,
  argv arrays, no shell) rather than validating.
- **E2. Reaching the key material.** Main holds `DK`/`MK`/`CK_p` in memory while a
  child runs. A child cannot read another process's memory; it CAN read the
  profile files, which are SQLCipher-encrypted and passcode-wrapped. The rule
  that follows: the runner must never be given the passcode, the local key, or a
  path to the database, and the consent screen must not echo them.

## 5. The four mitigations DEV-007 named, restated as testable claims

Each is a claim that a review or a gate can falsify, rather than a reassurance.

1. **The command line is never data** → `check:runner` fails the build if any
   module that constructs a spawn call reads a value from a circuit, a
   user-component row, or a store. The profile table is the only source.
2. **Off by default with a one-time consent that prints the literal command** →
   a test asserts that with the switch off, no spawn path is reachable, and that
   the consent screen's copy is the command string the runner will actually
   execute, not a description of it.
3. **The renderer never names a command** → the IPC channel takes a circuit id
   and nothing else; the validator refuses any extra field. This is the same
   shape as every other channel and is testable the way they are.
4. **One run at a time, explicit stop, killed on quit** → three tests, and the
   quit one is the one that would otherwise be discovered by a user.

## 6. What would re-open this decision

DEV-007's own trigger, restated: **anything that lets the runner execute
something Nexus did not write.** Concretely, any of these re-opens it before it
ships:

- pointing the runner at a directory the user types or picks, instead of one
  Nexus generated;
- running a workspace that arrived inside an import, even a workspace Nexus
  itself once generated on another machine;
- letting a profile's command line acquire any input beyond the workspace path;
- adding a fourth profile whose command is not fully determined by source;
- executing a script from inside the workspace, rather than the toolchain against
  the workspace. (The build does that — `colcon build` runs `setup.py`. That is
  the line: the user's own toolchain executing the user's own generated package
  is the product working. Anything that makes that package *ours to trust* rather
  than *theirs to review* is the boundary moving.)

## 7. Findings about the RULE, not about this slice

1. **SEC-VER-01 has zero instances, this one included until now.** The directory
   it names did not exist in this repository. **Sixteen** modules are registered
   and none of them has a threat-model pass recorded — the registry table in
   `docs/STATUS.md` has seventeen ROWS, but the sentence above it says one of
   them is Onboarding, „which is a flow rather than a module and so carries no
   manifest". (This document said „seventeen modules" when it was first written,
   counted off the rows rather than read off the sentence: Class A, and corrected
   here rather than left for the next reader.) That is a rule with no enforcement
   and no history, and a rule that has never once been followed is not a rule —
   it is a sentence. Recorded in `STATUS.md` with the count, because the honest
   first move is to say so rather than to quietly produce one (this) and let
   sixteen modules look covered by it. This one does not cover a module at all:
   it covers a slice.
2. **The remaining ones are a founder decision, not a mechanical one.** A
   retrospective threat model of a shipped module is genuinely useful and is also
   a different kind of work from this document: it looks for what was missed
   rather than for what is about to be built. My recommendation is a targeted
   subset — the modules that hold key material, parse foreign input, or cross a
   capability boundary (AUTH, PRIV, DOC's previewers, the sync stack) — rather
   than all sixteen at once.

## 8. Related

- [DEV-007](../../deviations.md) — the authorising decision and its trigger.
- [SEC-EL-02](../baseline.md) — the IPC contract every new channel inherits.
- [SEC-LOC-04](../baseline.md) — the no-network assertion the runner must not
  weaken.
- `docs/architecture/adr/085-electronics-module.md` §5 — the design this document
  threats.
