# Deviations Log

Per `docs/prompts/06-implementation-template.md`: any deviation from PRD or
architecture is logged here and needs founder confirmation before merging.

## DEV-001 — Token build: zero-dep generator instead of Style Dictionary

- **Date:** 2026-07-05 · **Status:** **confirmed by founder 2026-07-12**
- **What:** ADR-006 names Style Dictionary as the token compiler.
  `packages/tokens/build.mjs` is instead a ~100-line zero-dependency
  generator (JSON → CSS custom properties + typed TS module).
- **Why:** identical output for current needs (CSS + TS targets), zero
  supply-chain surface (SEC-SC bonus), no config-DSL learning tax. The
  3-tier JSON source format is unchanged, so migrating to Style Dictionary
  later (when Compose/RN targets become real at Android kickoff) is a
  build-script swap, not a token rewrite.
- **Scope:** build tooling only; no product behavior affected.

## DEV-002 — IMEX full export ships unencrypted (v0)

- **Date:** 2026-07-11 · **Status:** **CLOSED 2026-07-28** (was: confirmed by
  founder 2026-07-12). Encrypted export shipped in `203d06f` + `bef45e0` per
  ADR-022 §4/§5: an `NXA1` container under a passphrase typed at export time,
  Argon2id → AES-256-GCM in frames. The deviation is closed because the
  behaviour it described no longer exists — encryption is now the default and
  the plaintext path is exactly what SEC-DAR-02 asks for, an explicitly
  confirmed choice (its own unticked checkbox, with the export button disabled
  until it is ticked, and the confirmation consumed with the export rather than
  left standing to arm the next one). See the closing note at the end of this
  entry.
- **What:** PRD 14 IMEX-001 and ADR-009 both specify export encrypted by
  default (SEC-DAR-02), with plaintext requiring an explicit user
  confirmation. The IMEX slice a1 full-export archive (`.nexus.zip`,
  `buildExportArchive` in `packages/core`, `handleExport` in
  `apps/desktop/src/main/imex.ts`) instead ships in plaintext unconditionally
  — no encrypted-archive option exists yet, and no confirmation dialog gates
  the plaintext path.
- **Why:** encryption-at-rest for the product as a whole is already
  founder-deferred to the AUTH module (2026-07-07 decision, recorded in
  `docs/STATUS.md` §5): the database itself opens without an encryption key
  until AUTH lands. There is no key-derivation/wrapping machinery anywhere in
  the app yet to encrypt an export archive with, so an encrypted-export option
  would have nothing real to wrap the archive's contents with — building one
  now would mean inventing throwaway crypto ahead of AUTH's actual key
  management. The Settings "Rezervna kopija" card states the plaintext fact
  directly (no apology, no fake toggle).
- **Scope:** IMEX slice a1 (full export) only. Encrypted export lands
  alongside AUTH's key management, per PRD 14's own decision log; import/
  restore (a later IMEX slice) inherits whatever the encrypted-export
  decision becomes at that point.
- **Update 2026-07-26 (AUTH has landed, this deviation has NOT been closed):**
  ADR-018 shipped real key management — the database is now encrypted at rest
  under a passcode-derived key. The export archive is still plaintext, so the
  deviation stands, but its original rationale ("there is no key-derivation
  machinery to wrap an archive with") no longer holds: `@nexus/core/auth` now
  has exactly that. What remains is a product decision about the archive's own
  passphrase — an export must stay readable on a machine that has no Nexus
  account, so it cannot simply reuse the local data key. The Settings copy was
  corrected to stop promising that encryption "arrives with AUTH".
- **Closed 2026-07-28.** The founder settled the open product question
  (ADR-022 §4): the archive is under a passphrase typed at export time, not the
  data key and not the Recovery Kit — the Kit exists to unwrap the data key, and
  regenerating it would silently strand every archive ever written. The
  container (ADR-022 §5) is a cleartext header plus AES-256-GCM frames, because
  a single `crypto.subtle.encrypt` over a multi-gigabyte archive would need it
  all resident in memory. Accepted consequence, stated plainly in the UI copy: a
  lost passphrase is an unrecoverable archive, and we cannot open it either.

## DEV-003 — Forgotten-passcode recovery is a Recovery Kit, not the OS credential

- **Date:** 2026-07-26 · **Status:** **decided by founder 2026-07-26**
- **What:** SEC-LOC-03 (and AUTH-005) specify that forgotten-PIN recovery goes
  "via the OS device credential (BiometricPrompt/device PIN, Windows Hello),
  never security questions, never a backdoor code". ADR-018 instead recovers a
  forgotten passcode with a **one-time Recovery Kit code** (160 random bits,
  shown once at setup) that independently unwraps the same data key. There is
  no OS-credential route to the data key at all.
- **Why:** Electron exposes `safeStorage` (DPAPI) but **no way to prompt for
  the Windows credential**. An OS-credential "recovery" would therefore be an
  unwrap that any process running as the logged-in user can perform without
  proving anything — reducing the passcode to protection against file theft
  only, while anyone sitting at the unlocked machine walks past it. Presented
  with that trade-off the founder chose the Recovery Kit, which is the same
  mechanism ADR-005 already blesses for private notes, keeps the passcode
  meaningful against a local attacker, and additionally becomes the supported
  device-migration path (files + code on a new machine). The rule's real
  intent — "never security questions, never a backdoor" — is honoured: a
  user-held random key is neither.
- **Scope:** the local account's key chain (ADR-018). SEC-LOC-01 (PIN never
  used directly as a key; device-bound secret mixed in), SEC-LOC-02
  (keystore-bound attempt counter) and SEC-LOC-04 (zero network traffic) are
  implemented as written. If Windows Hello becomes reachable from Electron, it
  can be added as an *additional* unlock factor without changing this chain.
