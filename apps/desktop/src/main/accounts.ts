import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { shellStrings } from "./shellStrings.js";

/**
 * The local-account registry and the one-way move from the old flat layout
 * into it (ADR-044, AUTH-006). Deliberately Electron-free and impure only
 * about the filesystem: every function takes the `userData` directory as its
 * first argument, exactly the discipline `main/auth.ts` and
 * `main/attachments.ts` follow, so `main/index.ts` stays the only module that
 * ever resolves `app.getPath`.
 *
 * The layout this module owns:
 *
 * ```
 * <userData>/accounts.json                  the registry (plaintext, by design)
 * <userData>/accounts/<accountId>/          one account, everything it owns
 *     keychain.json                         main/auth.ts's key chain
 *     nexus.db (+ -wal, -shm, .pre-encryption)
 *     blobs/  attachments/  tmp-open/
 * ```
 *
 * The registry is PLAINTEXT on purpose: its labels are what the lock screen
 * lists before anything is unlocked, so they cannot live inside an encrypted
 * database. That is a deliberate disclosure — the account names are readable by
 * anyone with the disk — and the create form says so in as many words. Nothing
 * else about an account is stored here; its contents remain encrypted under its
 * own key chain.
 */

/** The registry's file name, directly under `userData` (never inside `accounts/`, which holds only account directories). */
export const ACCOUNTS_REGISTRY_FILE_NAME = "accounts.json";

/** The directory every account lives under. */
export const ACCOUNTS_DIR_NAME = "accounts";

/**
 * The label given to an account nobody named: the single account a legacy flat
 * install becomes (ADR-044 section 3), and one adopted from a directory whose
 * registry entry never landed (a create that died between writing the keychain
 * and writing the entry). Both are renameable from the picker, so a generic
 * name costs the user one rename and never costs them their data.
 *
 * Text lives in `shellStrings.ts` (the main process's shell/persisted-default
 * copy table) and is read through this accessor at the moment an account is
 * created, so the language the row is born in is the language the user was
 * reading.
 */
export function defaultAccountLabel(): string {
  return shellStrings().defaultAccountLabel;
}

/** Same cap as a profile name (`asProfileName`) — the two are the same kind of short, user-chosen title. */
export const MAX_ACCOUNT_LABEL_LENGTH = 80;

/**
 * What a deleted account's directory is renamed to (ADR-048). The suffix is the
 * whole commit protocol: `accounts/<id>` → `accounts/<id>.deleting` is one
 * same-volume `renameSync`, so the account either still exists or does not, and
 * every scan below skips the tombstone from that instant on — which is what
 * makes the erase that follows a mere cleanup rather than a step anything
 * depends on.
 */
export const DELETING_DIR_SUFFIX = ".deleting";

const KEYCHAIN_FILE_NAME = "keychain.json";
const DATABASE_FILE_NAME = "nexus.db";
const BLOBS_DIR_NAME = "blobs";
const LEGACY_BLOBS_DIR_NAME = "attachments";

/**
 * Every file name the database occupies: the main file, its WAL/SHM sidecars,
 * and the `.pre-encryption` backup `openEncrypted` leaves behind mid-migration
 * — which has sidecars of its own, since `copyDatabaseTriplet` copies all three.
 * A move that took the main file without them would hand SQLite a database with
 * stale WAL frames beside it.
 */
const DATABASE_FILE_NAMES: readonly string[] = [DATABASE_FILE_NAME, `${DATABASE_FILE_NAME}.pre-encryption`]
  .flatMap((base) => ["", "-wal", "-shm"].map((suffix) => `${base}${suffix}`));

/** One account as the registry records it. Nothing derived and nothing secret — see `AccountSummary` on the wire for the live per-account facts main computes on top of this. */
export interface AccountRegistryEntry {
  /** A UUID, and also the account's directory name. */
  id: string;
  label: string;
  createdAt: string;
}

