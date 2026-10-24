# Nexus 3.0 Design

**Status:** approved implementation design
**Date:** 2026-10-24
**Working version:** 2.5.1
**Release version after all gates and live QA:** 3.0.0

## Goal

Finish the v2.5.1 defect round as a coherent v3 release: Nexus starts on Linux
without a system key vault, every account can choose to have no account
passcode, the onboarding questionnaire is gone, every account initially sees
every registered module, Cookbook saving and filtering are reliable, Astronomy
shows a sky and a textured Pluto, Gallery becomes a real module, local models
can be loaded and ejected explicitly, content-pack downloads show real progress
under their own Settings category, and the Whisper model labels describe the
actual trade-off.

## Non-goals

- Changing how Private Notes derives, wraps, or gates its independent key.
- Indexing all text or all images of a large ZIM library at startup.
- Uploading personal images or personal data.
- Re-enabling web, cloud sync, or pairing work.
- Inventing placeholder art, astronomy facts, model capabilities, or progress
  values.

## Product decisions

### Accounts

1. An account passcode is optional. A no-passcode account is convenience mode:
   its data key is obtainable from this device when the account is selected.
2. Private Notes keeps its own mandatory passcode and its own wrapped DEK. It
   never inherits account-passcode state and never becomes auto-unlocked because
   the account has no passcode.
3. Windows and macOS keep `safeStorage` as the preferred device protector.
4. When no usable OS vault exists, the account key material is stored in a
   separate owner-only file (`mode 0600` on POSIX). The create screen and
   Security card state that file-level protection protects against other users
   on the machine, not against code already running as this user or an attacker
   who can read that user's files.
5. Existing v1 key chains remain readable. Existing passcode accounts keep their
   passcode until the user explicitly removes it.
6. Removing the account passcode requires proof of the current passcode, or the
   Recovery Kit when the system vault is unavailable. Adding a passcode requires
   no prior passcode for a convenience-mode account and follows the existing
   passcode policy.
7. A convenience-mode account still supports the Recovery Kit for migration.
8. Account locking still closes the database and drops keys. A convenience-mode
   account can be reopened by selecting it and pressing "Open"; it has no
   credential prompt. Auto-lock remains available but the UI explains that it is
   a privacy screen, not an authentication boundary.

### Profiles, modules, onboarding

1. Account creation immediately creates and names the personal profile with a
   localized default name. No shell state waits for a questionnaire.
2. New profiles are named at creation and enter the shell immediately.
3. Existing blank-name profiles are normalized once to the localized default.
4. The onboarding component, draft, presets, settings rerun action, manual
   entries, search rows, and screenshot scenes are removed.
5. Every registered module is visible on a fresh install and after the v3
   visibility migration. Users may still hide modules later through Settings.
6. A v2 visibility file is migrated by clearing inherited `hidden` entries once;
   later explicit choices remain effective.

### Cookbook

1. Saving catches no error as "missing title". The editor validates fields
   locally, then reports the exact refusal category returned by main.
2. The save pipeline is tested from the real renderer draft shape through the
   module IPC handler into `RecipeStore.create`/`update`.
3. Search and filters combine. Filters are course, tag, collection, favourite,
   source, and completeness where the stored data can answer them.
4. Search still matches title, tag, and ingredient through main. The renderer
   applies only filters that do not need hidden child rows; completeness means
   has ingredients and steps and is derived from main-owned summary fields.

### Astronomy

1. The `planet-textures` pack grows a `sky` image for a Milky Way star field and
   a Pluto day map.
2. Sky and Pluto use sources with a stable URL, measured digest, and quotable
   licence evidence in `sources.json`.
3. `textures.json` remains layout 1 with an additive optional top-level `sky`
   object. Older readers ignore it; the v3 reader validates it.
4. The sky is rendered as a large inward-facing equirectangular sphere or
   equivalent background geometry, excluded from picking and lighting, and
   disposed with the scene. A missing sky remains the token-coloured empty space.
5. Pluto uses the same body texture path as every other body.
6. Per-image credits remain visible in the 3D view.

### Gallery