- **Hello feasibility recon (2026-07-31, founder-triggered — "add only if it
  is not a big deal"):** verdict **skip for now**. The only route that is
  real crypto rather than presence-theater is WebAuthn + the PRF extension
  (TPM-bound secret, zero new dependencies, and the identical code becomes
  the future web unlock) — but it requires re-plumbing production renderer
  serving off `file://` onto an https-style origin (the most
  security-sensitive load path), and Hello-side PRF exists only on Windows 11
  25H2 + Feb-2026 KB machines, so the toggle would hide almost everywhere.
  Every cheaper trick (UserConsentVerifier boolean, spawned PowerShell,
  safeStorage) is exactly the DPAPI theater this entry already rejected —
  pre-2023 Bitwarden's publicly broken design. Native KeyCredentialManager
  works (Bitwarden's fix) but means writing and owning a custom N-API module
  — the definition of a big deal here. **Revisit triggers, recorded:** (a)
  the renderer moves to an https-style origin for web-portability — Hello
  then becomes an S-effort add (enroll = WebAuthn create with PRF, wrap the
  data key via HKDF(PRF secret); passcode and Kit wraps untouched); (b) 25H2+
  saturates the installed base.
- **Related amendment (not a deviation from the security baseline):** the same
  founder decision raises AUTH-004's "minimum 4 digits" to a **minimum
  8-character alphanumeric passcode**. PRD 06 is amended, not deviated from —
  it already allowed "longer numeric or alphanumeric passcodes".

## DEV-004 — Anki import strips media instead of importing it

- **Date:** 2026-07-31 · **Status:** **confirmed by founder 2026-07-31** ("Ok,
  ali ako moze da se kaze korisniku sto nije uvezeno da zna u cemu je problem
  super"). The founder's one ask — tell the user WHAT was not imported — is
  already the shipped behaviour: the import report names per-kind counts
  („N slika, M zvučnih zapisa nije uvezeno"). No further work.
- **What:** PRD 15 STUDY-011 says "media included" and its acceptance line asks
  for "reviewable cards **with media**". ADR-052's importer instead STRIPS
  `<img>` and `[sound:…]` references from imported fields, with per-kind named
  counts in the import report („N slika, M zvučnih zapisa nije uvezeno").
- **Why:** a Nexus card is plain text + MathText — there is no card-attachment
  table and the card renderer draws no HTML, so an image reference has nowhere
  to land. Building inline card media is its own feature (a card-attachment
  store, a renderer image path, blob plumbing), not an import detail; smuggling
  it in through the importer would produce a second, import-only media system.
  The alternative of filing media as subject materials was considered and
  deliberately not built for v1 — a filing cabinet is not inline media, and it
  would misrepresent what the cards show.
- **Scope:** STUDY-011 v1 (ADR-052). If/when cards gain inline media, the
  importer's strip step becomes a mapping step; the named counts in the report
  are the contract that nothing was silently lost. Research OQ#4 (media in
  Anki decks: include or defer) is hereby answered: deferred.

## DEV-005 — Foreign SQLite (.apkg) is parsed in the main process, not a sandbox

- **Date:** 2026-07-31 · **Status:** **accepted (decision delegated by founder
  2026-07-31** — asked directly, the founder answered "Ne znam sta me pitas";
  per the working agreement the technical call falls to engineering and is
  recorded here so it can be revisited).
- **What:** SEC-FILE-01's spirit prefers hostile file formats parsed away from
  privileged processes. ADR-052's Anki importer instead deserializes a foreign
  SQLite collection INSIDE the Electron main process — readonly, from memory
  (never touching disk), behind the nine-point mitigation block commented at
  the deserialize site (size caps, readonly connection, no attached databases,
  bounded statement surface, etc.).
- **Why accepted:** Electron offers no cheap sandboxed helper for native
  SQLite; a utility-process design would need its own better-sqlite3 build and
  IPC marshalling of the whole collection — large, new attack surface of its
  own, for a file the USER personally chose through a native picker. The
  mitigation block reduces the practical surface to better-sqlite3's
  deserialize path on capped bytes.
- **Scope / revisit trigger:** if the importer ever accepts files NOT
  hand-picked by the user (auto-watch folders, URL fetch), this decision must
  be re-opened before that ships.

## DEV-006 — The canvas carries the trade's colours, not the system palette

- **Date:** 2026-08-19 · **Status:** **confirmed by founder 2026-08-19**
  (asked as one of four questions opening ADR-085; answer: *„Domenske boje su
  izuzetak SAMO unutar platna"*).
- **What:** `CLAUDE.md`'s design rules ban blue and orange as system hues. The
  Elektronika canvas uses both: a wire is red for 5 V, black for ground, blue
  very often for I²C SDA, yellow for signal; an Arduino UNO's silkscreen is
  teal. These arrive as a new token group `--nx-elec-*` in `packages/tokens`.
- **Why:** inside a wiring diagram colour is **data, not decoration**. An
  engineer reads a wire's colour the way they read a number, and the convention
  is not ours to reassign. Remapping onto the eight-accent palette would produce
  a diagram that is wrong in the one way a wiring diagram must never be — and
  useless the moment it is printed or compared against real jumper wires on a
  desk.
- **Scope — and it is narrow on purpose:** the exemption reaches the canvas
  surface and the component legend, and nothing else. Navigation, buttons,
  panels, selection, chips, charts and every other system surface stay strictly
  in Dan/Noć. The colours are still **tokens** — `check:colours` still refuses
  raw hex outside `packages/tokens`, both themes are still designed rather than
  inverted, and `check:contrast` still applies wherever one of these sits behind
  text.
- **Revisit trigger:** if an `--nx-elec-*` token is ever read from outside the
  Elektronika module's own surfaces, this deviation has been overrun and the
  rule needs re-stating rather than re-interpreting.
- **The scope is enforced, not remembered (2026-08-21).** The two bullets above
  are a rule over a *reachability set*, which is the shape [DC-61] was written
  about: stated as „inside the canvas", it permits everything outside it, and
  nothing in CSS distinguishes `var(--nx-elec-wire-blue)` on a bench from the
  same token on a button. Both resolve; both satisfy `check:colours`, which only
  refuses raw hex. So the fourteenth static gate, **`check:elec`**, reads and
  declares: a `--nx-elec-*` token may appear only in
  `apps/desktop/src/renderer/src/styles/electronics.css`. The allowlist is a
  single path rather than a directory pattern, so a second workbench surface is
  admitted by a decision — one that widens this section in the same change —
  rather than by matching. The revisit trigger above now fires by itself.

## DEV-007 — Nexus may spawn an external process (ROS 2 / Gazebo / Docker)

- **Date:** 2026-08-19 · **Status:** **confirmed by founder 2026-08-19**
  (*„I stvarno pokretanje (ros2/gazebo/docker) iz Nexusa"*, chosen over the
  in-app-simulation-only option that was recommended).
- **What:** ADR-085 §5. Until now the main process contained **no
  `child_process` call at all** — the product had exactly one capability
  boundary, the network one, and `apps/desktop/src/main/net/offline.ts` plus
  `check:egress` guard it. Slice E6 adds a second: the Elektronika module may
  start `ros2` / `colcon` / Gazebo, natively or through WSL2 or Docker, against
  a workspace Nexus generated.
- **Why accepted:** the feature the founder asked for is *„simulacija mašine
  koju je povezao"*, and a robotics stack cannot be shipped inside an NSIS
  installer (1–2 GB, per platform, and it would make Nexus the distributor of
  somebody else's runtime). The alternative that avoids execution entirely —
  export the workspace and let the user run it — was offered and declined.
- **Mitigations, all of which are load-bearing rather than reassuring:**
  1. **The command line is never data.** It comes from a closed table of runner
     profiles in source; the circuit contributes only the path of the generated
     workspace. This is what stops an imported `.nexus.zip` from being remote
     code execution, and it gets its own gate, `check:runner`.
  2. **Off by default**, with a one-time consent screen that prints the literal
     command that will be executed.
  3. **The renderer never names a command** — it asks to run *a circuit id*, and
     main decides everything else, through the existing typed IPC allowlist.
  4. **One run at a time, an explicit stop, killed on app quit**, with output
     captured, size-capped and append-only.
- **Scope / revisit trigger:** this covers a workspace **Nexus itself
  generated**, in a directory Nexus owns. If the runner is ever pointed at a
  directory the user supplies, or at a workspace that arrived in an import, this
  decision must be re-opened before that ships — at that point the thing being
  executed is no longer something the product wrote.

### Amendment, 2026-09-22 — the WSL profile runs the user's own shell startup

Measured while building the slice, and recorded because it is a **widening of
mitigation 1** even though it is what the feature needs.

- **What:** the WSL profile's command is
  `wsl.exe -d <distro> --cd <workspace> -e bash -ic "exec colcon build"`, and its
  probe is the same shape with `echo "$ROS_DISTRO"` as the script. **`-i` means
  that shell reads the user's own `~/.bashrc`**, so a run executes whatever that
  file does at startup, and the probe reads its output as an answer.
- **Why it is necessary:** ROS's documented setup appends
  `source /opt/ros/<distro>/setup.bash` to `~/.bashrc`; Ubuntu's `.bashrc` — and
  every file derived from it — opens with `case $- in *i*) ;; *) return;; esac`;
  and a login shell (`-lc`) reports `$-` as `hBc`, with no `i`, so that guard
  returns before the ROS line is reached. `-lc` would report a **correctly
  configured** distribution as unusable, while the user's own terminal worked —
  both answers „right", and the app's the useless one.
- **Why it is acceptable:** `~/.bashrc` is code the user wrote on their own
  machine and already runs every time they open a terminal. Nexus neither writes
  it nor reads it, the profile is one the user chose explicitly, and the whole
  command line remains a literal from the closed table — the shell is running the
  user's file, not the circuit's.
- **The residual, stated plainly:** a run inherits whatever that startup defines
  — environment, functions, aliases — so „Nexus runs `colcon build`" is really
  „Nexus runs `colcon build` in the shell the user configured". That is more than
  mitigation 1's sentence says, and it is confined to the WSL profile: `native`
  spawns the binary directly with no shell at all, and `docker` runs in an image
  whose entrypoint sources ROS itself and needs no `bash -ic`.

Two refinements of the existing mitigations, recorded here because they are the
current shape of the command rather than changes to it: the Docker probe is
`docker version` and **not** `docker --version` (measured: with Docker Desktop
installed and its engine stopped, `--version` exits 0 with the client's version,
which would tell the user the profile is ready and then fail on a pipe), and the
child's environment drops `DOCKER_*` and `WSLENV` — both are *redirections*, and
a `DOCKER_CONTEXT` pointing at another machine would make every path in the
argv, and every answer about „is the container still there", be about a computer
the user is not sitting at.

## DEV-008 — Releases ship without a code signature

- **Date:** 2026-10-02 · **Status:** **confirmed by founder 2026-10-02**
  (*„Napravi release i kaži da je signing trenutno stopiran ali da je projekat
  sada open source za sve koji žele da se uvere da je sa kodom sve u redu"*).
- **What:** SEC-EL-07 requires releases to be code-signed, and SEC-SC-05
  releases only CI-built, signed artifacts. The 1.4.0 and 1.5.0 Windows
  installers and the Linux files are CI-built but carry no Authenticode
  signature, and Windows shows a SmartScreen warning on first run.
- **Why accepted:** no signing route is in place yet, and the source of the
  release is public. Anyone can read what the installer does, and the files can
  be tied to the code they came from without trusting a publisher name.
- **Mitigations:**
  1. **CI-built only.** The release workflow builds from the tagged commit, and
     no file is uploaded by hand.
  2. **Verifiable provenance.** Every file ships with `SHA256SUMS.txt`, a
     CycloneDX SBOM and a build-provenance attestation
     (`gh attestation verify <file> --repo lukastojiljkovic/Nexus`).
  3. **Said where it is downloaded.** The release notes, the README and the
     website state that signing is paused.
  4. **Updates are gated by a key, not by the certificate.** ADR-089 (2026-10-07)
     replaced the updater rather than re-arming one: 1.4.0 shipped
     `electron-updater` as a dependency but never called it, and 1.5.0 removes
     the dependency. The update check verifies a detached Ed25519 signature
     against a public key compiled into the app, over a checksum file that then
     pins the installer's hash. That meets SEC-EL-07's update-verification
     clause, so the missing Authenticode certificate no longer blocks an update;
     SEC-EL-07's code-signing clause stays open here. It is offered only when
     the user turns update checks on, and nothing downloads until they press
     **Download and install**.
- **Revisit trigger:** a signing route (SignPath Foundation for open-source
  projects, or Azure Artifact Signing). The first signed release closes this
  deviation for the SmartScreen warning and for SEC-EL-07's code-signing clause
  and SEC-SC-05 (signed artefacts); it is no longer a condition for updates,
  which ADR-089 settles with the pinned key.