export interface AccountRegistry {
  version: 1;
  /** Creation order, oldest first. `accounts[0]` is what a legacy migration produced, which is what makes it the owner of any flat residue. */
  accounts: AccountRegistryEntry[];
  /** The account to select at the next launch, or null when there is none to remember. */
  lastActiveId: string | null;
}

const EMPTY_REGISTRY: AccountRegistry = { version: 1, accounts: [], lastActiveId: null };

export function accountsRoot(userData: string): string {
  return join(userData, ACCOUNTS_DIR_NAME);
}

export function accountDir(userData: string, accountId: string): string {
  return join(accountsRoot(userData), accountId);
}

function registryPath(userData: string): string {
  return join(userData, ACCOUNTS_REGISTRY_FILE_NAME);
}

/** True once an account directory holds a key chain — the one signal that separates a finished account from a directory a create is still filling in. */
function holdsKeychain(dir: string): boolean {
  return existsSync(join(dir, KEYCHAIN_FILE_NAME));
}

function isEntryShape(value: unknown): value is AccountRegistryEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.label === "string" && typeof v.createdAt === "string";
}

function isRegistryShape(value: unknown): value is AccountRegistry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    Array.isArray(v.accounts) &&
    v.accounts.every(isEntryShape) &&
    (v.lastActiveId === null || typeof v.lastActiveId === "string")
  );
}

/**
 * Reads `accounts.json` as it stands, with no reconciliation against disk.
 *
 * A missing file means "no accounts yet". A file that exists but does not parse
 * — or whose shape this build does not recognize — is treated the same way, and
 * deliberately NOT as an error: unlike `keychain.json`, nothing here is
 * irreplaceable. Every account is a directory that still holds its own key
 * chain, so `loadRegistry` rebuilds the list from those directories on the next
 * boot; only the labels are lost, and a label is one rename away. Refusing to
 * start over a damaged index would be a far worse trade. Any OTHER filesystem
 * error (permissions, a bad handle) still propagates — that is a real problem
 * and reinterpreting it as "no accounts" would offer to create one on top of
 * data that is simply unreadable at this moment.
 */
export function readRegistry(userData: string): AccountRegistry {
  let raw: string;
  try {
    raw = readFileSync(registryPath(userData), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY_REGISTRY, accounts: [] };
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY_REGISTRY, accounts: [] };
  }
  if (!isRegistryShape(parsed)) return { ...EMPTY_REGISTRY, accounts: [] };
  return {
    version: 1,
    accounts: parsed.accounts.map((entry) => ({
      id: entry.id,
      label: entry.label,
      createdAt: entry.createdAt,
    })),
    lastActiveId: parsed.lastActiveId,
  };
}

/**
 * Writes `accounts.json` atomically — a sibling `.tmp` written and `fsync`'d
 * first, then `renameSync`d into place — the same discipline
 * `writeKeychainFileAtomic` uses, and for a related reason: a half-written
 * registry read on the next boot would look like a corrupt one, and the
 * rebuild that follows would silently drop every label.
 */
function writeRegistry(userData: string, registry: AccountRegistry): void {
  const path = registryPath(userData);
  const tmpPath = `${path}.tmp`;
  const fd = openSync(tmpPath, "w");
  try {
    writeSync(fd, JSON.stringify(registry, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, path);
}

/**
 * Every LIVE directory under `accounts/`, sorted, so every derived decision is
 * deterministic. Tombstones are excluded here rather than at each call site,
 * which is what closes both of deletion's resurrection hazards at once: a
 * tombstone that still holds its key chain would otherwise be ADOPTED by
 * `loadRegistry` as „Moj nalog", and one whose key chain a half-finished erase
 * already took would look "under construction" to `beginAccountDir`, which
 * would resume a fresh account into it — on top of the old encrypted database.
 */
function accountDirNames(userData: string): string[] {
  const root = accountsRoot(userData);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.endsWith(DELETING_DIR_SUFFIX))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Erases a tombstone, forgiving a failure. On Windows a file another process
 * still holds open cannot be removed, and `rmSync`'s `force` only forgives a
 * missing path, not a busy one — but by the time this runs the account is
 * already gone from every scan and from the registry, so a directory that
 * outlives one attempt is residue, not a failed deletion. The boot sweep tries
 * again.
 */
function purgeTombstone(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Left for `sweepDeletedAccountDirs` on a later launch.
  }
}

/** Erases every tombstone a previous run could not finish erasing. Runs once at startup, beside the `tmp-open` sweep, and for the same reason: the process that made the residue is not around to clean it up. */
export function sweepDeletedAccountDirs(userData: string): void {
  const root = accountsRoot(userData);
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.endsWith(DELETING_DIR_SUFFIX)) {
      purgeTombstone(join(root, entry.name));
    }
  }
}

