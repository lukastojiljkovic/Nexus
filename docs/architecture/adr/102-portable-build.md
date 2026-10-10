# ADR-102 — a portable build: Nexus on a stick, and the data on the stick too

**Status:** accepted (2026-10-10) · **Owner:** founder · Amends
[ADR-089](089-network-mode-and-update-check.md)

## 1. The finding

Nexus is built to keep everything it knows in one place, and that place is
Electron's `userData` — `%APPDATA%\Nexus` on Windows (PRIVACY.md's table, and
the About card prints the resolved path). Two facts already in this tree make a
USB stick nearly free, and one makes it not free.

**Nearly free, first: the path is decided by the process, not by the
installer.** `app.setPath` can point `userData` and `sessionData` anywhere, and
this tree already does exactly that for its harnesses: `--smoke` and `--shots`
redirect both into a disposable subdirectory, at MODULE SCOPE, and the comment
beside them records what happens otherwise — a redirect applied after `ready`
leaves the app's own files in the new directory while the renderer's
`localStorage` and HTTP cache stay in the real one. `logs` and `temp` are two
more names in the same path table, so the directories a build would otherwise
still scatter across the host are redirectable there too.

**Not free: the switch, and the updater.** Windows has no notion of a portable
install, so something has to say "this copy is the stick's". And ADR-089's last
step runs an NSIS installer, which installs per-user into the host's program
files and writes the host's registry; on a stick that is not an update, it is a
second copy of the app on somebody else's computer.

## 2. The decision

### 2.1 The marker is a file beside the executable

`portable.txt`, in the package root, beside `Nexus.exe`. **Its PRESENCE decides,
never its bytes.** A person can see it, delete it to turn the same folder back
into an ordinary build, or drop one into an extracted copy to make that folder
portable. Nothing is written to the host to remember the choice — which is the
point, because the next computer has no registry entry, no `%APPDATA%` folder,
and no memory of this one.

The file carries one sentence in each of the product's two languages, for the
person who finds it and wonders what it is. It is checked in as
`apps/desktop/build/portable.txt` and copied byte for byte by the packaging
script, so what is on a stick is what is in the repository — and because
presence rather than content is the switch, translating or reformatting it
changes nothing, which is stated here so that nobody later "fixes" the copy
path by parsing that sentence.

It is read at module scope in `index.ts`, before the harness sandbox, before the
resolver rule, and before `ready`. `main/portable.ts` holds the whole of it:
`decidePortable` is a pure function of the executable's directory and one marker
probe, which is what makes the acceptance's five cases — marker present, absent,
unreadable directory, a drive root, spaces and non-ASCII letters — five
arguments in a test rather than five launches of the app.

Three answers, and each is a decision rather than a fallback:

- **Absent — nothing changes at all.** Installed builds keep `%APPDATA%\Nexus`.
  This is measured, not asserted: the test that covers it counts the calls to
  the injected `setPath` and expects zero.
- **Present — everything moves, after the folder has proved it will take a
  write** (§2.2).
- **Unreadable, which is `stat` refusing rather than bytes refusing** — the
  marker's presence is read with `statSync`, so a marker whose *bytes* nobody
  may open is still a marker, while one that is a DIRECTORY, or one whose own
  `stat` is refused, answers `unreadable`. That case launches as an installed
  build and says so on stderr, naming the file. Neither alternative is
  acceptable: guessing "portable" would put a database beside an installed
  app's executable, and refusing to start over one unreadable file would make a
  working installation unbootable.

### 2.2 The four paths, and why `userData` is the root