1. Gallery is a discovered module with id `gallery`, its own manifest, contract,
   main registration, page, copy, settings entry, search entry, manual pages,
   and screenshot scenes.
2. Public sources:
   - installed signed `dataset` packs carrying `art.json`;
   - images embedded in installed Reference/ZIM libraries.
3. Personal source:
   - user-selected images imported through main into the existing encrypted
     content-addressed blob store;
   - metadata in a new profile-scoped SQLite table;
   - thumbnails generated by main and stored as encrypted blobs;
   - export/import in the profile archive carries metadata and both original and
     thumbnail blob references.
4. Public art works are read-only. Personal images support import, title/notes,
   tags, search, full viewer, delete with confirmation, and orphan-blob cleanup.
5. ZIM images are read-only and addressed through the existing `nx-zim://`
   protocol. Gallery lists image entries in bounded batches; no full-library
   index is built at startup. The scan runs off the UI thread and can be
   cancelled.
6. No image is duplicated into the profile merely because a pack or ZIM is
   installed.
7. The grid uses generated thumbnails for personal images and pack/ZIM protocol
   URLs for public images. The viewer exposes dimensions, source, credit,
   licence, and a link back to the source pack or library.

### Local model memory

1. Translator gains `runtime`/`load`/`eject` operations with states `absent`,
   `loading`, `resident`, `ejecting`, and `error`.
2. Loading is explicit and also happens automatically before a translation when
   the chosen model is absent.
3. Eject terminates the utility process, releasing model memory. A load warms
   the model without translating text.
4. The existing 15-minute idle unload remains. Profile changes and account lock
   dispose the worker. The renderer shows the resident model, load progress,
   eject, and the idle policy.
5. The same audit records which other local runtimes already release memory on
   session end; any missing release is fixed in the owning module.

### Content packs

1. Content Packs is its own top-level Settings category, separate from Data.
2. The existing catalogue/install/remove/verify surface moves there unchanged in
   capability.
3. Download rows show a determinate progress bar from
   `PackDownloadProgress.bytesDone / bytesTotal`, received and total bytes,
   current file/count, elapsed time, and a measured transfer speed derived from
   progress timestamps. Pause, resume, and cancel remain available where the
   backend supports them.
4. `whisper-small` keeps its pack id but is labelled as the higher-accuracy,
   slower Whisper tier. Catalogue metadata and docs use the same wording.

## Security and data invariants

- No path, database key, private-note plaintext, or ZIM filesystem path crosses
  to the renderer.
- Private Notes remains invisible to Gallery, search, assistant, backups in
  locked form, and every public IPC surface.
- An account with no passcode is visibly described as device-convenience, not as
  encrypted behind a secret.
- The owner-only fallback file must be created with restrictive permissions
  before any secret is written and must never be included in profile archives.
- Pack and ZIM reads remain signature/verification and manifest/path gated.
- Imported gallery bytes are sniffed in main, capped, hashed, encrypted, and
  cleaned up if the metadata write fails.

## Compatibility and migrations

- Keychain file version 2 supports optional passcode wraps while reading version
  1 unchanged.
- Profile migration fills blank names with the localized personal default.
- Visibility migration version 2 resets inherited hidden modules once.
- Gallery adds one profile-scoped table and archive section; no existing table is
  rebuilt.
- Planet texture layout stays 1; `sky` is optional.
- Translator and pack catalogue wire changes are additive.

## Acceptance criteria

- A clean Linux account can be created and opened with no keyring and no
  account passcode.
- A fresh account lands directly on Dashboard with every module visible.
- Private Notes still refuses access until its own passcode is set and entered.
- A new Cookbook recipe with ingredients and steps saves and reopens; every
  filter combines with search.
- Astronomy renders the sky and Pluto when `planet-textures` is installed.
- Gallery lists art-pack images and downloaded ZIM images and stores imported
  personal images across restart and profile export/restore.
- Translator can load, identify as resident, translate, eject, and visibly
  return to absent.
- Content Packs is a top-level section and a real download shows byte progress,
  speed, pause/resume, and cancel.
- Whisper tiers read as tiny/balanced/accuracy rather than calling the most
  accurate tier merely "small".
