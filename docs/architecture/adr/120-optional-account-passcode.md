# ADR-120 — Optional account passcode and the no-vault fallback

**Status:** Accepted · 2026-10-24. Amends [ADR-018](018-local-account-passcode.md).

## Context

ADR-018 made a passcode mandatory and used `safeStorage` to hold the device
secret that bounds passcode guesses to the current OS account. That assumed a
usable system vault. On a Linux session without a working secret service,
Electron reports that encryption is unavailable, so a new user cannot finish
account creation even though the encrypted database and Recovery Kit are ready.

The product also needs a deliberate convenience mode. A user may want Nexus to
open without an account secret while keeping Private Notes behind its own
mandatory credential.

## Decision

1. `keychain.json` gains version 2. It retains the KDF parameters, optional
   passcode wrap, Recovery Kit wrap and device wrap. Version-1 files remain
   readable and keep requiring their passcode until the user changes that choice.
2. A convenience-mode account has no passcode wrap. Its data key is wrapped by a
   random device secret, so selecting the account can reopen it without a prompt.
3. `safeStorage` remains the preferred protector. When it is genuinely
   unavailable, the device secret and throttle state go in an owner-only
   `guard.json` created with mode `0600` before any secret bytes are written,
   replaced atomically, and refused if either the file or its temporary path is a
   symlink or non-regular file.
4. The owner-only guard is not an authentication boundary against code running
   as the same OS user. The create and Security surfaces say that plainly.
5. The keychain file is the account's commit point. A separate owner guard is
   published before the keychain, so a failed guard write cannot leave an
   account that looks initialized while its Recovery Kit was never shown.
6. Adding a passcode to a convenience account and removing one from a protected
   account rewraps the same data key. Removing it requires the current passcode;
   an account already using the owner-only fallback may prove ownership with its
   Recovery Kit.
7. Private Notes is unchanged. It always has its own passcode, wrapped DEK and
   lock state. It never inherits the account's convenience mode.
8. Locking still closes the database and drops keys. Reopening a
   convenience-mode account is an explicit **Open** action, not an automatic
   background unlock.

## Consequences

- Linux users without a secret service can create, close, reopen and recover an
  account.
- The passcode remains available as an extra possession check, but it is no
  longer the only supported account mode.
- File-theft protection in convenience mode depends on account-level OS access
  controls; a copied owner-only guard is sufficient to reopen that copied
  account.
- Recovery Kits remain mandatory in the create flow because they are the only
  migration path when device protection is absent.