/**
 * The registry, reconciled against what is actually on disk and persisted when
 * the two had drifted. Three rules, each of them one-directional so the pass is
 * idempotent:
 *
 * 1. An entry whose directory is gone is dropped — the user deleted the folder,
 *    and listing an account that cannot be unlocked helps nobody.
 * 2. A directory that holds a key chain but has no entry is ADOPTED under
 *    `defaultAccountLabel()`. That is a create (or a legacy migration) that died
 *    between writing the key chain and writing the entry; the data is intact and
 *    a lost label is not a reason to strand it.
 * 3. A `lastActiveId` naming no surviving account is cleared.
 *
 * A directory with NO key chain is neither dropped nor adopted: it is a create
 * still in flight (or one that failed), and `beginAccountDir` resumes into it.
 */
export function loadRegistry(userData: string): AccountRegistry {
  const stored = readRegistry(userData);
  const onDisk = new Set(accountDirNames(userData));

  const kept = stored.accounts.filter((entry) => onDisk.has(entry.id));
  const known = new Set(kept.map((entry) => entry.id));
  const adopted = [...onDisk]
    .filter((name) => !known.has(name) && holdsKeychain(accountDir(userData, name)))
    .map((name) => ({
      id: name,
      label: defaultAccountLabel(),
      createdAt: new Date().toISOString(),
    }));

  const accounts = [...kept, ...adopted];
  const lastActiveId =
    stored.lastActiveId !== null && accounts.some((entry) => entry.id === stored.lastActiveId)
      ? stored.lastActiveId
      : null;

  const reconciled: AccountRegistry = { version: 1, accounts, lastActiveId };
  // Only when the two genuinely differed. A first-ever launch reconciles
  // nothing against nothing, and must not leave an empty `accounts.json`
  // behind on an install that has yet to create a single account.
  const changed =
    adopted.length > 0 ||
    kept.length !== stored.accounts.length ||
    lastActiveId !== stored.lastActiveId;
  if (changed) writeRegistry(userData, reconciled);
  return reconciled;
}

/** True when the registry names this account. The IPC validator's membership check — an id the registry does not know is never turned into a path. */
export function accountExists(userData: string, accountId: string): boolean {
  return readRegistry(userData).accounts.some((entry) => entry.id === accountId);
}

/** Trims and length-checks a user-chosen label, or `null` when it is unusable. Mirrors `asProfileName`'s rule exactly; main re-checks it at the IPC boundary regardless (SEC-EL-02). */
export function normalizeAccountLabel(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_ACCOUNT_LABEL_LENGTH) return null;
  return trimmed;
}

function requireLabel(label: string): string {
  const normalized = normalizeAccountLabel(label);
  if (normalized === null) {
    throw new Error(`An account label must be 1-${MAX_ACCOUNT_LABEL_LENGTH} characters after trimming.`);
  }
  return normalized;
}

/**
 * Claims the directory an account is about to be created in, and returns its
 * id. A directory under `accounts/` that holds no key chain is "under
 * construction" — a create that never finished — so this RESUMES into it rather
 * than minting a second one. That is what keeps a failed create (a rejected
 * passcode, a crash) from stranding data an earlier step already moved in, and
 * it is why the same helper serves the first account, an additional one, and
 * the legacy migration alike.
 */