`<exe dir>\NexusData\` is the whole of it:

| Electron path | Portable value | What lands there |
| --- | --- | --- |
| `userData` | `NexusData` itself | accounts, key chains, databases, blobs, packs, downloaded updates |
| `sessionData` | `NexusData\session` | Chromium's profile: `localStorage`, the HTTP cache, cookies |
| `logs` | `NexusData\logs` | this process's and Electron's logs |
| `temp` | `NexusData\temp` | scratch space, including the plaintext copies `tmp-open` makes |

**`userData` IS the root rather than a folder inside it**, so a person opening
the stick sees `accounts/`, `session/`, `logs/` and `temp/` side by side and has
exactly one folder to copy to the next stick. `sessionData` is kept apart from
it rather than set to the same path (which is what the harness sandbox does,
because the harness wipes its directory at every start): on a stick the cache
is a directory a user may delete without consequence, and a database is not.

All four directories are created and the root is proved writable BEFORE anything
is redirected. Creating them is not tidiness: `app.setPath` throws when the
directory does not exist (Electron's own documented behaviour), so the redirect
would otherwise fail on the first portable launch of every stick. And `mkdirSync`
alone is not enough to prove anything, because creating a directory that already
exists succeeds silently, read-only stick included — which is exactly the case
that has to be caught, so the root is asked for a WRITE instead. `index.ts`
shows the refusal — `dialog.showErrorBox` is documented as
safe before `ready`, which is the only reason a message can appear this early,
and the language comes from `app.getSystemLocale()` because the renderer that
would report the stored choice does not exist yet — and then exits. It does NOT
fall back to the host: a marker that asks for the stick, answered by writing the
user's life into `%APPDATA%`, is a worse outcome than not starting, and there is
nothing to salvage from a folder that will not take a byte. The OS's own words
for the failed write go on a second line, untranslated, because a diagnostic is
not copy.

### 2.3 The build

`pnpm --filter @nexus/desktop dist:portable` → `scripts/dist-portable.mjs`:

1. `electron-vite build`, as `dist.mjs` does;
2. `electron-builder --win dir --x64 --publish never`;
3. the same read-back an installed build gets — exactly the target's SQLite
   prebuild and no other (now one shared function, `scripts/packaged-binary.mjs`,
   because two artifacts have the same failure mode and a copy of that assertion
   is a copy that drifts);
4. `build/portable.txt` copied in as `portable.txt`, and an empty `NexusData/`
   created so the folder says where data will go before the first run;
5. the folder zipped, under one `Nexus/` top-level entry, to
   `release/Nexus-<version>-portable-win-x64.zip` (`scripts/portable-zip.mjs`;
   `yazl` is already this app's zip writer, so this adds no dependency).

Two outputs, and they are the same bytes: the folder
(`release/win-unpacked/`, copy it to the stick) and the archive (one file to
publish and download).

**`dir` is the only electron-builder target that produces what a stick needs.**
Every other Windows target is an installer, and an installer is the one shape
that cannot carry this feature: it unpacks into a directory the user never sees,
so there is no "beside the executable" for a marker to sit in. The `portable`
Windows target electron-builder ships is not this either — it is a
self-extracting archive that puts the app in `%TEMP%` and its data in
`%APPDATA%`, which is the opposite of the requirement; it is in the rejected
list below.

**The shipped configuration is not edited.** The target is a command-line flag,
and `electron-builder.yml` keeps its `files` list, its `asarUnpack`, its prebuild
rule and its Electron fuses exactly as they are. A portable build that drifted
from the installed one would be a second product to keep honest.

**Windows only.** `dist.mjs`'s host rule is one reason (an artifact nobody has
run is not a shipped artifact). The other is the product's: „run `Nexus.exe` on
any Windows computer" is what a stick is for, and the Linux equivalent is an
AppImage — a single FILE, where „beside the executable" means something else.
That is a decision this ADR does not take, so the script refuses and says so.

### 2.4 The self-update checks and reports, and installs nothing

`createUpdateService` gains one dependency, `portable`. In a portable build:

- **the check is untouched**, because the network mode and only the network mode
  decides whether it may reach the network (ADR-089, amended by ADR-092). A
  stick can therefore learn that a newer version exists, and the notice names
  it;
- **`offer.canInstall` is false**, so neither the app-wide notice nor the About
  card offers the button, and the release-page link — which is always present —
  is the way to the new version;
- **`install()` refuses**, with the new problem code `"portable"` and its own
  sentence in both locales. Unreachable through the UI, because the button is
  what `canInstall` hides; the refusal is there because a hidden button is UX
  and never a gate;
- the About row says why the button is missing instead of leaving the absence to
  be interpreted.

The reason is not caution about disk space. ADR-089's last step runs an NSIS
installer on the HOST: per-user program files, a Start-menu shortcut and a
registry uninstall entry. On a stick that installs a second Nexus onto somebody
else's computer while the copy the user is holding stays exactly as old as it
was.

## 3. Paths on a stick

**A drive letter that changes between computers costs nothing.** No path is
stored: `dirname(app.getPath("exe"))` is read on every launch, so `E:\Nexus` on
one computer and `F:\Nexus` on the next produce `E:\Nexus\NexusData` and
`F:\Nexus\NexusData` with no stale record anywhere. Spaces and non-ASCII letters
in the folder name are ordinary characters on the way through and are neither
encoded nor normalised.

The one exception is a path the USER typed: a scheduled backup's folder
(`backup.ts`'s `settings.folderPath`) is persisted, and a backup pointed at
`E:\…` on a stick that comes back as `F:` will not find its folder. That case is
already handled honestly — `runBackup` stats the folder first and refuses with
`folder-unreachable`, which is what the settings row reports — and this ADR
changes nothing about it.

**A read-only stick is refused with a message** (§2.2), not a crash and not a
silent fallback to the host.

**FAT32 caps one file at 4 GB** (4 294 967 295 bytes; the volume limit is not
the interesting one). Two features can hit that cap, and both are features whose
whole point is size: a pack of kind `zim` — an offline Wikipedia — and one of
kind `model` — the weights of a local model. `PACK_LIMITS.fileBytes` allows a
single content file up to 64 GiB, so the app's own cap does not stop it, and the
free-space check reads `statfs`, which reports volume space and knows nothing
about a per-file cap. What a user sees is the failure of the operation that
wrote the file — a pack install ending in `write-failed`, a download ending in
its own write error — rather than a diagnosis of the file system, because
detecting FAT32 would mean trusting a mount table this app cannot read
portably. Formatting the stick NTFS or exFAT removes the limit; 4 GB per file is
the one thing about a portable build that a stick's own format, rather than
Nexus, decides.

## 4. What this ADR does NOT do

- **No Linux portable build.** `dist-portable.mjs` refuses on any host but
  Windows and says what is undecided (§2.3).
- **The release workflow does not publish the portable zip yet.**
  `release.yml` calls `dist` and uploads what it produced; a portable archive
  has to be built and uploaded on purpose, which is a release-process decision
  rather than a code one.
- **No file-system pre-flight.** The app does not detect FAT32 or a read-only
  volume before the operation that needs it (§3).
- **Nothing else is redirected.** `crashDumps` follows `userData`, which is the
  stick in this mode; a GPU shader cache or a Chromium cache is either inside
  `userData`/`sessionData` or not written by this product at all.
- **The installed build is untouched.** No existing default moves, and with the
  marker absent the packaged app behaves exactly as it did before this ADR.

## 5. Consequences

- **`apps/desktop/build/portable.txt` is a shipped artifact** — user-facing copy
  outside every copy table, in two languages, because a text file beside an
  executable is exactly where somebody will look for an explanation.
- **`shellStrings.ts` gains two constants** (the title and the body of the
  read-only refusal), which is where main keeps text handed to Electron as-is.
- **`check:egress` is unaffected**: no host, no URL and no fetch is added.
  Nothing here touches the network.
- **`apps/desktop/scripts/packaged-binary.mjs` is new and `dist.mjs` now imports
  it** — the same check, one copy, run by both packagers.
- **The update contract gains one field and one problem code**
  (`UpdateStateView.portable`, `UpdateProblem["portable"]`), so the renderer can
  say why there is no Install button.
- **PRIVACY.md's „where" paragraph now has one more sentence**: in a portable
  build the data folder is `NexusData` beside the executable rather than
  `%APPDATA%\Nexus`. The rest of that table — what is stored, and what is
  encrypted — is unchanged, because only the root moved.

## 6. Alternatives rejected

- **electron-builder's `portable` Windows target.** A self-extracting archive
  that unpacks into `%TEMP%` and stores its data in `%APPDATA%`. It is a
  portable *distribution*, and the data still lands on the host, which is the
  one thing this feature exists to prevent.
- **A command-line flag (`--portable`) or an environment variable.** A flag is
  nothing a person can see on a stick, and it can be typed by whatever launches
  the app — the harness flags in `index.ts` are the cautionary tale, and half of
  their fix was refusing them in a packaged build.
- **A second config file, `electron-builder.portable.yml`.** It would be a
  second `files` list, a second `asarUnpack`, and a second place for the
  prebuild rule to be wrong, to gain one flag on a command line.
- **Redirecting after `ready`, or inside the `whenReady` block.** Chromium's
  session does not follow a `userData` changed after it exists; this tree
  measured that on 2026-09-26 and wrote it down beside the sandbox that was
  wrong for a day.
- **A marker whose content is read** — a version, a JSON document, a path. The
  bytes would then be a parser, a schema and a compatibility story for a file
  whose whole job is to be present.
- **Falling back to the host when the stick cannot be written.** The marker is
  the user's statement that the data belongs on the stick; writing it elsewhere
  instead is the failure mode a portable build is bought to avoid.
- **Refusing to start when the marker is unreadable.** One unreadable file would
  make a working installation unbootable, and the choice would be made by the
  file rather than by the person.
- **Treating an unreadable marker as portable.** The opposite mistake, and the
  worse one: a database would be attempted beside an installed app's
  executable, in a directory the user may not be able to write to at all.
