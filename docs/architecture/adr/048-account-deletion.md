# ADR-048 — In-app account deletion (addendum to ADR-044 / AUTH-022)

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Extends:** ADR-044
(multiple local accounts), which deliberately left deletion unspecified.

## 1. The requirement, read locally

PRD 06 AUTH-022: deletion requires re-authentication and an explicit typed
confirmation, offers export first, 14-day grace — **"Local-account deletion is
immediate after confirmation (with export offer)."** The grace period and the
server-side machinery are cloud-era; the binding local sentence is the last one.

**Deliberate local reading (flagged to the founder):** re-authentication by PIN
is NOT required. Three reasons, recorded: (1) a `requiresRecovery` account
(created on another device) can produce no passcode proof on this machine at
all — a PIN gate makes deletion impossible for exactly the accounts users most
want gone; (2) a wrong-PIN delete attempt would burn the same throttle that
guards unlock; (3) against a person with the machine, the gate is theatre —
they can delete the directory on disk. The **explicit typed confirmation** is
kept and does the intent-proving work: the user types the account's label.

## 2. Surface: the picker, and only the picker

Deletion lives in the account picker (the lock screen), joining „Preimenuj" as
a trailing action — the surface ADR-044 §5 established for account management.
By construction the app is locked there: the database is closed, no SQLite
handle pins `nexus.db` on Windows, and no `performLock` choreography is needed.
Settings deliberately does not offer deletion (PRD 07's "surfaced in Settings"
is the cloud account's story).

The flow takes over the row's card exactly like the rename form: „Obriši" →
the card becomes a confirm step showing a warning that names the label, an
advisory export sentence („Ako želiš izvoz podataka, otključaj nalog i uradi ga
u Podešavanjima pre brisanja." — advisory, never a precondition: a
`requiresRecovery` account could never meet it), a text field where the user
must type the account's **label** exactly (trimmed comparison), and
„Obriši nalog" (danger Button variant) enabled only on match, beside „Otkaži".
Escape cancels. The typed-label check is renderer-side UX; it is not a security
boundary (the renderer is untrusted regardless — main's gate is
`assertTrustedSender` + `asAccountId`).

- **Any account may be deleted, including the selected one** (nothing is open
  while locked). After deletion the selection re-points per §4.
- **The last account may be deleted.** Zero accounts returns the app to
  first-run: `computeAuthStatus` already answers `uninitialized`, and the
  delete flow must explicitly drive `AuthGate` to the `"create"` screen (the
  gate computes its screen once in a `useState` initializer — a status refresh
  alone leaves the user on an empty picker).

## 3. Crash-resumable destruction: tombstone rename first

The recon found two real resurrection hazards in a naive delete: registry-first
crashes let `loadRegistry`'s adoption rule re-adopt the directory as „Moj
nalog"; keychain-first crashes make the directory look "under construction", so
the next create resumes into it and bricks itself against the old encrypted db.
The fix is the migration ladder's own idiom — one same-volume rename is atomic:

1. **`renameSync(accounts/<id>, accounts/<id>.deleting)`** — the commit point.
   The directory instantly vanishes from every scan.
2. **Registry write** — drop the entry; if `lastActiveId` named it, re-point to
   the first remaining account or null. (Crash between 1 and 2 self-heals: the
   reconciler's existing rule 1 drops an entry whose directory is gone.)
3. **`rm -rf` the tombstone, best-effort.** A Windows share-violation leaves
   the tombstone in place; the operation still reports success.

Supporting changes, both required: `accountDirNames` and `beginAccountDir`
must **exclude `*.deleting` directories** (today the first returns every
directory and the second resumes into any keychain-less one), and a **boot
sweep** beside `wipeAllTmpOpenDirs` purges leftover tombstones best-effort.
`holdsKeychain`'s meaning is preserved because tombstones are never scanned.

What dies with the directory (nothing lives outside it): keychain + DPAPI guard
ciphertext (there is no OS-keystore entry — `safeStorage` output is stored in
`keychain.json`), the db triplet and any `.pre-encryption` residue, `blobs/`,
legacy `attachments/`, `tmp-open/`. The two `profileId`-prefixed calendar
`localStorage` keys are accepted as orphans (ADR-044 §6's no-re-keying
decision), recorded here.

## 4. Wire

`auth:delete-account` (symmetric with the nine `auth:*` channels): payload
`{ accountId }` validated by `assertTrustedSender` + `asRecord` + `asAccountId`
(registry membership — the renderer can name no path main did not create);
returns the fresh `AuthStatus` like select/rename. Registered in the three
places: `shared/ipc.ts` channel + request type + api method, one frozen preload
method, one handler. No passcode field exists on this channel.

## 5. No grace, no undo — recorded

Immediate destruction per AUTH-022-local. The restore/import one-slot undo does
not generalize: it is deliberately RAM-only and dies on lock, and holding a
whole account's decrypted contents resident is exactly what the security
posture forbids. No filesystem trash/grace precedent exists in the codebase and
none is introduced.

## 6. Proof

TDD in `accounts.test.ts`: tombstone excluded from both scans; delete of a
mid-list / selected / last account leaves the registry consistent; the
crash-between-steps states self-heal on the next `loadRegistry`; the boot sweep
purges tombstones and skips live accounts. The multi-account smoke rehearsal
gains a delete leg (create a second account, delete it, assert registry and
directory state). Serbian copy in `strings.ts` under the picker block; any new
error surfaces through the existing `authErrorMessage` map.