export function beginAccountDir(userData: string): string {
  const resumable = accountDirNames(userData).find((name) => !holdsKeychain(accountDir(userData, name)));
  const accountId = resumable ?? randomUUID();
  mkdirSync(accountDir(userData, accountId), { recursive: true });
  return accountId;
}

/** Records a finished account and makes it the one to select next. Called only AFTER its key chain is on disk — an entry that named a keychain-less directory would be an account nothing could ever unlock. */
export function registerAccount(
  userData: string,
  accountId: string,
  label: string,
  createdAt: string,
): AccountRegistry {
  const registry = readRegistry(userData);
  const entry = { id: accountId, label: requireLabel(label), createdAt };
  const accounts = registry.accounts.some((existing) => existing.id === accountId)
    ? registry.accounts.map((existing) => (existing.id === accountId ? entry : existing))
    : [...registry.accounts, entry];
  const next: AccountRegistry = { version: 1, accounts, lastActiveId: accountId };
  writeRegistry(userData, next);
  return next;
}

/** Renames an account. Possible while everything is locked, by design: the label is the only thing about an account the lock screen can show. */
export function renameAccount(userData: string, accountId: string, label: string): AccountRegistry {
  const registry = readRegistry(userData);
  if (!registry.accounts.some((entry) => entry.id === accountId)) {
    throw new Error("Unknown account id.");
  }
  const next: AccountRegistry = {
    ...registry,
    accounts: registry.accounts.map((entry) =>
      entry.id === accountId ? { ...entry, label: requireLabel(label) } : entry,
    ),
  };
  writeRegistry(userData, next);
  return next;
}

/**
 * Deletes an account and everything it owns (ADR-048), in the one order that
 * survives a crash at every step — the migration ladder's own idiom, where a
 * single same-volume `renameSync` is the commit point:
 *
 * 1. `accounts/<id>` → `accounts/<id>.deleting`. Atomic, and the instant it
 *    lands the account is gone from every scan `accountDirNames` feeds — the
 *    picker, the adoption rule and `beginAccountDir` alike.
 * 2. Drop the registry entry, re-pointing `lastActiveId` at the first survivor
 *    when it named the account being deleted. A crash between 1 and 2 needs no
 *    resume of its own: reconciliation rule 1 already drops an entry whose
 *    directory is gone, so the next `loadRegistry` finishes this by itself.
 * 3. Erase the tombstone, best-effort. A Windows share violation leaves it on
 *    disk and the deletion still succeeded — nothing can reach it, and the boot
 *    sweep retries.
 *
 * There is deliberately no undo and no grace period: the account's contents are
 * encrypted under its own key chain, which step 1 carries into the tombstone
 * and step 3 destroys. Holding any of it back would mean holding a deleted
 * account's plaintext, or its key, somewhere it could be found.
 */
export function deleteAccount(userData: string, accountId: string): AccountRegistry {
  const registry = readRegistry(userData);
  if (!registry.accounts.some((entry) => entry.id === accountId)) {
    throw new Error("Unknown account id.");
  }

  const dir = accountDir(userData, accountId);
  const tombstone = `${dir}${DELETING_DIR_SUFFIX}`;
  // Absent only when a previous attempt already got this far and died before
  // the registry write — its entry is what brought us back here.
  if (existsSync(dir)) renameSync(dir, tombstone);

  const accounts = registry.accounts.filter((entry) => entry.id !== accountId);
  const next: AccountRegistry = {
    version: 1,
    accounts,
    lastActiveId:
      registry.lastActiveId === accountId ? (accounts[0]?.id ?? null) : registry.lastActiveId,
  };
  writeRegistry(userData, next);

  purgeTombstone(tombstone);
  return next;
}

/** Remembers which account to open at the next launch. */
export function selectAccount(userData: string, accountId: string): AccountRegistry {
  const registry = readRegistry(userData);
  if (!registry.accounts.some((entry) => entry.id === accountId)) {
    throw new Error("Unknown account id.");
  }
  const next: AccountRegistry = { ...registry, lastActiveId: accountId };
  writeRegistry(userData, next);
  return next;
}

/**
 * Moves one path into an account directory, if it is still where it used to be.
 * `renameSync` within `userData` is a same-volume rename: a single filesystem
 * operation that either happened or did not, which is what makes the migration
 * ladder resumable at all — a crash can never leave a file half-moved, only
 * moved or not moved.
 *
 * A destination that already exists is left strictly alone: the move plainly
 * already ran, and overwriting would be the one way this module could destroy
 * data it was written to preserve.
 */
function moveIntoAccount(userData: string, accountId: string, name: string): void {
  const from = join(userData, name);
  const to = join(accountDir(userData, accountId), name);
  if (!existsSync(from) || existsSync(to)) return;
  renameSync(from, to);
}

function moveDatabaseInto(userData: string, accountId: string): void {
  for (const name of DATABASE_FILE_NAMES) moveIntoAccount(userData, accountId, name);
}

/**
 * Pulls a pre-ADR-044 install's data — both blob roots and the whole database
 * family — into an account directory, WITHOUT touching a key chain.
 *
 * This is the first-account creation path's half of the migration: an install
 * that predates encryption entirely has a plaintext `nexus.db` and no
 * `keychain.json` at all, so `resumeAccountsMigration` has nothing to key off
 * at boot and correctly leaves it flat. Account creation is the moment that
 * database acquires an owner, and it must be under the new account's directory
 * before `openEncrypted` looks for it — otherwise the encrypt-in-place ladder
 * would silently create an empty database beside the user's real one.
 */
export function absorbLegacyFlatData(userData: string, accountId: string): void {
  moveIntoAccount(userData, accountId, BLOBS_DIR_NAME);
  moveIntoAccount(userData, accountId, LEGACY_BLOBS_DIR_NAME);
  moveDatabaseInto(userData, accountId);
}

/**
 * Brings the on-disk layout up to ADR-044 and returns the reconciled registry.
 * Runs once at startup, before any IPC is answered, and is the ONLY writer of
 * the flat-to-nested move.
 *
 * The ladder, in the order a crash has to be able to resume from:
 *
 * 1. Reconcile the registry against the directories (`loadRegistry`), so a
 *    previous run that wrote a key chain but died before its entry is picked up
 *    here rather than one boot later.
 * 2. A `keychain.json` sitting directly in `userData` is a legacy flat install.
 *    Claim a directory (resuming into a half-filled one, never a fresh one
 *    beside it) and move, in this order: `blobs/`, `attachments/`,
 *    `keychain.json`, and only THEN write the registry entry. The key chain is
 *    the thing that makes a directory an account, so registering before it
 *    moved would publish an account nothing could unlock; registering after it
 *    moved is what makes the entry authoritative for everything still to come.
 * 3. Whatever database files remain flat belong to `accounts[0]` — the account a
 *    migration produced, and the only one that can ever be older than the move.
 *    This is both the last step of a clean migration and the resume for a crash
 *    between step 2 and it.
 *
 * Every step is a `moveIntoAccount`, which no-ops when the source is gone, so
 * running the whole ladder again changes nothing.
 */
export function resumeAccountsMigration(userData: string): AccountRegistry {
  let registry = loadRegistry(userData);

  if (existsSync(join(userData, KEYCHAIN_FILE_NAME))) {
    const accountId = beginAccountDir(userData);
    moveIntoAccount(userData, accountId, BLOBS_DIR_NAME);
    moveIntoAccount(userData, accountId, LEGACY_BLOBS_DIR_NAME);
    moveIntoAccount(userData, accountId, KEYCHAIN_FILE_NAME);
    registry = registerAccount(userData, accountId, defaultAccountLabel(), new Date().toISOString());
  }

  const [owner] = registry.accounts;
  if (owner) moveDatabaseInto(userData, owner.id);
  return registry;
}
