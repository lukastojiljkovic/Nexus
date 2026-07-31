/**
 * The complete IPC contract between the Electron main process and the renderer.
 * Imported by all three sides — main (handler registration), preload
 * (contextBridge surface), and renderer (`window.nexus` typings) — so there is a
 * single source of truth for channel names and payload shapes.
 *
 * SEC-EL-02: the channel set is a fixed, minimal allowlist. There is deliberately
 * no generic "invoke any channel" passthrough, and every request payload is
 * revalidated in the main process (renderer input is untrusted).
 */

// The one import this contract makes, and it is type-only (erased at build
// time, so preload and main gain no runtime dependency): a task list's view
// config is a nested grammar shared by the store, the archive reader and this
// wire, and the three of them must not each carry their own copy of it. Every
// other shape here stays redeclared — those are string unions and flat records,
// where a copy costs nothing and cannot drift silently.
import type { TaskViewConfig } from "@nexus/core";

/** The only channels the preload bridge and the main handlers agree on. */
export const IpcChannel = {
  authStatus: "auth:status",
  authCreate: "auth:create",
  authUnlock: "auth:unlock",
  authRecover: "auth:recover",
  authChangePasscode: "auth:change-passcode",
  authRegenerateRecovery: "auth:regenerate-recovery",
  authLock: "auth:lock",
  authSelectAccount: "auth:select-account",
  authCreateAdditional: "auth:create-additional",
  authRenameAccount: "auth:rename-account",
  authDeleteAccount: "auth:delete-account",
  profilesList: "profiles:list",
  profilesRename: "profiles:rename",
  profilesPicturePick: "profiles:picture-pick",
  profilesPictureClear: "profiles:picture-clear",
  flagsGet: "flags:get",
  flagsSet: "flags:set",
  tasksList: "tasks:list",
  tasksCreate: "tasks:create",
  tasksUpdate: "tasks:update",
  tasksSetDone: "tasks:set-done",
  tasksDelete: "tasks:delete",
  tasksRestore: "tasks:restore",
  taskListsList: "task-lists:list",
  taskListsCreate: "task-lists:create",
  taskListsRename: "task-lists:rename",
  taskListsSetView: "task-lists:set-view",
  taskListsSetViewConfig: "task-lists:set-view-config",
  taskListsMove: "task-lists:move",
  taskListsDelete: "task-lists:delete",
  taskListsRestore: "task-lists:restore",
  taskSectionsCreate: "task-sections:create",
  taskSectionsRename: "task-sections:rename",
  taskSectionsMove: "task-sections:move",
  taskSectionsDelete: "task-sections:delete",
  tasksMoveToList: "tasks:move-to-list",
  tasksMoveToSection: "tasks:move-to-section",
  tasksReorder: "tasks:reorder",
  tasksBulkMove: "tasks:bulk-move",
  tasksBulkPriority: "tasks:bulk-priority",
  tasksBulkDue: "tasks:bulk-due",
  tasksBulkDelete: "tasks:bulk-delete",
  tasksBulkRestore: "tasks:bulk-restore",
  taskTagsList: "task-tags:list",
  taskTagsCreate: "task-tags:create",
  taskTagsRename: "task-tags:rename",
  taskTagsDelete: "task-tags:delete",
  taskTagsAttach: "task-tags:attach",
  taskTagsDetach: "task-tags:detach",
  taskTagLinksList: "task-tag-links:list",
  taskAttachmentsList: "task-attachments:list",
  taskAttachmentsAdd: "task-attachments:add",
  taskAttachmentsRemove: "task-attachments:remove",
  taskAttachmentsOpen: "task-attachments:open",
  taskAttachmentsSaveAs: "task-attachments:save-as",
  taskAttachmentsCounts: "task-attachments:counts",
  taskTemplatesList: "task-templates:list",
  taskTemplatesSaveFromTask: "task-templates:save-from-task",
  taskTemplatesApply: "task-templates:apply",
  taskTemplatesDelete: "task-templates:delete",
  taskDependenciesList: "task-dependencies:list",
  taskDependenciesAdd: "task-dependencies:add",
  taskDependenciesRemove: "task-dependencies:remove",
  eventsList: "events:list",
  eventsCreate: "events:create",
  eventsUpdate: "events:update",
  eventsDelete: "events:delete",
  eventsRestore: "events:restore",
  tasksCompleteOccurrence: "tasks:complete-occurrence",
  eventsAddRecurrenceExdate: "events:add-recurrence-exdate",
  eventsSplitRecurrence: "events:split-recurrence",
  eventTemplatesList: "event-templates:list",
  eventTemplatesCapture: "event-templates:capture",
  eventTemplatesApply: "event-templates:apply",
  eventTemplatesDelete: "event-templates:delete",
  peopleList: "people:list",
  peopleCreate: "people:create",
  peopleUpdate: "people:update",
  peopleDelete: "people:delete",
  peopleRestore: "people:restore",
  documentsList: "documents:list",
  documentsCreate: "documents:create",
  documentsUpdate: "documents:update",
  documentsDelete: "documents:delete",
  documentsRestore: "documents:restore",
  documentsRenew: "documents:renew",
  documentsRenewals: "documents:renewals",
  subjectsList: "subjects:list",
  subjectsCreate: "subjects:create",
  subjectsUpdate: "subjects:update",
  subjectsDelete: "subjects:delete",
  subjectsRestore: "subjects:restore",
  subjectAttachmentsList: "subject-attachments:list",
  subjectAttachmentsAdd: "subject-attachments:add",
  subjectAttachmentsRemove: "subject-attachments:remove",
  subjectAttachmentsOpen: "subject-attachments:open",
  subjectAttachmentsSaveAs: "subject-attachments:save-as",
  subjectNotesLink: "subjects:notes-link",
  subjectNotesUnlink: "subjects:notes-unlink",
  subjectNotesLinked: "subjects:notes-linked",
  examsList: "exams:list",
  examsCreate: "exams:create",
  examsUpdate: "exams:update",
  examsDelete: "exams:delete",
  examsRestore: "exams:restore",
  decksList: "decks:list",
  decksCreate: "decks:create",
  decksUpdate: "decks:update",
  decksDelete: "decks:delete",
  decksRestore: "decks:restore",
  cardsListByDeck: "cards:list-by-deck",
  cardsCreate: "cards:create",
  cardsCreateCloze: "cards:create-cloze",
  cardsCreateProblem: "cards:create-problem",
  cardsUpdate: "cards:update",
  cardsDelete: "cards:delete",
  cardsRestore: "cards:restore",
  cardsCounts: "cards:counts",
  reviewQueue: "review:queue",
  reviewGrade: "review:grade",
  reviewUndo: "review:undo",
  reviewPreview: "review:preview",
  plansList: "plans:list",
  plansCreate: "plans:create",
  plansUpdate: "plans:update",
  plansDelete: "plans:delete",
  plansRestore: "plans:restore",
  plansSyncAll: "plans:sync-all",
  blocksListByPlan: "blocks:list-by-plan",
  blocksRange: "blocks:range",
  blocksSetStatus: "blocks:set-status",
  focusStart: "focus:start",
  focusStop: "focus:stop",
  focusStatus: "focus:status",
  focusCancel: "focus:cancel",
  focusListRange: "focus:list-range",
  focusDelete: "focus:delete",
  focusRestore: "focus:restore",
  statsStudy: "stats:study",
  studyLog: "study:log",
  studySettingsGet: "study:settings-get",
  studySettingsSet: "study:settings-set",
  notificationsCenterList: "notifications:center-list",
  notificationsSnooze: "notifications:snooze",
  notificationsDismiss: "notifications:dismiss",
  notificationsSettingsGet: "notifications:settings-get",
  notificationsSettingsUpdate: "notifications:settings-update",
  notificationsSourceToggle: "notifications:source-toggle",
  notificationsChanged: "notifications:changed",
  notificationsAppetiteAsk: "notifications:appetite-ask",
  notificationsAppetiteAnswer: "notifications:appetite-answer",
  notesList: "notes:list",
  notesCreate: "notes:create",
  notesLoad: "notes:load",
  notesAppendUpdate: "notes:append-update",
  notesDelete: "notes:delete",
  notesDuplicate: "notes:duplicate",
  notesRestore: "notes:restore",
  noteFoldersList: "note-folders:list",
  noteFoldersCreate: "note-folders:create",
  noteFoldersUpdate: "note-folders:update",
  noteFoldersMove: "note-folders:move",
  noteFoldersDelete: "note-folders:delete",
  noteFoldersSetTemplate: "note-folders:set-template",
  noteFoldersSetCapture: "note-folders:set-capture",
  noteFoldersSetView: "note-folders:set-view",
  noteTagsList: "note-tags:list",
  noteTagsCreate: "note-tags:create",
  noteTagsRename: "note-tags:rename",
  noteTagsDelete: "note-tags:delete",
  noteTagsAttach: "note-tags:attach",
  noteTagsDetach: "note-tags:detach",
  noteTagLinksList: "note-tag-links:list",
  notesSetFolder: "notes:set-folder",
  notesSetPinned: "notes:set-pinned",
  notesSetLinks: "notes:set-links",
  notesBacklinks: "notes:backlinks",
  notesVersions: "notes:versions",
  notesVersionLoad: "notes:version-load",
  notesVersionCapture: "notes:version-capture",
  notesTemplatesList: "notes:templates-list",
  notesTemplateSave: "notes:template-save",
  notesTemplateRename: "notes:template-rename",
  notesTemplateDelete: "notes:template-delete",
  notesCardsSync: "notes:cards-sync",
  notesCardsCount: "notes:cards-count",
  notesCardDeckSet: "notes:card-deck-set",
  notesChecklistCount: "notes:checklist-count",
  notesChecklistToTasks: "notes:checklist-to-tasks",
  noteAttachmentsList: "note-attachments:list",
  noteAttachmentsAdd: "note-attachments:add",
  noteAttachmentsRemove: "note-attachments:remove",
  noteAttachmentsOpen: "note-attachments:open",
  noteAttachmentsSaveAs: "note-attachments:save-as",
  dashboardGetSettings: "dashboard:get-settings",
  dashboardPickBackground: "dashboard:pick-background",
  dashboardClearBackground: "dashboard:clear-background",
  dashboardSetDim: "dashboard:set-dim",
  dashboardWidgetsList: "dashboard:widgets-list",
  dashboardWidgetsAdd: "dashboard:widgets-add",
  dashboardWidgetsRemove: "dashboard:widgets-remove",
  dashboardWidgetsSetSize: "dashboard:widgets-set-size",
  dashboardWidgetsMove: "dashboard:widgets-move",
  searchQuery: "search:query",
  searchRecent: "search:recent",
  searchPage: "search:page",
  searchRebuild: "search:rebuild",
  imexExport: "imex:export",
  // The calendar alone, as an RFC 5545 `.ics` (CAL-008). Its own channel rather
  // than a mode on `imex:export`: it writes a different file, in a different
  // format, with no passphrase branch at all — and a shared channel would be one
  // validated field away from letting a request for a calendar produce an
  // archive of the whole profile.
  imexExportIcs: "imex:export-ics",
  imexRestorePick: "imex:restore-pick",
  imexRestorePreview: "imex:restore-preview",
  imexRestoreApply: "imex:restore-apply",
  imexRestoreUndo: "imex:restore-undo",
  imexRestoreStatus: "imex:restore-status",
  imexRestoreCancel: "imex:restore-cancel",
  // A foreign import (ADR-043) gets its OWN channels rather than a mode flag on
  // the restore ones. The two surfaces do opposite things — one REPLACES a
  // profile preserving ids, one MERGES into it minting new ones — and a shared
  // channel would be one validated field away from letting a renderer that
  // asked for a merge trigger a replace. Undo and status are deliberately NOT
  // duplicated: both operations share ONE undo slot and ONE banner.
  imexImportPick: "imex:import-pick",
  imexImportPreview: "imex:import-preview",
  // ADR-051: re-plans the archive already open for THIS preview under different
  // duplicate choices. Its own channel rather than a field on the preview one,
  // because the two ask different things of main: a preview OPENS a file (and,
  // for an NXA1 container, runs Argon2id and needs the passphrase), while a
  // re-plan may do neither — it re-uses the parse inputs the open archive is
  // already holding, so changing a choice can never re-ask for a passphrase.
  imexImportReplan: "imex:import-replan",
  imexImportApply: "imex:import-apply",
  imexImportCancel: "imex:import-cancel",
  // An Anki `.apkg` (ADR-052 / STUDY-011). Its OWN four channels, on exactly
  // the reasoning that gave the foreign import its own: an `.apkg` is somebody
  // else's SQLite database inside a plain zip, read by a different reader under
  // different caps, and a shared channel would be one validated field away from
  // letting a request for one produce the other. The pick/preview/apply/cancel
  // SHAPE is deliberately identical, though — same one-slot undo, same named
  // skips, same token — because the user is doing the same thing.
  //
  // No replan channel: an `.apkg` has no duplicate groups to answer. What it
  // has instead is a SUBJECT choice, and that rides on the preview request —
  // re-previewing with a different subject re-plans the archive main already
  // has open, exactly as `imex:import-replan` re-plans on a changed choice.
  imexImportApkgPick: "imex:import-apkg-pick",
  imexImportApkgPreview: "imex:import-apkg-preview",
  imexImportApkgApply: "imex:import-apkg-apply",
  imexImportApkgCancel: "imex:import-apkg-cancel",
  // Plain `.md` files into notes (IMEX-007). Deliberately NOT a mode on the
  // archive channels above: there is no manifest to read, nothing to preview
  // and nothing to undo — main picks, parses and writes in one call, exactly
  // the shape `dashboard:background-pick` already has.
  imexImportMarkdown: "imex:import-markdown",
  // ADR-040's OS-level half (TASK-002). The chord lives in the renderer's
  // `localStorage` (a device preference, never profile data), so the renderer
  // is the only side that knows it — it tells main at boot and on every remap,
  // and main answers whether the system let it have the combination.
  shortcutsSetGlobal: "shortcuts:set-global",
  shortcutsGlobalCapture: "shortcuts:global-capture",
  appInfo: "app:info",
} as const;

export type IpcChannel = (typeof IpcChannel)[keyof typeof IpcChannel];

/**
 * The local account's session state (ADR-018): `"uninitialized"` (no account
 * yet), `"locked"` (an account exists but the database is not open), or
 * `"unlocked"`. Computed by combining what is on disk with main's own runtime
 * knowledge of whether the database is currently open — never from disk
 * alone, since "is the database open in this process" cannot be recovered
 * from a file.
 */
export type AuthState = "uninitialized" | "locked" | "unlocked";

/**
 * Why an auth call was refused. Mirrors `@nexus/core/auth`'s `AuthErrorReason`
 * exactly; redeclared here (the same pattern every other closed domain in
 * this file follows) so the renderer never imports the core auth subpath —
 * its Argon2id WASM has no business in a renderer bundle for every screen
 * that isn't the lock screen.
 */
export type AuthErrorReason =
  | "notInitialized"
  | "alreadyInitialized"
  | "wrongPasscode"
  | "wrongRecoveryCode"
  | "throttled"
  | "weakPasscode"
  | "keystoreUnavailable"
  | "otherDevice"
  | "corruptKeychain";

/**
 * Minimum passcode length (founder decision 2026-07-26, ADR-018). Mirrors
 * `@nexus/core/auth`'s `MIN_PASSCODE_LENGTH` — redeclared here, like every
 * other closed domain in this file, so the renderer can pre-check a passcode
 * without importing the core auth subpath and dragging Argon2id's WASM into
 * its bundle. `validatePasscode` in the main process stays authoritative.
 */
export const PASSCODE_MIN_LENGTH = 8;

/** Longest account label the create form and the picker's rename accept. Mirrors `main/accounts.ts`'s `MAX_ACCOUNT_LABEL_LENGTH`, redeclared here so the renderer can cap its own input; main stays authoritative. */
export const MAX_ACCOUNT_LABEL_LENGTH = 80;

/**
 * One local account as the lock screen sees it (ADR-044). The registry's three
 * plaintext fields plus the one live fact the picker needs to draw a state line
 * for an account it has not selected.
 *
 * `label` is PLAINTEXT on disk by design: it is what the picker lists before
 * anything is unlocked, so it cannot live inside an encrypted database. The
 * create form says so where the field is typed.
 */
export interface AccountSummary {
  id: string;
  label: string;
  createdAt: string;
  /**
   * Per-account, not per-device: each account's guard blob is bound to its own
   * device secret, so one carried over from another machine needs its Recovery
   * Kit while the others on this machine unlock normally.
   */
  requiresRecovery: boolean;
}

/** The local account's status (ADR-018) — the first thing the renderer asks about, before profiles or flags. */
export interface AuthStatus {
  state: AuthState;
  /** Milliseconds still to wait before another attempt is accepted; 0 when none. */
  lockedForMs: number;
  /** False when the OS keystore is unavailable — account creation is refused rather than silently downgraded. Device-global: `safeStorage` knows nothing about accounts. */
  keystoreAvailable: boolean;
  /**
   * True when this data was carried over from another machine or Windows
   * account: its OS-bound guard cannot be read here, so the passcode is
   * unusable and only the Recovery Kit can open it (ADR-018 — the Kit is
   * deliberately not device-bound precisely for this). The lock screen shows
   * the recovery form instead of the passcode form.
   */
  requiresRecovery: boolean;
  /**
   * Every local account on this device (ADR-044), oldest first. Empty on a
   * first-ever launch, which is exactly when `state` is `"uninitialized"`.
   */
  accounts: AccountSummary[];
  /**
   * The account `state`, `lockedForMs` and `requiresRecovery` above describe,
   * and the one every other auth channel acts on. Null only when there are no
   * accounts yet.
   */
  selectedAccountId: string | null;
}

/**
 * The outcome of every auth mutation (create/unlock/recover/change-passcode/
 * regenerate-recovery): a discriminated result rather than a thrown error for
 * every EXPECTED refusal. Electron's IPC serializes a thrown `Error`'s
 * `message` only, and the renderer needs `reason` to pick its Serbian copy —
 * a raw thrown error gives it nothing to branch on. An unexpected failure (a
 * corrupt database, a filesystem error) still throws; that is the renderer's
 * generic error path, not this one.
 */
export type AuthResult =
  | { ok: true; recoveryCode?: string }
  | { ok: false; reason: AuthErrorReason; lockedForMs?: number };

/** `label` names the account on the lock screen and is stored in plaintext (see `AccountSummary`); creation is refused outright once any account exists. */
export interface AuthCreateRequest {
  label: string;
  passcode: string;
}

/**
 * A second (third, …) account, created from the picker while others already
 * exist (ADR-044 section 4). Payload-identical to `AuthCreateRequest`, and
 * deliberately a channel of its own rather than a flag on it: this one LOCKS
 * the current session before it creates anything (there is never more than one
 * unlocked account), while `auth:create` can only ever run when nothing is
 * unlocked at all. Collapsing the two would put "may close the open database"
 * behind a boolean.
 */
export interface AuthCreateAdditionalRequest {
  label: string;
  passcode: string;
}

/** Switches which account every other auth channel acts on. Switching away from an unlocked one locks it first (ADR-044 section 5). */
export interface AuthSelectAccountRequest {
  accountId: string;
}

/** Renames an account's lock-screen label. Works while locked — the label is plaintext registry data, not something behind the key chain. */
export interface AuthRenameAccountRequest {
  accountId: string;
  label: string;
}

/**
 * Deletes an account and everything it owns (ADR-048), immediately and
 * irreversibly. There is deliberately NO passcode field: an account that
 * `requiresRecovery` — one whose data came from another device — can produce no
 * passcode proof here at all, so a PIN gate would make exactly the accounts
 * users most want gone the only ones they could not delete, and every attempt
 * would burn the unlock throttle. Intent is proved in the picker instead, by
 * typing the account's own label.
 */
export interface AuthDeleteAccountRequest {
  accountId: string;
}

export interface AuthUnlockRequest {
  passcode: string;
}

/** Recovering without setting a new passcode in the same call would lock the user out again next launch, so both arrive together. */
export interface AuthRecoverRequest {
  recoveryCode: string;
  newPasscode: string;
}

/** Re-verifies `currentPasscode` before rewrapping under `nextPasscode` — a defense against someone at an already-unlocked session changing the passcode without knowing it. */
export interface AuthChangePasscodeRequest {
  currentPasscode: string;
  nextPasscode: string;
}

/** A profile row as seen by the renderer (mirrors the `profiles` table, ADR-001). */
export interface Profile {
  id: string;
  kind: "personal" | "business";
  name: string;
  createdAt: string;
  /**
   * The blob store's plaintext sha256 for this profile's picture (SET-001,
   * migration 040), or null for none. What the renderer turns into an
   * `nx-blob://<hash>` URL — the same read protocol the dashboard background and
   * inline note images use. The bytes themselves never cross IPC in EITHER
   * direction: main opens, decodes and re-encodes the file, and the renderer
   * only ever names the hash back to a protocol handler.
   */
  pictureHash: string | null;
  /** The main-process-sniffed mime `nx-blob:` serves those bytes as; null exactly when `pictureHash` is. Always `image/png` for a picture this build produced. */
  pictureMime: string | null;
  /** The picture's byte length; null exactly when `pictureHash` is. Carried for the archive's blob inventory, not for display. */
  pictureSizeBytes: number | null;
}

/**
 * Per-profile module enable/disable overrides, keyed by module id. Structurally
 * identical to `@nexus/core`'s `FlagState`; redeclared here so the wire contract
 * stays self-contained and the renderer never imports Node/DB code.
 */
export type FlagState = Record<string, boolean>;

export interface FlagsGetRequest {
  profileId: string;
}

export interface FlagsSetRequest {
  profileId: string;
  moduleId: string;
  enabled: boolean;
}

/**
 * Renames an existing profile (ONB lite: naming the first-run profile). The
 * main process re-trims and re-validates the name (1–80 chars after trimming)
 * and rejects unknown profile ids — renderer-side checks are UX only.
 */
export interface ProfilesRenameRequest {
  id: string;
  name: string;
}

/**
 * Maximum size, in bytes, of an image `profiles:picture-pick` will accept.
 * 10 MiB: a phone photograph with room to spare, and half the dashboard
 * background's cap because nothing here keeps the original — the file is decoded
 * and re-encoded down to a 512px square, so what a larger allowance would buy is
 * a longer decode, not a better picture. Stat'ed BEFORE the read, so an
 * oversized file is refused without ever being loaded.
 */
export const MAX_PROFILE_PICTURE_BYTES = 10_485_760;

/**
 * Why a picture the user chose was refused. `too-large` is over
 * `MAX_PROFILE_PICTURE_BYTES`; `unsupported-format` is anything the main-process
 * sniff did not recognise as one of the four inline raster formats; `unreadable`
 * is a file that could not be stat'ed or read at all; `undecodable` is a file
 * that IS one of the four but that Electron's image decoder could not open —
 * a real and separate case (it documents itself as handling PNG and JPEG), and
 * one the user can act on differently.
 */
export type ProfilePicturePickErrorCode =
  | "too-large"
  | "unsupported-format"
  | "unreadable"
  | "undecodable";

/**
 * The outcome of the native "pick a profile picture" dialog: the user canceled,
 * the file was refused for a NAMED reason, or the profile row now points at the
 * square PNG main produced from it.
 *
 * `profile` rather than just the hash, for `DashboardPickResult`'s reason: a
 * pick can change more than one field, and a renderer patching its copy from a
 * partial reply would be maintaining a second, drifting model of the row.
 */
export type ProfilePicturePickResult =
  | { status: "canceled" }
  | { status: "rejected"; code: ProfilePicturePickErrorCode }
  | { status: "ok"; profile: Profile };

/** Both picture channels take just the profile — the renderer names no file, and sends no bytes (SEC-EL). */
export interface ProfilesPictureRequest {
  profileId: string;
}

/** Weekday index, 0 = Monday … 6 = Sunday — Monday-first, as everything Serbian in Nexus is. */
export type RecurrenceWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Which occurrence of a weekday inside a month; `-1` is the last one. */
export type RecurrenceOrdinal = 1 | 2 | 3 | 4 | -1;

/** How often a series fires; every `interval` is 1..99 and every period that cannot hold the pattern is skipped, never clamped (ADR-024). */
export type RecurrenceFreq =
  | { kind: "daily"; interval: number }
  | { kind: "weekdays" }
  | { kind: "weekly"; interval: number; days: RecurrenceWeekday[] }
  | { kind: "monthly-date"; interval: number; day: number }
  | { kind: "monthly-ordinal"; interval: number; ordinal: RecurrenceOrdinal; weekday: RecurrenceWeekday }
  | { kind: "yearly"; interval: number };

/** When a series stops: never, on an inclusive bare `YYYY-MM-DD` date, or after a total number of occurrences (the first one included). */
export type RecurrenceEnd =
  | { kind: "never" }
  | { kind: "until"; date: string }
  | { kind: "count"; total: number };

/**
 * The rule language shared by recurring tasks and recurring events (ADR-024).
 * Mirrors `@nexus/core`'s `RecurrenceRule` exactly. Redeclared rather than
 * imported — the same pattern `AuthErrorReason` and `RestoreProblemCode`
 * follow — because this file deliberately imports nothing. `main/index.ts`
 * assigns core's `RecurrenceRule` to this type and hands the result on to the
 * stores, which take core's, so drift in either direction is a compile error
 * rather than a wire that quietly carries a rule the engine cannot run.
 */
export interface RecurrenceRule {
  freq: RecurrenceFreq;
  end: RecurrenceEnd;
}

/** Closed task status domain (mirrors `@nexus/db`; redeclared so the renderer never imports DB code). */
export type TaskStatus = "todo" | "doing" | "done";

/** Closed task priority domain — the four levels of TASK-001. */
export type TaskPriority = "none" | "low" | "medium" | "high";

/**
 * A task as seen by the renderer (mirrors the `tasks` table via the store's
 * mapping, PRD 03). Field keys line up with a views-engine `CollectionSchema`.
 */
export interface Task {
  id: string;
  profileId: string;
  parentId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  done: boolean;
  dueDate: string | null;
  startDate: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** The rule this task advances by when an occurrence is completed (ADR-024), or null for a one-off. Never non-null without a bare-date `dueDate` — the date the rule phases from. */
  recurrence: RecurrenceRule | null;
  /**
   * Whole DAYS before `dueDate` at which to remind (ADR-028), ascending and
   * duplicate-free; empty for a task with no reminders. Days, not minutes like
   * an event's ladder: a task's deadline is a day, so this is the
   * document-expiry model. Never non-empty without a bare-date `dueDate` — the
   * same anchor a recurrence rule phases from.
   */
  reminderOffsets: number[];
  /** The list this task lives in (TASK-004 / ADR-029). Never null: every task has a list, the profile's Inbox by default. */
  listId: string;
  /** The section (a heading inside `listId`) this task sits under, or null for the list body. */
  sectionId: string | null;
  /** Sparse sort key within this task's (list, section) scope — the list view's display order. */
  position: number;
}

/** Fields for a new task; only `title` is required (TASK-001). The main process revalidates each. */
export interface NewTaskFields {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  startDate?: string | null;
  parentId?: string | null;
  recurrence?: RecurrenceRule | null;
  /** Reminder lead times in whole DAYS before the due date (ADR-028); omitted means none. The store canonicalizes and caps them. */
  reminderOffsets?: number[];
  /** Where the task lands (TASK-004); omitted means the profile's Inbox. Ignored when `parentId` is set — a subtask lives where its parent lives. */
  listId?: string;
  /** A section of `listId`; omitted or null puts the task in the list body. Ignored when `parentId` is set, for the same reason. */
  sectionId?: string | null;
}

/** A partial edit of a task's own fields; an omitted key is untouched, `null` clears it. */
export interface TaskFieldChanges {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  startDate?: string | null;
  recurrence?: RecurrenceRule | null;
  /** Reminder lead times in whole DAYS before the due date (ADR-028); an empty array clears every reminder. */
  reminderOffsets?: number[];
}

export interface TasksListRequest {
  profileId: string;
}

export interface TasksCreateRequest {
  profileId: string;
  task: NewTaskFields;
}

export interface TasksUpdateRequest {
  profileId: string;
  id: string;
  changes: TaskFieldChanges;
}

export interface TasksSetDoneRequest {
  profileId: string;
  id: string;
  done: boolean;
}

export interface TasksDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete (TASK-011): restores a previously deleted task. */
export interface TasksRestoreRequest {
  profileId: string;
  id: string;
}

/** "This occurrence is done" (ADR-024) — the one completion path for every task. `now` is stamped by main, never accepted from the renderer. */
export interface TasksCompleteOccurrenceRequest {
  profileId: string;
  id: string;
}

/** Which shape a list opens in (TASK-004/005, ADR-050). Mirrors `@nexus/db`'s `TASK_LIST_VIEWS`; redeclared so the renderer never imports DB code. */
export type TaskListView = "list" | "kanban" | "cards" | "calendar";

/**
 * Longest list/section name after trimming. Mirrors `@nexus/db`'s
 * `MAX_TASK_LIST_NAME_LENGTH` — redeclared here, like `PASSCODE_MIN_LENGTH`, so
 * the rail's inputs can bound what a user types without importing DB code. The
 * store and the main-process validator stay authoritative.
 */
export const MAX_TASK_LIST_NAME_LENGTH = 100;

/**
 * A task list as seen by the renderer (mirrors the `task_lists` table via the
 * store's mapping, ADR-029). `parentId` is null at the root; the Inbox is the
 * one list a task lands in when the user names none — renamable, but never
 * deletable or movable, which the store refuses outright.
 */
export interface TaskList {
  id: string;
  profileId: string;
  parentId: string | null;
  name: string;
  isInbox: boolean;
  defaultView: TaskListView;
  /**
   * What this list remembers about each of its four views (ADR-050), or null
   * when it has expressed no preference. The one type on this wire imported
   * rather than redeclared: `@nexus/core` is renderer-safe (the page already
   * imports the views engine from it), the shape is a nested grammar rather
   * than a string union, and a hand-copied third version of it is exactly the
   * drift the store, the archive reader and this contract cannot afford. The
   * import is type-only, so preload and main link nothing new.
   */
  viewConfig: TaskViewConfig | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/** A heading inside one list (ADR-029). Scoped through its list, so it carries no `profileId` of its own. */
export interface TaskSection {
  id: string;
  listId: string;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/** What deleting a list does with the tasks it holds — the two answers a user can give, and there is no third. */
export type DeleteListMode = "move-to-inbox" | "delete-tasks";

/**
 * Everything the left rail draws, in one fetch: every active list of the
 * profile plus every section of those lists. Two round trips would let the rail
 * render sections for a list that the same render no longer shows.
 */
export interface TaskListsSnapshot {
  /** Root lists first, then each parent's children, every scope in its own position order. */
  lists: TaskList[];
  /** Grouped by list in that same order, each list's sections in position order. */
  sections: TaskSection[];
}

export interface TaskListsListRequest {
  profileId: string;
}

/** `parentId` null makes it a root list. */
export interface TaskListsCreateRequest {
  profileId: string;
  name: string;
  parentId: string | null;
}

export interface TaskListsRenameRequest {
  profileId: string;
  id: string;
  name: string;
}

/** The view this list opens in (TASK-005) — the per-list replacement for the old localStorage view memory. */
export interface TaskListsSetViewRequest {
  profileId: string;
  id: string;
  view: TaskListView;
}

/**
 * What this list remembers about its views (ADR-050) — the WHOLE config, never
 * one knob: the page holds the config it is editing, and a per-knob channel
 * would ask main to merge two halves it cannot tell apart. `null` clears it.
 */
export interface TaskListsSetViewConfigRequest {
  profileId: string;
  id: string;
  config: TaskViewConfig | null;
}

/** Re-parents and re-orders in one call: `parentId` names the scope, `beforeId`/`afterId` the live siblings it lands between there (either null at an end). */
export interface TaskListsMoveRequest {
  profileId: string;
  id: string;
  parentId: string | null;
  beforeId: string | null;
  afterId: string | null;
}

/** `mode` is always explicit — what happens to the tasks is the user's answer, never a default. */
export interface TaskListsDeleteRequest {
  profileId: string;
  id: string;
  mode: DeleteListMode;
}

/** Undo of a list delete: brings back the list together with exactly the tasks that delete took down with it. */
export interface TaskListsRestoreRequest {
  profileId: string;
  id: string;
}

export interface TaskSectionsCreateRequest {
  profileId: string;
  listId: string;
  name: string;
}

export interface TaskSectionsRenameRequest {
  profileId: string;
  id: string;
  name: string;
}

/** Re-orders a section within its own list; `beforeId`/`afterId` are its siblings there. */
export interface TaskSectionsMoveRequest {
  profileId: string;
  id: string;
  beforeId: string | null;
  afterId: string | null;
}

/** Deleting a section promotes its tasks to the list body — a heading is not a container things are lost in. */
export interface TaskSectionsDeleteRequest {
  profileId: string;
  id: string;
}

/** Moves a task and its whole live subtree into another list, appended at that list's body end. */
export interface TasksMoveToListRequest {
  profileId: string;
  id: string;
  listId: string;
}

/** Moves one task between the sections of the list it is already in; `null` is the list body. */
export interface TasksMoveToSectionRequest {
  profileId: string;
  id: string;
  sectionId: string | null;
}

/** Re-orders a task between two live neighbours of its own (list, section) scope; either is null at an end of it. */
export interface TasksReorderRequest {
  profileId: string;
  id: string;
  beforeId: string | null;
  afterId: string | null;
}

/**
 * Moves a whole selection into `listId`, under `sectionId` (null = the list
 * body). One transaction in the store: if any id is refused, nothing moves.
 *
 * `ids` is validated element-wise in main and bounded there by `@nexus/db`'s
 * own `MAX_TASK_BULK_IDS` — unlike the name caps above, the renderer never
 * needs the number, so it is not restated here. The same holds for the four
 * batch requests below.
 */
export interface TasksBulkMoveRequest {
  profileId: string;
  ids: string[];
  listId: string;
  sectionId: string | null;
}

export interface TasksBulkPriorityRequest {
  profileId: string;
  ids: string[];
  priority: TaskPriority;
}

/** `null` clears the rok — refused, for the whole batch, where a recurrence rule or a reminder ladder anchors on it. */
export interface TasksBulkDueRequest {
  profileId: string;
  ids: string[];
  dueDate: string | null;
}

export interface TasksBulkDeleteRequest {
  profileId: string;
  ids: string[];
}

/** Undo of a batch delete: the exact id set the delete removed. */
export interface TasksBulkRestoreRequest {
  profileId: string;
  ids: string[];
}

/**
 * Longest task-tag name after trimming. Mirrors the cap `TaskTagStore` enforces
 * (itself copied from `note_tags` — a label is a label whichever entity carries
 * it), redeclared here like `MAX_TASK_LIST_NAME_LENGTH` so the rail's tag input
 * can bound what a user types without importing DB code, and so main can bound
 * the wire without waiting for the store to refuse. The store stays
 * authoritative: it trims and re-checks whatever it is handed.
 */
export const MAX_TASK_TAG_NAME_LENGTH = 50;

/**
 * A task tag as seen by the renderer (mirrors the `task_tags` table via
 * `TaskTagStore`'s mapping, migration 023) — a per-profile label, unique by
 * name. Redeclared here so the renderer never imports DB code; `NoteTag` above
 * is the same shape on a different entity, deliberately.
 */
export interface TaskTag {
  id: string;
  profileId: string;
  name: string;
  createdAt: string;
}

/** One task-tag attachment (mirrors the `task_tag_links` join table, migration 023). */
export interface TaskTagLink {
  taskId: string;
  tagId: string;
}

export interface TaskTagsListRequest {
  profileId: string;
}

/** Get-or-create by trimmed name: an existing tag of this profile comes back rather than being duplicated. */
export interface TaskTagsCreateRequest {
  profileId: string;
  name: string;
}

export interface TaskTagsRenameRequest {
  profileId: string;
  id: string;
  name: string;
}

/** Deleting a tag prunes its attachments through the schema's CASCADE — no task is touched. */
export interface TaskTagsDeleteRequest {
  profileId: string;
  id: string;
}

export interface TaskTagLinksListRequest {
  profileId: string;
}

export interface TaskTagsAttachRequest {
  profileId: string;
  taskId: string;
  tagId: string;
}

export interface TaskTagsDetachRequest {
  profileId: string;
  taskId: string;
  tagId: string;
}

/**
 * A task attachment's index row as seen by the renderer (mirrors the
 * `task_attachments` table via `TaskAttachmentStore`'s mapping, migration 024).
 * `NoteAttachment` below is the same shape on a different entity, deliberately.
 * The attachment's BYTES never cross this boundary at all — unlike a note's,
 * which the renderer hands over once at attach time: a task's files are picked
 * through a native dialog and read by main itself (see
 * `TaskAttachmentsAddRequest`), so every reference here is by `sha256` alone
 * (e.g. an `nx-blob://<sha256>` URL for a thumbnail). Redeclared here so the
 * renderer never imports DB code.
 */
export interface TaskAttachment {
  id: string;
  taskId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface TaskAttachmentsListRequest {
  profileId: string;
  id: string;
}

/**
 * Attaches one or more files to a task. The payload carries NO file data and no
 * path: main opens the native "pick files" dialog itself, reads what the user
 * chose, sniffs each file's real MIME type from its bytes (SEC-FILE-02) and
 * stamps `createdAt` from its own clock.
 *
 * Deliberately different from `note-attachments:add`, which takes the
 * renderer's `bytes` (the note editor also accepts a drag-drop, which has no
 * dialog to open). A form has no such source, so nothing here needs to hand
 * 50 MB across the bridge — and a flow where main owns both the dialog and the
 * read is strictly the smaller attack surface (SEC-EL: the renderer never names
 * a filesystem path).
 */
export interface TaskAttachmentsAddRequest {
  profileId: string;
  id: string;
}

/**
 * The outcome of that dialog: either the user canceled, or `added` files were
 * attached. `skippedTooLarge` counts files main refused for exceeding the store's
 * own byte cap — reported rather than thrown, because refusing one oversize file
 * must not lose the others the same pick succeeded with.
 */
export type TaskAttachmentsAddResult =
  | { canceled: true }
  | { canceled: false; added: number; skippedTooLarge: number };

export interface TaskAttachmentsRemoveRequest {
  profileId: string;
  id: string;
  attachmentId: string;
}

export interface TaskAttachmentsOpenRequest {
  profileId: string;
  id: string;
  attachmentId: string;
}

export interface TaskAttachmentsSaveAsRequest {
  profileId: string;
  id: string;
  attachmentId: string;
}

export interface TaskAttachmentsCountsRequest {
  profileId: string;
}

/**
 * Longest task-template name after trimming. Mirrors
 * `MAX_TASK_TEMPLATE_NAME_LENGTH` in `@nexus/db` — redeclared here, like
 * `MAX_TASK_TAG_NAME_LENGTH` above, so the save prompt can bound what a user
 * types without importing DB code, and so main can bound the wire without
 * waiting for the store to refuse. The store stays authoritative.
 */
export const MAX_TASK_TEMPLATE_NAME_LENGTH = 80;

/**
 * The task-shaped body a template carries (ADR-035), as the renderer sees it —
 * mirrors `@nexus/db`'s `TaskTemplatePayload` via the store's mapping.
 * Redeclared here so the renderer never imports DB code.
 *
 * The renderer never CONSTRUCTS one of these: a template is captured from an
 * existing task by main (`saveTaskTemplateFromTask`) and applied by main
 * (`applyTaskTemplate`), so this type is read-only from the UI's side — which
 * is why there is no "create a template by hand" channel and no validator for
 * one. What the renderer sends is a name and an id, nothing more.
 */
export interface TaskTemplatePayload {
  title: string;
  description: string | null;
  priority: TaskPriority;
  /** Whole days from the day the template is APPLIED to the created task's due date, or null for none. */
  dueOffsetDays: number | null;
  /** Whole days before that computed due date, ascending. */
  reminderOffsets: number[];
  recurrence: RecurrenceRule | null;
  /** Tag NAMES — get-or-created at apply time, so a template survives the deletion of the tag it was captured with. */
  tagNames: string[];
  /** Titles of the direct subtasks the template creates. */
  subtaskTitles: string[];
}

/** A task template as seen by the renderer (mirrors the `task_templates` table, migration 027 / ADR-035). */
export interface TaskTemplate {
  id: string;
  profileId: string;
  name: string;
  payload: TaskTemplatePayload;
  createdAt: string;
  updatedAt: string;
}

export interface TaskTemplatesListRequest {
  profileId: string;
}

/**
 * How many attachments one live task carries — the per-row count chip's whole
 * payload, one entry per task that has any (a task with none is absent, not
 * reported as zero). Mirrors `DeckCounts`' flat-row shape rather than a map,
 * for the same reason: a plain array survives structured clone without a
 * thought.
 */
export interface TaskAttachmentCount {
  taskId: string;
  count: number;
}

/**
 * Captures an existing task as a template under `name` (ADR-035). Main reads the
 * task, its direct live subtasks and its tag names itself — the renderer names
 * only WHICH task and WHAT to call it, so there is no task-shaped payload on the
 * wire to validate or to get wrong. Saving under a name that already exists
 * REPLACES that template, which is the edit mechanism.
 */
export interface TaskTemplatesSaveFromTaskRequest {
  profileId: string;
  taskId: string;
  name: string;
}

/**
 * Creates a task from a template, in `listId` (and `sectionId`, or the list
 * body). The destination is the caller's, never the template's: a template is
 * applied where the user is standing, and one that carried a stored destination
 * would file tasks into a list nobody is looking at. Returns the created PARENT
 * task; its subtasks and tags come back with the page's next refetch.
 */
export interface TaskTemplatesApplyRequest {
  profileId: string;
  templateId: string;
  listId: string;
  sectionId: string | null;
}

/** Deleting a template is final — nothing references one (migration 027). */
export interface TaskTemplatesDeleteRequest {
  profileId: string;
  id: string;
}

/**
 * One dependency edge as seen by the renderer (mirrors the `task_dependencies`
 * join table via `TaskDependencyStore`'s mapping, migration 029 / ADR-037):
 * `blockedId` waits on `blockerId`. Redeclared here so the renderer never
 * imports DB code, exactly as `TaskTagLink` above is.
 *
 * There is no "blocked" flag anywhere on the wire, deliberately: a task is
 * blocked while any of its blockers is live and not done, and the page already
 * holds both the tasks and these pairs — a second, stored answer could only
 * drift from the first.
 */
export interface TaskDependencyLink {
  blockerId: string;
  blockedId: string;
}

export interface TaskDependenciesListRequest {
  profileId: string;
}

/** Adding an edge that already exists is a no-op; a self-edge or one that would close a cycle is refused by the store. */
export interface TaskDependenciesAddRequest {
  profileId: string;
  blockerId: string;
  blockedId: string;
}

/** Removing an edge that is not there is a silent no-op — `detachTaskTag`'s rule. */
export interface TaskDependenciesRemoveRequest {
  profileId: string;
  blockerId: string;
  blockedId: string;
}

/**
 * A calendar event as seen by the renderer (mirrors the `events` table via the
 * store's mapping, PRD 04). Redeclared here so the renderer never imports DB code.
 */
export interface Event {
  id: string;
  profileId: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  location: string | null;
  category: string | null;
  createdAt: string;
  updatedAt: string;
  /** The rule that makes this row a series master the calendar expands virtually (ADR-024), or null for a one-off. Anchored on `startAt`'s own day. */
  recurrence: RecurrenceRule | null;
  /** Bare `YYYY-MM-DD` occurrence dates removed from the series, ascending; empty whenever `recurrence` is null. Settable only through `addEventRecurrenceExdate`, never through create/update — hence its absence from the two shapes below. */
  recurrenceExdates: string[];
  /** Whole minutes before the start at which to remind, ascending and duplicate-free (CAL-006); empty for an event with no reminders. Every occurrence of a series carries the master's ladder. */
  reminderOffsets: number[];
}

/** Fields for a new event; only `title` and `startAt` are required (CAL-001). The main process revalidates each. */
export interface NewEventFields {
  title: string;
  startAt: string;
  endAt?: string | null;
  allDay?: boolean;
  location?: string | null;
  description?: string | null;
  category?: string | null;
  recurrence?: RecurrenceRule | null;
  /** Reminder lead times in whole minutes (CAL-006); omitted means none. The store canonicalizes and caps them. */
  reminderOffsets?: number[];
}

/** A partial edit of an event's own fields; an omitted key is untouched, `null` clears it. */
export interface EventFieldChanges {
  title?: string;
  startAt?: string;
  endAt?: string | null;
  allDay?: boolean;
  location?: string | null;
  description?: string | null;
  category?: string | null;
  recurrence?: RecurrenceRule | null;
  /** Reminder lead times in whole minutes (CAL-006); an empty array clears every reminder. */
  reminderOffsets?: number[];
}

export interface EventsListRequest {
  profileId: string;
}

export interface EventsCreateRequest {
  profileId: string;
  event: NewEventFields;
}

export interface EventsUpdateRequest {
  profileId: string;
  id: string;
  changes: EventFieldChanges;
}

export interface EventsDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: restores a previously deleted event. */
export interface EventsRestoreRequest {
  profileId: string;
  id: string;
}

/** Excepts one bare `YYYY-MM-DD` occurrence from a series (ADR-024). Idempotent; `now` is stamped by main, never accepted from the renderer. */
export interface EventsAddRecurrenceExdateRequest {
  profileId: string;
  id: string;
  date: string;
}

/** Truncates a series so its last occurrence is the day before `occurrenceDate` (ADR-024). `now` is stamped by main, never accepted from the renderer. */
export interface EventsSplitRecurrenceRequest {
  profileId: string;
  id: string;
  occurrenceDate: string;
}

/**
 * Longest event-template name after trimming. Mirrors
 * `MAX_EVENT_TEMPLATE_NAME_LENGTH` in `@nexus/db` — redeclared here, exactly as
 * `MAX_TASK_TEMPLATE_NAME_LENGTH` above is, so the save prompt can bound what a
 * user types without importing DB code, and so main can bound the wire without
 * waiting for the store to refuse. The store stays authoritative.
 */
export const MAX_EVENT_TEMPLATE_NAME_LENGTH = 80;

/**
 * The event-shaped body a template carries (CAL-009), as the renderer sees it —
 * mirrors `@nexus/db`'s `EventTemplatePayload` via the store's mapping.
 * Redeclared here so the renderer never imports DB code.
 *
 * The renderer never CONSTRUCTS one of these, exactly as it never constructs a
 * `TaskTemplatePayload`: a template is captured from an existing event by main
 * and applied by main, so this type is read-only from the UI's side — which is
 * why there is no "create a template by hand" channel and no validator for one.
 * What the renderer sends is a name, an id and a day key, nothing more.
 *
 * Nothing here is a date. A template says "18:30, for ninety minutes, weekly";
 * the DAY comes from wherever it is applied.
 */
export interface EventTemplatePayload {
  title: string;
  allDay: boolean;
  /** Wall-clock `HH:MM` the created event starts at; null on an all-day template. */
  startTime: string | null;
  /** Whole minutes the created event lasts, or null for one with no end. Timed templates only. */
  durationMinutes: number | null;
  location: string | null;
  description: string | null;
  category: string | null;
  /** Whole minutes before the created event's start at which to remind (CAL-006), ascending. */
  reminderOffsets: number[];
  /** The rule the created event's series runs on (ADR-024), or null. Phased from the day the template is applied to. */
  recurrence: RecurrenceRule | null;
}

/** An event template as seen by the renderer (mirrors the `event_templates` table, migration 036 / CAL-009). */
export interface EventTemplate {
  id: string;
  profileId: string;
  name: string;
  payload: EventTemplatePayload;
  createdAt: string;
  updatedAt: string;
}

export interface EventTemplatesListRequest {
  profileId: string;
}

/**
 * Captures an existing event as a template under `name` (CAL-009). Main reads
 * the event and relativizes it itself — the renderer names only WHICH event and
 * WHAT to call it, so there is no event-shaped payload on the wire to validate
 * or to get wrong. Saving under a name that already exists REPLACES that
 * template, which is the edit mechanism.
 */
export interface EventTemplatesCaptureRequest {
  profileId: string;
  eventId: string;
  name: string;
}

/**
 * Creates an event from a template, on `dayKey` (a bare `YYYY-MM-DD`). The day
 * is the caller's, never the template's: a template is applied where the user is
 * standing, and one that carried its own date would rot the moment that date
 * passed.
 */
export interface EventTemplatesApplyRequest {
  profileId: string;
  templateId: string;
  dayKey: string;
}

/** Deleting a template is final — nothing references one (migration 036). */
export interface EventTemplatesDeleteRequest {
  profileId: string;
  id: string;
}

/** Closed person-kind domain (mirrors `PERSON_KINDS` in `@nexus/db`; redeclared so the renderer never imports DB code). */
export type PersonKind = "birthday" | "anniversary";

/**
 * A person as seen by the renderer (mirrors the `people` table via the store's
 * mapping, CAL-007 / ADR-026). `month`/`day` are the yearless recurring fact —
 * a birthday recurs forever and has no year attached; `year` is the separately
 * known birth/start year, null when the user never supplied one. Redeclared
 * here so the renderer never imports DB code.
 */
export interface Person {
  id: string;
  profileId: string;
  name: string;
  kind: PersonKind;
  month: number;
  day: number;
  year: number | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields for a new person; only `year` and `note` are optional (CAL-007). The main process revalidates each. */
export interface NewPersonFields {
  name: string;
  kind: PersonKind;
  month: number;
  day: number;
  year?: number | null;
  note?: string | null;
}

/** A partial edit of a person's own fields; an omitted key is untouched, `null` clears `year`/`note`. */
export interface PersonFieldChanges {
  name?: string;
  kind?: PersonKind;
  month?: number;
  day?: number;
  year?: number | null;
  note?: string | null;
}

export interface PeopleListRequest {
  profileId: string;
}

export interface PeopleCreateRequest {
  profileId: string;
  person: NewPersonFields;
}

export interface PeopleUpdateRequest {
  profileId: string;
  id: string;
  changes: PersonFieldChanges;
}

export interface PeopleDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: restores a previously deleted person. */
export interface PeopleRestoreRequest {
  profileId: string;
  id: string;
}

/** Closed document-type domain (mirrors `@nexus/db`; redeclared so the renderer never imports DB code). */
export type DocumentType =
  | "licna_karta"
  | "pasos"
  | "vozacka"
  | "registracija"
  | "kartica"
  | "polisa"
  | "custom";

/** Derived expiry state: on time, inside the reminder window, or already expired. */
export type DocumentStatus = "ok" | "uskoro" | "istekao";

/**
 * A tracked document as seen by the renderer (mirrors the `tracked_documents`
 * table via the store's mapping, CAL-004). `status` and `daysUntilExpiry` are
 * derived at read time. Redeclared here so the renderer never imports DB code.
 */
export interface TrackedDocument {
  id: string;
  profileId: string;
  docType: DocumentType;
  label: string;
  expiryDate: string;
  reminderOffsets: number[];
  notes: string | null;
  status: DocumentStatus;
  daysUntilExpiry: number;
  createdAt: string;
  updatedAt: string;
}

/** A single renewal record — the expiry that was replaced and when (CAL-004 history). */
export interface DocumentRenewal {
  id: string;
  documentId: string;
  previousExpiry: string;
  renewedAt: string;
}

/** Fields for a new document; `reminderOffsets` defaults from the type's ladder. The main process revalidates each. */
export interface NewDocumentFields {
  docType: DocumentType;
  label: string;
  expiryDate: string;
  reminderOffsets?: number[];
  notes?: string | null;
}

/** A partial edit of a document's own fields; an omitted key is untouched, `null` clears `notes`. */
export interface DocumentFieldChanges {
  docType?: DocumentType;
  label?: string;
  expiryDate?: string;
  reminderOffsets?: number[];
  notes?: string | null;
}

export interface DocumentsListRequest {
  profileId: string;
}

export interface DocumentsCreateRequest {
  profileId: string;
  document: NewDocumentFields;
}

export interface DocumentsUpdateRequest {
  profileId: string;
  id: string;
  changes: DocumentFieldChanges;
}

export interface DocumentsDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: restores a previously deleted document. */
export interface DocumentsRestoreRequest {
  profileId: string;
  id: string;
}

/** Moves a document's expiry forward, recording the previous expiry in history (CAL-004). */
export interface DocumentsRenewRequest {
  profileId: string;
  id: string;
  newExpiryDate: string;
}

export interface DocumentsRenewalsRequest {
  profileId: string;
  id: string;
}

/** Closed subject-colour domain (mirrors `@nexus/db`; redeclared so the renderer never imports DB code). */
export type SubjectColor = "jade" | "gold" | "bronze" | "burgundy" | "crimson" | "graphite";

/**
 * A subject as seen by the renderer (mirrors the `subjects` table via the store's
 * mapping, STUDY). `archived` subjects stay in the list. Redeclared here so the
 * renderer never imports DB code.
 */
export interface Subject {
  id: string;
  profileId: string;
  name: string;
  color: SubjectColor;
  semester: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Fields for a new subject; only `name` is required, colour defaults to 'jade'. The main process revalidates each. */
export interface NewSubjectFields {
  name: string;
  color?: SubjectColor;
  semester?: string | null;
}

/** A partial edit of a subject's own fields; an omitted key is untouched, `null` clears `semester`. */
export interface SubjectFieldChanges {
  name?: string;
  color?: SubjectColor;
  semester?: string | null;
  archived?: boolean;
}

export interface SubjectsListRequest {
  profileId: string;
}

export interface SubjectsCreateRequest {
  profileId: string;
  subject: NewSubjectFields;
}

export interface SubjectsUpdateRequest {
  profileId: string;
  id: string;
  changes: SubjectFieldChanges;
}

export interface SubjectsDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: restores a previously deleted subject. */
export interface SubjectsRestoreRequest {
  profileId: string;
  id: string;
}

/**
 * A subject material's index row as seen by the renderer (mirrors the
 * `subject_attachments` table via `SubjectAttachmentStore`'s mapping, migration
 * 035). `TaskAttachment` above is the same shape on a different entity,
 * deliberately, and the same rule holds here: the material's BYTES never cross
 * this boundary at all — main opens the native picker and reads the file itself,
 * so every reference is by `sha256` alone (e.g. an `nx-blob://<sha256>` URL for
 * a thumbnail). Redeclared here so the renderer never imports DB code.
 */
export interface SubjectAttachment {
  id: string;
  subjectId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface SubjectAttachmentsListRequest {
  profileId: string;
  id: string;
}

/**
 * Attaches one or more files to a subject. Carries NO file data and no path:
 * main opens the native "pick files" dialog itself, reads what the user chose,
 * sniffs each file's real MIME type from its bytes (SEC-FILE-02) and stamps
 * `createdAt` from its own clock — `task-attachments:add`'s arrangement,
 * verbatim, and for its reason (the renderer never names a filesystem path).
 */
export interface SubjectAttachmentsAddRequest {
  profileId: string;
  id: string;
}

/** The outcome of that dialog — `TaskAttachmentsAddResult`'s shape, with the same meaning for `skippedTooLarge`. */
export type SubjectAttachmentsAddResult =
  | { canceled: true }
  | { canceled: false; added: number; skippedTooLarge: number };

export interface SubjectAttachmentsRemoveRequest {
  profileId: string;
  id: string;
  attachmentId: string;
}

export interface SubjectAttachmentsOpenRequest {
  profileId: string;
  id: string;
  attachmentId: string;
}

export interface SubjectAttachmentsSaveAsRequest {
  profileId: string;
  id: string;
  attachmentId: string;
}

/**
 * A note filed under a subject, as the subject panel draws it (migration 035):
 * enough to render one row and open it through the existing note reveal, and
 * deliberately nothing more — the note's body never comes through here.
 */
export interface LinkedNote {
  id: string;
  title: string;
  updatedAt: string;
  /** When the link was made — the order the section lists them in. */
  linkedAt: string;
}

export interface SubjectNotesLinkedRequest {
  profileId: string;
  id: string;
}

/** Files a live note under a live subject. `now` is stamped by main, never sent. */
export interface SubjectNotesLinkRequest {
  profileId: string;
  id: string;
  noteId: string;
}

export interface SubjectNotesUnlinkRequest {
  profileId: string;
  id: string;
  noteId: string;
}

/** Closed exam-type domain (mirrors `@nexus/db`; redeclared so the renderer never imports DB code). */
export type ExamType = "pismeni" | "usmeni" | "kolokvijum";

/**
 * An exam as seen by the renderer (mirrors the `exams` table via the store's
 * mapping, STUDY). Its subject is carried by id. Redeclared here so the renderer
 * never imports DB code.
 */
export interface Exam {
  id: string;
  profileId: string;
  subjectId: string;
  examType: ExamType;
  examDate: string;
  scope: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields for a new exam; `subjectId`, `examType` and `examDate` are required. The main process revalidates each. */
export interface NewExamFields {
  subjectId: string;
  examType: ExamType;
  examDate: string;
  scope?: string | null;
}

/** A partial edit of an exam's own fields; an omitted key is untouched, `null` clears `scope`. */
export interface ExamFieldChanges {
  subjectId?: string;
  examType?: ExamType;
  examDate?: string;
  scope?: string | null;
}

export interface ExamsListRequest {
  profileId: string;
}

export interface ExamsCreateRequest {
  profileId: string;
  exam: NewExamFields;
}

export interface ExamsUpdateRequest {
  profileId: string;
  id: string;
  changes: ExamFieldChanges;
}

export interface ExamsDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: restores a previously deleted exam. */
export interface ExamsRestoreRequest {
  profileId: string;
  id: string;
}

/**
 * A deck as seen by the renderer (mirrors the `decks` table via the store's
 * mapping, STUDY flashcards). Its subject is carried by id. Redeclared here so
 * the renderer never imports DB code.
 */
export interface Deck {
  id: string;
  profileId: string;
  subjectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** Fields for a new deck; both `subjectId` and `name` are required. The main process revalidates each. */
export interface NewDeckFields {
  subjectId: string;
  name: string;
}

/** A partial edit of a deck's own fields; an omitted key is untouched. */
export interface DeckFieldChanges {
  subjectId?: string;
  name?: string;
}

export interface DecksListRequest {
  profileId: string;
}

export interface DecksCreateRequest {
  profileId: string;
  deck: NewDeckFields;
}

export interface DecksUpdateRequest {
  profileId: string;
  id: string;
  changes: DeckFieldChanges;
}

export interface DecksDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: restores a previously deleted deck. */
export interface DecksRestoreRequest {
  profileId: string;
  id: string;
}

/**
 * Closed FSRS card-state domain (mirrors `@nexus/db`'s `CardState`, itself
 * mirroring `ts-fsrs`'s `State` enum: New, Learning, Review, Relearning).
 * Redeclared here so the renderer never imports DB code.
 */
export type CardState = 0 | 1 | 2 | 3;

/** Maximum length of a card side — `CardStore`'s own cap, mirrored on the wire. A cloze template lives under the same cap. */
export const CARD_TEXT_MAX_LENGTH = 10_000;

/**
 * Closed card-kind domain (mirrors `@nexus/db`'s `CardKind`, itself mirroring
 * the `cards.kind` CHECK of migration 031). Redeclared here so the renderer
 * never imports DB code.
 */
export type CardKind = "basic" | "cloze";

/**
 * Card kinds in schema order — the closed wire domain a `NoteCardSpec`'s
 * `kind` is validated against. The card editor's form toggle does NOT read
 * this: „Zadatak" is a third FORM, not a third kind (ADR-046), so that toggle
 * has its own three-value union in the renderer.
 */
export const CARD_KINDS: readonly CardKind[] = ["basic", "cloze"];

/**
 * A flashcard as seen by the renderer (mirrors the `cards` table via the
 * store's mapping, STUDY flashcards / FSRS). `front`/`back` may contain `$…$`
 * KaTeX math, stored verbatim. Redeclared here so the renderer never imports
 * DB code.
 */
export interface Card {
  id: string;
  profileId: string;
  deckId: string;
  front: string;
  back: string;
  /**
   * The note and block this card was generated from, or both null for a
   * hand-made card (NOTE-006). A note-sourced card's text is owned by that
   * note's block — STUDY must not offer to edit it, since the next sync
   * would overwrite the edit.
   */
  sourceNoteId: string | null;
  sourceBlockKey: string | null;
  /**
   * What kind of card this is (STUDY-006 / ADR-042). A `cloze` card's
   * `front`/`back` are DERIVED by the store from `clozeText`/`clozeOrdinal`
   * and are never written directly — the reviewer renders the template so the
   * blank stays in its context, and the editor edits the template.
   */
  kind: CardKind;
  clozeText: string | null;
  clozeOrdinal: number | null;
  /**
   * A problem card's worked solution (ADR-046): the steps its `back` is
   * DERIVED from, separated by a line that is nothing but `--`. Null for a card
   * with no worked solution. A problem card is a `basic` card with this field
   * set — NOT a third kind — so the reviewer reveals its steps one at a time
   * while the editor edits the steps, never the back.
   */
  problemSteps: string | null;
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: CardState;
  lastReview: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields for a new BASIC card; `deckId`, `front` and `back` are all required. The main process revalidates each. */
export interface NewCardFields {
  deckId: string;
  front: string;
  back: string;
}

/**
 * A partial edit of a card's own content/placement fields; never touches FSRS
 * scheduling state. Which text field applies is decided by the card's KIND:
 * `front`/`back` for a basic card, `clozeText` for a cloze one — the store
 * refuses the wrong pairing rather than guessing (ADR-042).
 */
export interface CardFieldChanges {
  deckId?: string;
  front?: string;
  back?: string;
  clozeText?: string;
  /**
   * A basic card's worked solution (ADR-046). A string sets the steps and has
   * the store re-derive `back` from them — so `back` is never sent alongside;
   * `null` clears them, leaving a plain basic card. Refused on a cloze card.
   */
  problemSteps?: string | null;
}

export interface CardsListByDeckRequest {
  profileId: string;
  deckId: string;
}

export interface CardsCreateRequest {
  profileId: string;
  card: NewCardFields;
}

/**
 * Creates one cloze card per `{{…}}` deletion in `text` (STUDY-006 /
 * ADR-042), atomically. Only the template crosses the wire: every row's
 * `front`/`back` is derived in the main process by the same grammar the note
 * generator and the reviewer read, so the renderer can never make a cloze
 * card's stored sides disagree with its template.
 */
export interface CardsCreateClozeRequest {
  profileId: string;
  deckId: string;
  text: string;
}

/**
 * Creates one problem card (ADR-046): a BASIC card carrying the worked
 * solution its `back` is derived from. Only the statement and the steps cross
 * the wire — `back` is derived in the main process by the same grammar the
 * editor counts steps with and the reviewer reveals them by, so the renderer
 * can never make a problem card's stored answer disagree with its steps.
 */
export interface CardsCreateProblemRequest {
  profileId: string;
  deckId: string;
  front: string;
  stepsText: string;
}

export interface CardsUpdateRequest {
  profileId: string;
  id: string;
  changes: CardFieldChanges;
}

export interface CardsDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: restores a previously deleted card. */
export interface CardsRestoreRequest {
  profileId: string;
  id: string;
}

export interface CardsCountsRequest {
  profileId: string;
}

/** Per-deck review-queue badge counts (STUDY flashcards). */
export interface DeckCounts {
  deckId: string;
  newCount: number;
  dueCount: number;
}

/** Closed FSRS review-rating domain (Again/Hard/Good/Easy). Manual (0) is never accepted. */
export type CardRating = 1 | 2 | 3 | 4;

/**
 * Optional scope for the review queue, hand-mirroring `DueQueueOptions` in
 * `@nexus/db`: at most ONE of `deckId`/`subjectId`/`deckIds` — naming two is
 * refused by the store, not silently resolved — plus the problems-only filter
 * and a cap on New cards.
 *
 * This is the whole wire contract of a session's SELECTION. How a practice
 * session then ORDERS what it gets back (the interleave seed, and that it is a
 * practice session at all) is renderer-only state: the queue answers what is
 * studiable, never in what order the reviewer asks it.
 */
export interface ReviewQueueScope {
  deckId?: string;
  subjectId?: string;
  /** A SET of decks to draw from (ADR-047): the topic-shaped selection interleaved practice is built on. */
  deckIds?: readonly string[];
  /** Keep only problem cards — rows carrying a worked solution (ADR-046); a problem card's `kind` is `basic`, so no kind filter can say this. */
  problemsOnly?: boolean;
  newLimit?: number;
}

/** The review queue under one `ReviewQueueScope`. `now` is stamped by main, never accepted from the renderer. */
export interface ReviewQueueRequest extends ReviewQueueScope {
  profileId: string;
}

/**
 * What one queue fetch answers with (mirrors `ReviewQueue` in `@nexus/db`): the
 * cards, plus whether the profile's daily review cap cut the due section short
 * (STUDY-007).
 *
 * `capReached` is a fact about this QUEUE, not about the setting — a profile
 * with nothing due gets `false`. The end-of-session summary is the one surface
 * that reads it, because "you are finished" and "you have hit today's ceiling"
 * are different things to tell someone.
 */
export interface ReviewQueue {
  cards: Card[];
  capReached: boolean;
}

/**
 * Bounds on the study preferences, mirroring `@nexus/db`'s
 * `study/studySettingsStore.ts` and migration 034's three CHECKs: the same
 * numbers, declared on both sides so neither imports the other. Main
 * re-validates every one of them (SEC-EL-02), and the store re-validates after
 * main.
 */
export const MIN_TARGET_RETENTION = 0.7;
export const MAX_TARGET_RETENTION = 0.97;
export const MAX_NEW_PER_DAY = 100;
export const MAX_REVIEWS_PER_DAY = 1000;

/** The retention a profile that has never chosen one is scheduled at — ts-fsrs's own default, and migration 034's column default. */
export const DEFAULT_TARGET_RETENTION = 0.9;

/** New cards a day for a profile that has never chosen — migration 034's column default. */
export const DEFAULT_NEW_PER_DAY = 20;

/**
 * The retention presets „Ciljana zapamćenost" offers. A closed set rather than a
 * free field: the number is a probability the scheduler aims for, not a
 * quantity anyone has an intuition about at three decimal places, and five
 * sensible steps say everything a slider would.
 */
export const TARGET_RETENTION_PRESETS = [0.8, 0.85, 0.9, 0.93, 0.95] as const;

/** This profile's resolved study preferences (defaults already applied by the store). */
export interface StudySettings {
  /** ts-fsrs's `request_retention`, `MIN_TARGET_RETENTION`..`MAX_TARGET_RETENTION`. */
  targetRetention: number;
  /** How many New cards one day's queue may offer, 0..`MAX_NEW_PER_DAY`. */
  newPerDay: number;
  /** How many reviews one local day may hold, 1..`MAX_REVIEWS_PER_DAY`, or `null` for no cap at all. */
  maxReviewsPerDay: number | null;
}

/** Reads this profile's study preferences. Never writes. */
export interface StudySettingsRequest {
  profileId: string;
}

/** Writes all three preferences at once — they are one form, and a per-field channel would let a renderer leave one of them describing a decision nobody made. */
export interface StudySettingsSetRequest extends StudySettings {
  profileId: string;
}

/** Grades one review. `now` is stamped by main, never accepted from the renderer. */
export interface ReviewGradeRequest {
  profileId: string;
  id: string;
  rating: CardRating;
}

/** Undoes the most recent review of a card. `now` is stamped by main, never accepted from the renderer. */
export interface ReviewUndoRequest {
  profileId: string;
  id: string;
}

/** The four would-be next due dates for a card, one per rating, without persisting anything. */
export interface PreviewIntervals {
  again: string;
  hard: string;
  good: string;
  easy: string;
}

/** Previews the four would-be next due dates for a card. `now` is stamped by main, never accepted from the renderer. */
export interface ReviewPreviewRequest {
  profileId: string;
  id: string;
}

/** Closed study-block status domain (mirrors `@nexus/db`'s `StudyBlockStatus`; redeclared so the renderer never imports DB code). `missed` is only ever set by main's sync, never accepted from `setBlockStatus`. */
export type StudyBlockStatus = "planned" | "done" | "missed";

/**
 * A study plan as seen by the renderer (mirrors the `study_plans` table via the
 * store's mapping, STUDY exam planner). Its exam is carried by id. Redeclared
 * here so the renderer never imports DB code.
 */
export interface StudyPlan {
  id: string;
  profileId: string;
  examId: string;
  dailyMinutes: number;
  startDate: string;
  examWeekBoost: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Fields for a new plan; all four are required. The main process revalidates each and stamps `now`/`today` itself. */
export interface NewPlanFields {
  examId: string;
  dailyMinutes: number;
  startDate: string;
  examWeekBoost: boolean;
}

/** A partial edit of a plan's own fields; an omitted key is untouched. */
export interface PlanFieldChanges {
  dailyMinutes?: number;
  startDate?: string;
  examWeekBoost?: boolean;
}

/**
 * A single generated study session as seen by the renderer (mirrors the
 * `study_blocks` table via the store's mapping). Redeclared here so the
 * renderer never imports DB code.
 */
export interface StudyBlock {
  id: string;
  planId: string;
  profileId: string;
  blockDate: string;
  minutes: number;
  status: StudyBlockStatus;
  createdAt: string;
  updatedAt: string;
}

/** A block joined with its plan's exam id — the calendar-merge read path (`listBlocksInRange`). */
export interface StudyBlockWithExam extends StudyBlock {
  examId: string;
}

export interface PlansListRequest {
  profileId: string;
}

export interface PlansCreateRequest {
  profileId: string;
  plan: NewPlanFields;
}

export interface PlansUpdateRequest {
  profileId: string;
  id: string;
  changes: PlanFieldChanges;
}

export interface PlansDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: restores a previously deleted plan. */
export interface PlansRestoreRequest {
  profileId: string;
  id: string;
}

/** Syncs every active plan of this profile whose exam is still active. `now`/`today` are stamped by main, never accepted from the renderer. */
export interface PlansSyncAllRequest {
  profileId: string;
}

export interface BlocksListByPlanRequest {
  profileId: string;
  planId: string;
}

export interface BlocksRangeRequest {
  profileId: string;
  fromDate: string;
  toDate: string;
}

export interface BlocksSetStatusRequest {
  profileId: string;
  id: string;
  status: StudyBlockStatus;
}

/**
 * A completed focus (study-timer) session as seen by the renderer (mirrors the
 * `focus_sessions` table via the store's mapping, STUDY stats). Redeclared
 * here so the renderer never imports DB code.
 */
export interface FocusSession {
  id: string;
  profileId: string;
  subjectId: string;
  startedAt: string;
  endedAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The in-progress focus timer for one profile, as tracked by the main process
 * in memory only — it is never a `focus_sessions` row (see that table's doc
 * comment): a crash or app restart simply loses the running timer.
 */
export interface RunningFocusSession {
  subjectId: string;
  startedAt: string;
}

/** Starts a focus timer. `startedAt` is stamped by main, never accepted from the renderer. */
export interface FocusStartRequest {
  profileId: string;
  subjectId: string;
}

/** Stops the running focus timer, persisting it (unless it ended in the same instant it started). */
export interface FocusStopRequest {
  profileId: string;
}

export interface FocusStatusRequest {
  profileId: string;
}

/** Discards the running focus timer without saving anything. */
export interface FocusCancelRequest {
  profileId: string;
}

export interface FocusListRangeRequest {
  profileId: string;
  fromDate: string;
  toDate: string;
}

export interface FocusDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: restores a previously deleted focus session. */
export interface FocusRestoreRequest {
  profileId: string;
  id: string;
}

/**
 * The composed STUDY stats payload for one profile's date range: per-subject
 * focus minutes, the set of days with any study activity, review counts,
 * study-block totals, and the two named STUDY-013 metrics (cards matured, plan
 * adherence).
 *
 * Every field but `matured.total` is a fact about the requested range;
 * `matured.total` is a live census of the whole collection and rides along
 * because it is the number that gives `matured.inRange` its scale.
 */
export interface StudyStats {
  subjectMinutes: Array<{ subjectId: string; minutes: number }>;
  activityDays: string[];
  reviews: { total: number; perDay: Array<{ day: string; count: number }> };
  blocks: { done: number; missed: number };
  /** Cards that crossed the mature interval threshold in range, and how many are mature now. */
  matured: { inRange: number; total: number };
  /** Study blocks kept vs. let go in range; `ratio` is null when nothing was due. */
  adherence: { done: number; missed: number; ratio: number | null };
}

export interface StatsStudyRequest {
  profileId: string;
  fromDate: string;
  toDate: string;
}

/**
 * One local calendar day of a subject's study log (STUDY-014), as seen by the
 * renderer (mirrors `@nexus/db`'s `StudyLogDay`). Redeclared here so the
 * renderer never imports DB code. Exam names are not carried: the renderer
 * already holds this subject's exams and resolves each id against them.
 */
export interface StudyLogDay {
  day: string;
  reviews: number;
  focusMinutes: number;
  plannedMinutes: number;
  examIds: string[];
}

/** A subject's study log over one bounded range, newest day first, plus whether anything predates it. */
export interface SubjectStudyLog {
  days: StudyLogDay[];
  hasOlder: boolean;
}

/** One bounded page of a subject's study log; both bounds are bare "YYYY-MM-DD" calendar days. */
export interface StudyLogRequest {
  profileId: string;
  subjectId: string;
  fromDay: string;
  toDay: string;
}

/**
 * The source kinds a notification row can carry (mirrors `@nexus/core`'s
 * `NotificationSource`; redeclared here so the renderer never imports core/DB
 * code). The first five are reminders the user can switch on and off;
 * `"security"` (NTF-007) is recorded by main when a security-relevant event
 * actually happens and can never be switched off.
 */
export type NotificationSource =
  | "document"
  | "exam"
  | "study-day"
  | "event"
  | "task"
  | "security";

/** Closed ledger-status domain (mirrors `@nexus/db`'s `NotificationStatus`). Dismissal is terminal. */
export type NotificationStatus = "delivered" | "snoozed" | "dismissed";

/** The four snooze presets offered on a reminder; main resolves each to an absolute `until` from its own clock. */
export type SnoozePreset = "10m" | "1h" | "tonight" | "tomorrow-morning";

/**
 * A notification-ledger row as seen by the renderer (mirrors the
 * `notifications` table via `NotificationStore`'s mapping, NTF). Redeclared
 * here so the renderer never imports DB code.
 */
export interface NotificationRecord {
  id: string;
  profileId: string;
  source: NotificationSource;
  entityId: string;
  occurrenceKey: string;
  title: string;
  body: string;
  status: NotificationStatus;
  snoozedUntil: string | null;
  deliveredAt: string;
  createdAt: string;
  updatedAt: string;
}

/** This profile's resolved NTF preferences (mirrors `@nexus/db`'s `NotificationSettings`). */
export interface NotificationSettings {
  quietFrom: string | null;
  quietTo: string | null;
  morningHour: string;
  /** Only ever the toggleable sources — an always-on one (`"security"`) is not an appetite (NTF-007). */
  enabledSources: NotificationSource[];
  /** Which preset the center's plain „Odloži“ button means (NTF-009); the four stay offered explicitly beside it. */
  snoozeDefault: SnoozePreset;
  /** Whether the one-time "how much should Nexus remind you" question has already been put to this profile (NTF-008 / ADR-033). */
  appetiteAsked: boolean;
}

/** A partial patch of NTF settings; an omitted key is left untouched, `null` clears a quiet-hours bound. */
export interface NotificationSettingsChanges {
  quietFrom?: string | null;
  quietTo?: string | null;
  morningHour?: string;
  snoozeDefault?: SnoozePreset;
}

export interface NotificationsCenterListRequest {
  profileId: string;
}

/**
 * Snoozes a notification until an absolute time main resolves from `preset` and
 * its own clock — never accepted from the renderer. `preset` is OPTIONAL: an
 * omitted one means the profile's own `snoozeDefault` (NTF-009), which main
 * reads from the store it is already holding, so the plain „Odloži“ button
 * never has to know what the default currently is.
 */
export interface NotificationsSnoozeRequest {
  profileId: string;
  id: string;
  preset?: SnoozePreset;
}

export interface NotificationsDismissRequest {
  profileId: string;
  id: string;
}

export interface NotificationsSettingsGetRequest {
  profileId: string;
}

export interface NotificationsSettingsUpdateRequest {
  profileId: string;
  changes: NotificationSettingsChanges;
}

export interface NotificationsSourceToggleRequest {
  profileId: string;
  source: NotificationSource;
  enabled: boolean;
}

/**
 * The user's answer to the one-time NTF-008 appetite question (ADR-033).
 * `sources` is the exact set to enable — one of the Settings presets — or
 * `null` for "keep whatever is configured", which is what both "Zadrži
 * podrazumevano" and a dismissal send. Either way the question is marked as
 * asked: it is asked once, ever, and an answer of "don't change anything" is
 * still an answer. Main stamps the clock and then runs one immediate scheduler
 * check, so the reminders held back for the ask fire under the chosen appetite
 * instead of waiting out the next 60-second tick.
 */
export interface NotificationsAppetiteAnswerRequest {
  profileId: string;
  sources: NotificationSource[] | null;
}

/**
 * Maximum size, in bytes, of a single Yjs update accepted by
 * `notes:append-update`. The renderer uses it pre-flight — a merged batch that
 * would exceed it is sent as its individual updates instead — while the main
 * process and the store re-check it authoritatively (renderer input is
 * untrusted, SEC-EL-02). MUST equal `MAX_NOTE_UPDATE_BYTES` in `@nexus/db`:
 * the same wire limit, declared on both sides so neither imports the other
 * (the renderer never pulls DB/Node code into its bundle).
 */
export const NOTE_UPDATE_MAX_BYTES = 262_144;

/**
 * Maximum number of outbound wiki-links `notes:set-links` accepts in one call.
 * MUST equal `MAX_NOTE_LINKS` in `@nexus/db`: the same wire limit, declared on
 * both sides so neither imports the other (NOTE-004).
 */
export const NOTE_LINKS_MAX_COUNT = 500;

/** Maximum number of generated flashcards `notes:cards-sync` accepts for one note. */
export const NOTE_CARDS_MAX_COUNT = 500;

/** Maximum length of a generated card's reconcile key (the block's `cardKey` plus a cloze ordinal). */
export const NOTE_CARD_KEY_MAX_LENGTH = 200;

/**
 * What becomes of a note's generated flashcards when the note is deleted
 * (PRD 09 section 7). The user is asked whenever there is at least one:
 *
 * - `keep` — the cards are detached and live on as ordinary hand-made cards,
 *   FSRS history intact, in the deck they were already studied in. The note
 *   is also unmapped from that deck, so a restore cannot silently regenerate
 *   duplicates of the very cards the user chose to keep.
 * - `delete` — the cards are soft-deleted with the note, in the same act, and
 *   `notes:restore` brings both back together.
 *
 * Omitting it on the wire means `keep`: the disposition that destroys nothing
 * is the only safe default for a field an untrusted renderer may not send.
 */
export type NoteCardDisposition = "keep" | "delete";

/** The two dispositions, for validators on both sides of the boundary. */
export const NOTE_CARD_DISPOSITIONS: readonly NoteCardDisposition[] = ["keep", "delete"];

/**
 * A note's metadata as seen by the renderer (mirrors the `notes` table via
 * `NoteStore`'s mapping, NOTE slice a1 / ADR-012). The document itself is
 * never carried here — that is `notes:load`'s payload. Redeclared here so the
 * renderer never imports DB code.
 */
export interface NoteMeta {
  id: string;
  profileId: string;
  title: string;
  folderId: string | null;
  pinned: boolean;
  /** The deck this note's generated cards go to, null until the author picks one (NOTE-006). */
  cardDeckId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * What `notes:duplicate` answers with (NOTE-010). A result rather than a bare
 * `NoteMeta` because the operation has exactly one refusal worth naming: the
 * copy is written through the same `notes:append-update` path every other new
 * note uses, so a document whose merged state exceeds `NOTE_UPDATE_MAX_BYTES`
 * cannot be written in one call. Nothing is left behind when that happens — the
 * whole copy is one transaction — and the UI says which of the two it was
 * rather than guessing.
 */
export type NoteDuplicateResult =
  | { ok: true; note: NoteMeta }
  | { ok: false; reason: "too-large" };

/**
 * One note's persisted Yjs document state (ADR-012): the merged snapshot (or
 * null before the first compaction) plus every update past it, in order. The
 * renderer replays them onto a fresh `Y.Doc` and binds the editor.
 *
 * Binary crosses this boundary as `Uint8Array` over Electron's structured
 * clone — never base64, never JSON. The renderer only ever *sends* opaque
 * update blobs (`notes:append-update`) and *receives* this payload; the
 * per-note `seq` ordering and the compaction lifecycle are owned entirely by
 * the main process and the store (SEC-EL-02) — no renderer input reaches them.
 */
export interface NoteDocPayload {
  title: string;
  snapshot: Uint8Array | null;
  updates: Uint8Array[];
}

/**
 * One version-history checkpoint's metadata as seen by the renderer (mirrors
 * `note_versions` via `NoteStore`'s mapping, ADR-015 / NOTE-008). The
 * snapshot blob itself is `notes:version-load`'s payload, never this one —
 * `notes:versions` returns browse-list metadata only. Redeclared here so the
 * renderer never imports DB code.
 */
export interface NoteVersionMeta {
  coveredSeq: number;
  title: string;
  createdAt: string;
}

/**
 * Maximum size, in bytes, of one template's `content` that
 * `notes:template-save` accepts. MUST equal `MAX_NOTE_TEMPLATE_BYTES` in
 * `@nexus/db`: the same wire limit, declared on both sides so neither
 * imports the other. The renderer uses it pre-flight; the store re-checks
 * it authoritatively (renderer input is untrusted, SEC-EL-02).
 */
export const NOTE_TEMPLATE_MAX_BYTES = 262_144;

/**
 * A user-defined note template as seen by the renderer (mirrors the
 * `note_templates` table via `NoteTemplateStore`'s mapping, ADR-016 /
 * NOTE-009 slice 009-a). `content` is a ProseMirror document, JSON-encoded —
 * never a Yjs snapshot, since a template is never concurrently edited.
 * Redeclared here so the renderer never imports DB code.
 */
export interface NoteTemplate {
  id: string;
  profileId: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * An optional note-list filter (NOTE-002): omitted = every active note,
 * `{ folderId: null }` = unfiled notes, `{ folderId: "<id>" }` = one folder's
 * notes. Presence of the `folderId` key — not its value — distinguishes "all"
 * from "unfiled", so the wire payload either carries the key or omits it.
 */
export interface NotesListRequest {
  profileId: string;
  folderId?: string | null;
}

export interface NotesCreateRequest {
  profileId: string;
}

export interface NotesLoadRequest {
  profileId: string;
  id: string;
}

/**
 * Appends one batched Yjs update (1..256 KB, validated in main AND re-checked
 * in the store) plus the renderer-derived `title` (first non-empty line,
 * ≤ 200 chars after trimming — trust-consistent: the renderer authors the
 * content itself). `now` is stamped by main, never accepted from the renderer.
 */
export interface NotesAppendUpdateRequest {
  profileId: string;
  id: string;
  update: Uint8Array;
  title: string;
}

export interface NotesDeleteRequest {
  profileId: string;
  id: string;
}

/** Undo of a soft delete: restores a previously deleted note. */
export interface NotesRestoreRequest {
  profileId: string;
  id: string;
}

/** Closed note-folder colour domain (mirrors `@nexus/db`; redeclared so the renderer never imports DB code). */
export type NoteFolderColor =
  | "zlato"
  | "bronza"
  | "maslina"
  | "suma"
  | "zad"
  | "ruza"
  | "bordo"
  | "grafit";

/**
 * Which shape the note list draws while a folder is selected (NOTE-002).
 * Mirrors `@nexus/db`'s `NOTE_FOLDER_VIEWS`; redeclared so the renderer never
 * imports DB code. Narrower than `TaskListView` on purpose — a note has neither
 * a select field to make board columns from nor a date to sit on a grid.
 */
export type NoteFolderView = "list" | "cards";

/**
 * A note folder as seen by the renderer (mirrors the `note_folders` table via
 * `NoteOrgStore`'s mapping, NOTE-002). `parentId` is null at the tree's root.
 * Redeclared here so the renderer never imports DB code.
 */
export interface NoteFolder {
  id: string;
  profileId: string;
  parentId: string | null;
  name: string;
  color: NoteFolderColor | null;
  /**
   * The template a note created in this folder opens with (ADR-036), or null.
   * A built-in template's constant id (`BUILTIN_NOTE_TEMPLATE_IDS`,
   * `@nexus/core`) or a `NoteTemplate` row's id. An id the profile can no
   * longer resolve means "no template" — never an error.
   */
  defaultTemplateId: string | null;
  /** Whether a context-free "Nova beleška" (the palette's) files into this folder. At most one folder per profile. */
  isCaptureDefault: boolean;
  /** The shape the note list opens in while this folder is selected (NOTE-002). `"list"` for every folder that predates the toggle. */
  defaultView: NoteFolderView;
  createdAt: string;
  updatedAt: string;
}

/**
 * A note tag as seen by the renderer (mirrors the `note_tags` table via
 * `NoteOrgStore`'s mapping, NOTE-002) — a per-profile label, unique by name.
 * Redeclared here so the renderer never imports DB code.
 */
export interface NoteTag {
  id: string;
  profileId: string;
  name: string;
  createdAt: string;
}

/** One note-tag attachment (mirrors the `note_tag_links` join table, NOTE-002). */
export interface NoteTagLink {
  noteId: string;
  tagId: string;
}

export interface NoteFoldersListRequest {
  profileId: string;
}

export interface NoteFoldersCreateRequest {
  profileId: string;
  input: { parentId: string | null; name: string; color: NoteFolderColor | null };
}

/** A partial edit of a folder's own fields; an omitted key is untouched, `null` clears `color`. */
export interface NoteFolderFieldChanges {
  name?: string;
  color?: NoteFolderColor | null;
}

export interface NoteFoldersUpdateRequest {
  profileId: string;
  id: string;
  fields: NoteFolderFieldChanges;
}

export interface NoteFoldersMoveRequest {
  profileId: string;
  id: string;
  newParentId: string | null;
}

export interface NoteFoldersDeleteRequest {
  profileId: string;
  id: string;
}

/** ADR-036: points a folder at a default template, or clears it with `null`. The store validates the id against built-ins + this profile's templates. */
export interface NoteFoldersSetTemplateRequest {
  profileId: string;
  id: string;
  templateId: string | null;
}

/** ADR-036: moves this profile's quick-capture mark onto one folder, or clears it entirely with `null`. */
export interface NoteFoldersSetCaptureRequest {
  profileId: string;
  /** `null` clears the mark; the store keeps at most one marked folder per profile. */
  id: string | null;
}

/** NOTE-002: the shape the note list opens in while this folder is selected. */
export interface NoteFoldersSetViewRequest {
  profileId: string;
  id: string;
  view: NoteFolderView;
}

export interface NoteTagsListRequest {
  profileId: string;
}

export interface NoteTagsCreateRequest {
  profileId: string;
  name: string;
}

export interface NoteTagsRenameRequest {
  profileId: string;
  id: string;
  name: string;
}

export interface NoteTagsDeleteRequest {
  profileId: string;
  id: string;
}

export interface NoteTagLinksListRequest {
  profileId: string;
}

export interface NoteTagsAttachRequest {
  profileId: string;
  noteId: string;
  tagId: string;
}

export interface NoteTagsDetachRequest {
  profileId: string;
  noteId: string;
  tagId: string;
}

export interface NotesSetFolderRequest {
  profileId: string;
  noteId: string;
  folderId: string | null;
}

export interface NotesSetPinnedRequest {
  profileId: string;
  noteId: string;
  pinned: boolean;
}

/**
 * Replaces a note's full outbound wiki-link set (NOTE-004). `targetIds` is
 * renderer-declared like `title` on `notes:append-update` — the renderer
 * authors its own document content — and main/the store re-validate: dropping
 * a self-link, an unknown id, or one outside this profile, and capping the
 * count at `NOTE_LINKS_MAX_COUNT` (SEC-EL-02).
 */
export interface NotesSetLinksRequest {
  profileId: string;
  id: string;
  targetIds: string[];
}

export interface NotesBacklinksRequest {
  profileId: string;
  id: string;
}

export interface NotesVersionsRequest {
  profileId: string;
  id: string;
}

export interface NotesVersionLoadRequest {
  profileId: string;
  id: string;
  coveredSeq: number;
}

/** The pre-restore safety checkpoint (ADR-015): main merges only stored state, no renderer bytes involved. */
export interface NotesVersionCaptureRequest {
  profileId: string;
  id: string;
}

export interface NotesTemplatesListRequest {
  profileId: string;
}

/**
 * Saves the open note's content as a template (ADR-016 / NOTE-009). `content`
 * is a JSON-encoded ProseMirror document the renderer authored — the same
 * trust model as `title` on `notes:append-update` — capped at
 * `NOTE_TEMPLATE_MAX_BYTES` on the wire and re-parsed by the store, which
 * requires it to be an object with `type: "doc"`. Saving under an existing
 * template's `name` replaces its content rather than adding a second row:
 * naming IS the edit mechanism, since there is no template editor.
 */
export interface NotesTemplateSaveRequest {
  profileId: string;
  name: string;
  content: string;
}

export interface NotesTemplateRenameRequest {
  profileId: string;
  id: string;
  name: string;
}

export interface NotesTemplateDeleteRequest {
  profileId: string;
  id: string;
}

/**
 * One generated flashcard as the editor reports it: the block's reconcile key,
 * the rendered sides, and — for a card the block's `{{…}}` syntax authored —
 * the template and ordinal they were rendered from (ADR-042). Both cloze
 * fields are set exactly when `kind` is `cloze`; main and `CardStore` both
 * re-check that, and that the ordinal is really in the template.
 */
export interface NoteCardSpec {
  key: string;
  front: string;
  back: string;
  kind: CardKind;
  clozeText: string | null;
  clozeOrdinal: number | null;
}

/**
 * Syncs this note's generated flashcards (NOTE-006): like `title` on
 * `notes:append-update` and `targetIds` on `notes:set-links`, `cards` is
 * renderer-declared derived data about the note's own content — the editor's
 * current read of its `Pitanje :: Odgovor` / `{{cloze}}` blocks — and main
 * plus `CardStore` re-validate it: the note and deck must both be live and in
 * this profile, each key is capped and unique, and the whole call is rejected
 * rather than partially applied.
 */
export interface NotesCardsSyncRequest {
  profileId: string;
  id: string;
  deckId: string;
  cards: NoteCardSpec[];
}

/** Points (or unpoints, with `null`) this note's generated cards at a deck (NOTE-006). */
export interface NotesCardDeckSetRequest {
  profileId: string;
  id: string;
  deckId: string | null;
}

/** How many tasks „Pretvori u zadatke" would make out of this note — the probe the action is offered on. */
export interface NotesChecklistCountRequest {
  profileId: string;
  id: string;
}

/**
 * „Pretvori u zadatke" (NOTE §6): copies this note's checklist out into real
 * TASK rows in `listId`. Unlike `notes:cards-sync`, nothing about the content is
 * renderer-declared — main reads the note's own merged document, so the payload
 * is only the two ids, both re-checked against this profile (the note through
 * `NoteStore`, the list through `TaskListStore`).
 */
export interface NotesChecklistToTasksRequest {
  profileId: string;
  id: string;
  listId: string;
}

/**
 * What „Pretvori u zadatke" made. `created` counts every task written,
 * `completed` how many of those were written already done (a ticked box carried
 * across), and `skipped` the checklist rows that had no text to be a title.
 */
export interface NoteChecklistTasksResult {
  created: number;
  completed: number;
  skipped: number;
}

/**
 * Maximum size, in bytes, of one note attachment `note-attachments:add`
 * accepts. MUST equal `MAX_NOTE_ATTACHMENT_BYTES` in `@nexus/db`: the same
 * wire limit, declared on both sides so neither imports the other (ADR-014 /
 * NOTE-003).
 */
export const NOTE_ATTACHMENT_MAX_BYTES = 52_428_800;

/**
 * A note attachment's index row as seen by the renderer (mirrors the
 * `note_attachments` table via `NoteAttachmentStore`'s mapping, ADR-014 /
 * NOTE-003 slice 003-a). The attachment's bytes never cross this boundary
 * except once, at attach time (`attachNoteFile`'s `bytes` parameter) — every
 * other read/write refers to the blob only by this row's `sha256` (e.g. an
 * `nx-blob:<sha256>` URL for a future inline preview, slice 003-b).
 * Redeclared here so the renderer never imports DB code.
 */
export interface NoteAttachment {
  id: string;
  noteId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface NoteAttachmentsListRequest {
  profileId: string;
  id: string;
}

/**
 * Attaches a file to a note: the renderer sends the raw `bytes` (≤
 * `NOTE_ATTACHMENT_MAX_BYTES`) plus a display-only `fileName` — main sniffs
 * the real MIME type from the bytes themselves (SEC-FILE-02) and never trusts
 * the renderer's claim about what the file is.
 */
export interface NoteAttachmentsAddRequest {
  profileId: string;
  id: string;
  fileName: string;
  bytes: Uint8Array;
}

export interface NoteAttachmentsRemoveRequest {
  profileId: string;
  id: string;
  attachmentId: string;
}

export interface NoteAttachmentsOpenRequest {
  profileId: string;
  id: string;
  attachmentId: string;
}

export interface NoteAttachmentsSaveAsRequest {
  profileId: string;
  id: string;
  attachmentId: string;
}

/**
 * The outcome of a native "save attachment as" dialog (ADR-014 / NOTE-003):
 * either the user canceled, or the blob was copied to `path`. Deliberately a
 * shape of its own rather than a reuse of `ExportResult` — there is no
 * `totalRecords` concept for a single saved file, so forcing that field onto
 * this result would not fit.
 */
export type SaveAttachmentResult = { canceled: true } | { canceled: false; path: string };

/**
 * The dashboard's custom background and dim (SET-006 / ADR-041). Four channels,
 * and deliberately none of them carries a path or a byte: main owns the native
 * image picker, reads the file, sniffs its type and writes it into the
 * encrypted blob store, exactly as the task-attachment picker does. The
 * renderer only ever asks — "pick one", "drop it", "dim it this much" — and
 * renders whatever comes back.
 */

/**
 * Maximum size, in bytes, of an image `dashboard:pick-background` will accept.
 * 20 MiB: a wallpaper-sized photograph with room to spare, and small enough
 * that the file is read once into memory without thought. Stat'ed BEFORE the
 * read, so an oversized file is refused without ever being loaded.
 */
export const MAX_BACKGROUND_BYTES = 20_971_520;

/**
 * Maximum dim the slider (and `dashboard:set-dim`) accept. MUST equal
 * `MAX_BACKGROUND_DIM` in `@nexus/db` and migration 030's CHECK: the same
 * bound, declared on both sides so neither imports the other.
 */
export const MAX_BACKGROUND_DIM = 90;

/** The dim a profile that has never touched the slider gets. MUST equal `DEFAULT_BACKGROUND_DIM` in `@nexus/db` and migration 030's column default. */
export const DEFAULT_BACKGROUND_DIM = 40;

/**
 * The dashboard's resolved settings for one profile (defaults already applied
 * by the store). `backgroundHash` is what the renderer turns into an
 * `nx-blob://<hash>` URL — the same read protocol inline note images use; the
 * bytes themselves never cross IPC.
 */
export interface DashboardSettings {
  backgroundHash: string | null;
  backgroundMime: string | null;
  backgroundSizeBytes: number | null;
  backgroundDim: number;
}

/** Why an image the user picked was refused. `too-large` is over `MAX_BACKGROUND_BYTES`; `unsupported-format` is anything the main-process sniff did not recognise as one of the four inline raster formats; `unreadable` is a file that could not be stat'ed or read at all. */
export type DashboardPickErrorCode = "too-large" | "unsupported-format" | "unreadable";

/**
 * The outcome of the native "pick a background" dialog: the user canceled, the
 * file was refused for a NAMED reason (never silently re-encoded), or the
 * settings row now points at it.
 */
export type DashboardPickResult =
  | { status: "canceled" }
  | { status: "rejected"; code: DashboardPickErrorCode }
  | { status: "ok"; settings: DashboardSettings };

export interface DashboardSettingsRequest {
  profileId: string;
}

export interface DashboardSetDimRequest {
  profileId: string;
  /** A whole number, 0..`MAX_BACKGROUND_DIM`. Revalidated in main and again in the store. */
  dim: number;
}

/**
 * The dashboard's widget layout (DASH-002 / ADR-045, migration 032). Five
 * channels, all of them answering with the WHOLE resulting layout rather than
 * with the row they touched: a layout is an ordered list, every mutation can
 * re-space its neighbours, and a renderer that patched one entry locally would
 * be one renumber away from disagreeing with what is stored.
 */

/** How many columns the layout grid has. A size preset spans a whole number of these — see `DASHBOARD_WIDGET_SPANS`. */
export const DASHBOARD_GRID_COLUMNS = 6;

/**
 * The size presets a placed widget may take. MUST equal
 * `DASHBOARD_WIDGET_SIZES` in `@nexus/db`, `WidgetSize` in `@nexus/core` and
 * migration 032's CHECK: one domain, declared on each side so none imports
 * another.
 */
export type DashboardWidgetSize = "S" | "M" | "L";

/**
 * How many of `DASHBOARD_GRID_COLUMNS` each preset spans: a third, a half, the
 * full width. Presets rather than a free resize (PRD 02 DASH OQ#1) — three
 * widths that always tile cleanly beat a drag handle that produces layouts
 * nothing can lay out.
 */
export const DASHBOARD_WIDGET_SPANS: Record<DashboardWidgetSize, number> = {
  S: 2,
  M: 3,
  L: 6,
};

/**
 * One entry of the layout, in the order it is drawn — the array's own order IS
 * the position, so no sort key crosses IPC.
 *
 * `widgetId` is a `moduleId:widgetId` id a module's manifest publishes
 * (`ModuleRegistry.findWidget` resolves one). A layout deliberately KEEPS
 * entries whose widget this build does not publish, or whose module is switched
 * off — a placement must survive a flag being toggled and come back when it is
 * toggled again — so the renderer is what filters, and an unresolvable entry
 * simply draws nothing.
 */
export interface DashboardWidgetInstance {
  /** This PLACEMENT's identity; the same widget may be placed more than once. */
  instanceId: string;
  widgetId: string;
  size: DashboardWidgetSize;
  /** Per-widget JSON text, or null. Opaque: no widget publishes a config schema yet. */
  config: string | null;
}

export interface DashboardWidgetsListRequest {
  profileId: string;
}

/** Places a widget at the end of the layout. No `config`: nothing configures a widget yet. */
export interface DashboardWidgetsAddRequest {
  profileId: string;
  widgetId: string;
  size: DashboardWidgetSize;
}

export interface DashboardWidgetsRemoveRequest {
  profileId: string;
  instanceId: string;
}

export interface DashboardWidgetsSetSizeRequest {
  profileId: string;
  instanceId: string;
  size: DashboardWidgetSize;
}

/** Re-orders one placement: `beforeId`/`afterId` are the placements it lands between, either null at an end — the pair API `task-lists:move` established. */
export interface DashboardWidgetsMoveRequest {
  profileId: string;
  instanceId: string;
  beforeId: string | null;
  afterId: string | null;
}

/**
 * Global search (ADR-021 / PRD 08 SRCH-001/002). The index itself (migration
 * 017) and its read-only store already exist; these three channels are the
 * palette's entire main-process surface: a typed query, the recency-ordered
 * list an empty query shows, and a from-scratch repair.
 */

/** Hard cap on the raw query string the renderer may send. A palette input is a few words; anything longer is a paste, and the parser caps terms anyway. */
export const SEARCH_QUERY_MAX_BYTES = 500;
/** Hard cap on how many results one request may return. */
export const SEARCH_RESULT_MAX_LIMIT = 100;

/**
 * The kinds of entity global search indexes. MUST equal `SearchKind` in
 * `@nexus/core`: declared on both sides so neither imports the other, the same
 * rule the byte caps above follow. Unlike those, this one cannot drift
 * silently — main assigns a core `SearchKind` into `SearchResult.kind` below,
 * so a member added on one side and not the other fails to compile.
 */
export type SearchKind =
  | "task"
  | "event"
  | "note"
  | "document"
  | "subject"
  | "exam"
  | "deck"
  | "card"
  | "attachment";

/** A half-open `[start, end)` range into the string it accompanies, for highlighting the matched part. */
export type SearchHighlight = readonly [number, number];

/**
 * One displayable global-search result (ADR-021). `title`/`snippet` are the
 * ORIGINAL text with highlight ranges computed by core, never the folded
 * matching form — `titleRanges`/`snippetRanges` index into their OWN string
 * (`title`/`snippet` respectively), not into the source entity's full text.
 * `parentId` is what the deep link needs for a card's deck or an attachment's
 * note (null when the kind has none); `contextDate` is whatever date that
 * kind carries — due/start/expiry/exam date, null when the kind has none.
 */
export interface SearchResult {
  kind: SearchKind;
  entityId: string;
  parentId: string | null;
  title: string;
  titleRanges: SearchHighlight[];
  snippet: string;
  snippetRanges: SearchHighlight[];
  contextDate: string | null;
  updatedAt: string;
}

export interface SearchQueryRequest {
  profileId: string;
  query: string;
  /**
   * Required, never optional: an optional numeric field plus
   * `exactOptionalPropertyTypes` is a trap for no benefit, and the caller
   * always knows its own page size.
   */
  limit: number;
}

export interface SearchRecentRequest {
  profileId: string;
  limit: number;
}

/** `profileId` only proves the caller is in a real session — the rebuild itself is whole-file, not scoped to it (see the handler's own doc comment). */
export interface SearchRebuildRequest {
  profileId: string;
}

/**
 * The ADR-039 search page's single channel. Unlike `searchQuery`, this one
 * carries no `limit`: the page is the browse surface, so its size is a
 * property of the surface (`SEARCH_PAGE_MAX_RESULTS`) rather than something
 * the renderer negotiates. The renderer pages through what comes back in
 * chunks of its own choosing.
 */
export interface SearchPageRequest {
  profileId: string;
  query: string;
}

/** One kind's share of the pre-narrowing hit set (ADR-039 §3). */
export interface SearchKindCount {
  kind: SearchKind;
  count: number;
}

/** One tag chip: the original spelling to show, the `#token` to splice, and how many results it would keep. */
export interface SearchTagFacet {
  name: string;
  token: string;
  count: number;
}

/**
 * Hard cap on how many results one search-page response may carry. Equal to
 * `MAX_SEARCH_BROWSE_LIMIT` in `@nexus/db` by intent but declared
 * independently here, the same rule `SEARCH_QUERY_MAX_BYTES` follows — the
 * shared IPC contract imports nothing from the database package.
 */
export const SEARCH_PAGE_MAX_RESULTS = 500;

/**
 * The search page's whole payload (ADR-039 §3). `kindCounts` and `tagFacets`
 * are computed over the set BEFORE `kinds` narrowing, so a chip answers
 * "what would this narrowing give you" rather than "what does the narrowing
 * you already applied contain".
 */
export interface SearchPageResult {
  /** Ranked and capped at `SEARCH_PAGE_MAX_RESULTS`. */
  hits: SearchResult[];
  /** How many hits matched before the response cap — may exceed `hits.length`. */
  total: number;
  /** Candidate sourcing hit its bound, so `total` is a floor, not an exact count. */
  truncated: boolean;
  kindCounts: SearchKindCount[];
  tagFacets: SearchTagFacet[];
}

/**
 * `passphrase` is renderer-declared like every other explicit user choice on
 * this wire (SEC-EL-02: untrusted input, re-validated in main) — `null` is
 * the explicitly-confirmed plaintext export, a non-null string is re-checked
 * against `validateArchivePassphrase` before it ever reaches `deriveArchiveKey`.
 */
export interface ImexExportRequest {
  profileId: string;
  passphrase: string | null;
  /**
   * Which archive modules to write (IMEX-003), as `ArchiveModuleName`s.
   * ABSENT means all of them — the whole-profile export, and what a caller that
   * offers no choice keeps asking for.
   *
   * Untrusted like every other field here (SEC-EL-02): main checks each entry
   * against `@nexus/core`'s `ARCHIVE_MODULE_IDS` and refuses an empty array
   * outright, since an archive of nothing is not something the user can have
   * meant. A subset is a complete archive of fewer modules — restoring it
   * replaces the whole profile and the omitted modules simply come back empty,
   * exactly as a restore has always worked.
   */
  modules?: readonly ArchiveModuleName[];
}

/**
 * The outcome of a full-data export (IMEX slice a1, PRD 14 IMEX-001, extended
 * by ADR-022): either the user canceled the native save dialog, or the
 * archive was written to `path` with `totalRecords` interchange records
 * inside it. The renderer never supplies `path` itself — it always comes back
 * from the dialog main owns (SEC-EL: untrusted input never reaches the
 * filesystem).
 *
 * `missingAttachments` (ADR-022) is non-zero when one or more NOTE attachment
 * blobs were not found in the blob store: the archive is otherwise complete,
 * just missing that many attachment files — a lost blob never fails the whole
 * export.
 *
 * `encrypted` (ADR-022) is true when the archive was sealed under a
 * passphrase-derived key — an `.nexus` `NXA1` container — and false for the
 * explicitly-confirmed plaintext `.nexus.zip`. The renderer reports honestly
 * which kind of archive it wrote, since the two need different follow-up copy
 * (`settings.backup.savedEncryptedSuffix` vs. nothing extra).
 */
export type ExportResult =
  | { canceled: true }
  | {
      canceled: false;
      path: string;
      totalRecords: number;
      missingAttachments: number;
      encrypted: boolean;
    };

/**
 * An ICS calendar export (CAL-008 / IMEX-001's "ICS for calendar" clause). Only
 * the profile is named: this writes ONE open, unencrypted text file of the
 * user's own appointments — there is nothing to seal and no passphrase branch,
 * which is exactly why it is its own channel rather than a flag on
 * `ImexExportRequest`.
 */
export interface ImexExportIcsRequest {
  profileId: string;
}

/**
 * The outcome of an ICS export, shaped like `ExportResult`'s: either the user
 * canceled the native save dialog, or the file was written to the `path` that
 * dialog returned (never one the renderer supplied — SEC-EL).
 *
 * `events` is how many `VEVENT`s were written and `skipped` how many rows could
 * not be expressed as one — a start date that is not a real calendar day today.
 * Reported rather than swallowed, for the reason `missingAttachments` is: a
 * partial export the user is not told about is the one failure an export cannot
 * afford.
 */
export type IcsExportResult =
  | { canceled: true }
  | { canceled: false; path: string; events: number; skipped: number };

/**
 * Why an archive could not be opened (IMEX slice 3c, ADR-023). Lives here
 * rather than in `main/archiveReader.ts` — the module that actually produces
 * it — because this file is the one place every wire shape is declared once;
 * `archiveReader.ts` imports it type-only and re-exports it, so its existing
 * consumers see no difference. The renderer maps these to Serbian copy; this
 * module never produces user-facing prose.
 */
export type ArchiveReadErrorCode =
  | "not-an-archive" // neither an NXA1 container nor a readable zip
  | "passphrase-required" // an NXA1 container, and no passphrase was supplied
  | "passphrase-wrong" // an NXA1 container whose frames do not authenticate under the derived key
  | "damaged" // structurally broken: truncated, corrupt central directory, duplicate entries
  | "too-large"; // a limit below was exceeded

/**
 * Mirrors `@nexus/core`'s `ImportProblemCode` exactly. Redeclared rather than
 * imported — the same pattern `AuthErrorReason` follows — because this file
 * deliberately imports nothing. `main/restore.ts` assigns a core
 * `ImportProblemCode` to this type, so a code added in core and forgotten here
 * is a compile error rather than a silent gap.
 */
export type RestoreProblemCode =
  | "missing-manifest"
  | "invalid-manifest"
  | "unsupported-schema-version"
  | "missing-data-file"
  | "checksum-mismatch"
  | "invalid-json"
  | "unknown-record-type"
  | "invalid-record"
  | "duplicate-id"
  | "unknown-reference"
  | "reference-cycle"
  | "invalid-ydoc"
  | "missing-ydoc"
  | "missing-blob";

/** One thing wrong with an archive. `detail` is a machine-ish English fragment (a field name, an id) — never a sentence for a user; the renderer owns all Serbian copy. */
export interface RestoreProblem {
  severity: "error" | "warning";
  code: RestoreProblemCode;
  path?: string;
  line?: number;
  detail?: string;
}

/** Record counts per archive module — exactly `buildExportArchive`'s own manifest grouping (`countProfileModules`, `@nexus/core`). */
export interface RestoreModuleCounts {
  tasks: number;
  calendar: number;
  study: number;
  notifications: number;
  notes: number;
  /** Zero or one — the profile's dashboard background row (SET-006 / ADR-041). */
  dashboard: number;
}

/** The outcome of the native "pick a restore archive" dialog (IMEX slice 3c). Mirrors `SaveAttachmentResult`'s shape, plus what a restore preview needs before it can even ask for a passphrase: the file's display name and whether it is an `NXA1` container. */
export type RestorePickResult =
  | { canceled: true }
  | { canceled: false; path: string; fileName: string; encrypted: boolean };

/**
 * A dry run of a real restore, computed by actually parsing the picked
 * archive (ADR-023 section 1) — never an estimate. `current`/`incoming` are
 * the SAME module grouping (`countProfileModules`), so the confirmation
 * screen compares like with like.
 */
export interface RestorePreview {
  /** Identifies this exact parse. `applyRestore` refuses any other value, so a stale screen can never apply a preview the user did not see. */
  token: string;
  fileName: string;
  encrypted: boolean;
  /** From the archive's manifest. */
  createdAt: string;
  appVersion: string;
  sourceProfileName: string;
  /** The profile about to be overwritten, as it is right now. */
  targetProfileName: string;
  current: RestoreModuleCounts;
  incoming: RestoreModuleCounts;
  /** Warning-severity problems only (today: a `missing-blob` per attachment row whose file the archive lacks). Errors never reach a preview — they refuse it. */
  warnings: RestoreProblem[];
  /** Blobs present in the archive whose bytes did not hash to their own name: their attachment rows restore, their files do not. */
  corruptBlobs: number;
}

/**
 * `"no-file"` when nothing has been picked yet; `"unreadable"` when the
 * archive itself could not be opened (wrong/missing passphrase, damage,
 * limits); `"invalid"` when it opened but failed validation (a bad manifest,
 * a checksum mismatch, an unknown record) — every error-severity problem
 * found, never withheld; `"ready"` is the only state `applyRestore` accepts.
 */
export type RestorePreviewResult =
  | { status: "no-file" }
  | { status: "unreadable"; code: ArchiveReadErrorCode }
  | { status: "invalid"; problems: RestoreProblem[] }
  | { status: "ready"; preview: RestorePreview };

/** What a completed restore actually wrote (ADR-023 section 1: applying writes exactly what the preview showed — nothing is re-read or re-validated). */
export interface RestoreApplyResult {
  restored: RestoreModuleCounts;
  /** Every row `RestoreStore.replaceProfileData` wrote, across all tables — not just the five modules above. */
  rowsWritten: number;
  /** Attachment blobs whose bytes were new to the store. A blob already present is not counted, and is not undone. */
  blobsAdded: number;
  /**
   * Attachment rows restored whose blob the archive did not carry (or carried
   * corrupt): the rows exist, the files do not. Deliberately attachment-scoped
   * — a dashboard background the archive lacked (ADR-041) is reported as a
   * preview `missing-blob` warning, which is where the user actually decides
   * whether to go ahead, and folding it in here would make this number mean two
   * different things at once.
   */
  missingBlobs: number;
}

/** What undoing a restore actually wrote (ADR-023 section 3: undo removes only the blobs the restore itself added, and only once nothing else references them). */
export interface RestoreUndoResult {
  rowsWritten: number;
  /** Blobs the restore had added and that nothing references anymore. */
  blobsRemoved: number;
}

/**
 * What a freshly reloaded renderer asks for, since the reload replaced the
 * screen that would have shown the undo banner (IMEX-006). ONE slot covers
 * whichever archive operation ran last (ADR-043 section 4, extended by ADR-052
 * to the Anki import) — `kind` is what the banner names, since "poništi
 * vraćanje" and "poništi uvoz" undo very different things even though the
 * mechanism putting them back is identical. `"apkg"` is its own value rather
 * than a second `"import"` for exactly that reason: the sentence that names it
 * is about an Anki deck, not about a Nexus archive.
 */
export interface RestoreStatus {
  undo: {
    kind: "restore" | "import" | "apkg";
    appliedAt: string;
    summary: RestoreApplyResult;
  } | null;
}

/**
 * Picking an archive (`imex:restore-pick`) and dropping the picked one
 * (`imex:restore-cancel`) carry no payload at all — main holds the pick, so
 * there is nothing for the renderer to name — and so declare no request shape
 * here.
 */
export interface ImexRestorePreviewRequest {
  profileId: string;
  /**
   * `null` for a plain `.nexus.zip`, which needs none. Deliberately NOT held
   * to `validateArchivePassphrase`, unlike `ImexExportRequest`'s: an EXPORT
   * passphrase is a policy decision — we refuse to WRITE a weak archive — while
   * a RESTORE passphrase is merely an attempt at a file that already exists.
   * The file on disk is the authority on what opens it, so main only bounds
   * this value's length and never policy-checks it; a wrong one simply fails
   * AEAD authentication (`deriveArchiveKey` canonicalizes through
   * `normalizeArchivePassphrase`, so form differences never matter).
   */
  passphrase: string | null;
}

/** `token` names the exact preview being confirmed — main refuses any other value, so a stale screen can never apply a parse the user did not see. */
export interface ImexRestoreApplyRequest {
  profileId: string;
  token: string;
}

export interface ImexRestoreUndoRequest {
  profileId: string;
}

export interface ImexRestoreStatusRequest {
  profileId: string;
}

// --- Foreign import (ADR-043) -----------------------------------------------

/**
 * The archive modules an import's arithmetic is grouped by — `RestoreModuleCounts`'
 * own keys, so the set is declared exactly once in this file. `main` assigns
 * `@nexus/core`'s `Record<ArchiveModuleId, …>` to the report below, which makes
 * a module added in core and forgotten here a compile error.
 *
 * The same names an EXPORT names its module subset by (`ImexExportRequest.modules`,
 * IMEX-003): one archive-module vocabulary on this wire, not two.
 */
export type ArchiveModuleName = keyof RestoreModuleCounts;

/**
 * Mirrors `@nexus/core`'s `ArchiveRecordType` exactly — the `type` discriminant
 * an interchange row carries. Redeclared rather than imported, the same pattern
 * `RestoreProblemCode` follows and for the same reason: this file deliberately
 * imports nothing, and `main`'s assignment of a core value to this type is what
 * turns a record type added in core into a compile error here.
 */
export type ImportRecordType =
  | "task"
  | "task-list"
  | "task-section"
  | "task-tag"
  | "task-tag-link"
  | "task-attachment"
  | "task-template"
  | "task-dependency"
  | "event"
  | "event-template"
  | "document"
  | "renewal"
  | "person"
  | "subject"
  | "subject-attachment"
  | "subject-note-link"
  | "exam"
  | "deck"
  | "card"
  | "review"
  | "plan"
  | "block"
  | "focus-session"
  | "study-settings"
  | "notification"
  | "note-folder"
  | "note-tag"
  | "note"
  | "note-tag-link"
  | "note-attachment"
  | "note-version"
  | "note-template"
  | "dashboard-settings"
  | "dashboard-widget";

/**
 * Why rows the archive carried are not in the plan. Mirrors `@nexus/core`'s
 * `ImportSkipCode`: either salvage mode could not read them (the first seven,
 * which are `RestoreProblemCode`s) or the planner skips them BY DESIGN. The
 * renderer maps each to Serbian copy; nothing here is user-facing prose.
 */
export type ImportSkipCode =
  | "unknown-record-type"
  | "invalid-record"
  | "duplicate-id"
  | "unknown-reference"
  | "reference-cycle"
  | "missing-ydoc"
  | "invalid-ydoc"
  | "settings-not-imported"
  | "notifications-not-imported"
  | "dashboard-settings-not-imported"
  | "study-settings-not-imported"
  | "profile-picture-not-imported"
  | "template-name-taken"
  | "source-inbox-collapsed"
  | "duplicate-of-existing";

/** One named, counted group of skipped rows, grouped by `(code, module, type)` in first-seen order. `module`/`type` are null for a skip that belongs to neither (the manifest's settings). */
export interface ImportSkipReason {
  code: ImportSkipCode;
  module: ArchiveModuleName | null;
  type: ImportRecordType | null;
  count: number;
}

/**
 * The kinds of row an import can recognise as something this profile ALREADY
 * HAS (ADR-051 / IMEX-008). Mirrors `@nexus/core`'s `ImportDuplicateType`
 * exactly, redeclared here like every other shape in this file; `main`'s
 * assignment of a core value to this type is what turns a group added in core
 * into a compile error rather than a row the screen silently cannot label.
 *
 * `"attachment"` is one group across all three attachment tables: the identity
 * is the FILE („ista datoteka"), which is the same sentence wherever the row
 * hangs. The report still counts the skips per module.
 */
export type ImportDuplicateType = "event" | "person" | "document" | "attachment";

/** Every `ImportDuplicateType`, in the order the preview lists them — also the closed domain `main` validates a re-plan payload against. */
export const IMPORT_DUPLICATE_TYPES = ["event", "person", "document", "attachment"] as const;

/** What to do with one group. `"skip"` is the default for every group main has not been told about. */
export type ImportDuplicateChoice = "skip" | "import";

/** The renderer's answer per group — partial, because a group nobody has answered is skipped. */
export type ImportDuplicateChoices = Partial<Record<ImportDuplicateType, ImportDuplicateChoice>>;

/** One detected group and how many rows it covers. Reported whichever way the group's choice currently points, so the screen can always offer the other one. */
export interface ImportDuplicateGroup {
  type: ImportDuplicateType;
  count: number;
}

/** One module's arithmetic. `parsed` always equals `imported + merged + skipped` — a report that did not balance would be worse than no report at all. */
export interface ImportModuleCounts {
  /** Everything the archive carried for this module, including the rows salvage mode dropped. */
  parsed: number;
  /** Rows the import will insert as new rows. */
  imported: number;
  /** Rows that resolved onto something the target already has (a tag matched by name, a link that collapsed onto an existing pair). */
  merged: number;
  /** Rows that will not be inserted at all — every one of them named in `skips`. */
  skipped: number;
}

/** The whole honest account of what an import would do, straight off `planForeignImport`'s own report. */
export interface ImportPlanReport {
  modules: Record<ArchiveModuleName, ImportModuleCounts>;
  skips: ImportSkipReason[];
  /** Every duplicate group detected (ADR-051), groups with none omitted — one choice row each on the preview screen. */
  duplicates: ImportDuplicateGroup[];
}

/**
 * The outcome of the native "pick an archive to import" dialog. Structurally a
 * `RestorePickResult` and deliberately declared as one: the two flows pick the
 * same kind of file through the same dialog, and only what happens NEXT differs.
 */
export type ImportPickResult = RestorePickResult;

/**
 * A dry run of a real import (ADR-043 section 3), computed by actually parsing
 * the picked archive in `"import"` mode and really planning it against this
 * profile — never an estimate. Unlike a restore's preview it does not compare
 * "current" with "incoming": nothing is being replaced, so the only honest
 * numbers are what would be ADDED, and what would not.
 */
export interface ImportPreview {
  /** Identifies this exact parse-and-plan. `applyImport` refuses any other value, so a stale screen can never apply a plan the user did not see. */
  token: string;
  fileName: string;
  encrypted: boolean;
  /** From the archive's manifest. */
  createdAt: string;
  appVersion: string;
  /** The profile the archive was exported FROM — somebody else's, or the user's own other account. */
  sourceProfileName: string;
  /** The profile the rows would be merged INTO, as it is right now. */
  targetProfileName: string;
  report: ImportPlanReport;
  /** Warning-severity problems only. In import mode this is where every salvaged row is named, one warning each; errors refuse the archive outright. */
  warnings: RestoreProblem[];
  /** Blobs present in the archive whose bytes did not hash to their own name: their attachment rows import, their files do not. */
  corruptBlobs: number;
}

/**
 * `"no-file"` when nothing has been picked yet; `"unreadable"` when the archive
 * could not be opened (wrong/missing passphrase, damage, limits); `"invalid"`
 * when it opened but failed validation at the ARCHIVE level — a bad manifest, a
 * checksum mismatch, an unsupported version — which import mode refuses exactly
 * as a restore does, since a corrupt container is not something to guess at.
 * `"ready"` is the only state `applyImport` accepts.
 */
export type ImportPreviewResult =
  | { status: "no-file" }
  | { status: "unreadable"; code: ArchiveReadErrorCode }
  | { status: "invalid"; problems: RestoreProblem[] }
  | { status: "ready"; preview: ImportPreview };

/**
 * What a completed import actually wrote. Deliberately the SAME shape a restore
 * reports, because the two are undone through one slot and shown through one
 * banner (ADR-043 section 4): `restored` counts the rows this operation put into
 * the profile, which is what both operations mean by it. The plan's own
 * arithmetic — parsed/imported/merged/skipped per module — belongs to the
 * PREVIEW, where the user decides, not to the receipt.
 */
export type ImportApplyResult = RestoreApplyResult;

/**
 * Picking an archive (`imex:import-pick`) and dropping the picked one
 * (`imex:import-cancel`) carry no payload — main holds the pick — and so declare
 * no request shape. Undo and status have no import-specific request either: one
 * slot, one banner, `imex:restore-undo`/`imex:restore-status` for both.
 */
export interface ImexImportPreviewRequest {
  profileId: string;
  /** `null` for a plain `.nexus.zip`. Bounded but never policy-checked, for exactly the reason `ImexRestorePreviewRequest`'s is not: the file on disk is the authority on what opens it. */
  passphrase: string | null;
}

/**
 * Re-plans the archive THIS preview already has open, under different duplicate
 * choices (ADR-051). `token` names the plan being replaced — main refuses any
 * other value, exactly as an apply does, so a stale screen can never re-plan an
 * archive it is no longer looking at.
 *
 * The answer is a full `ImportPreviewResult`: re-planning mints a FRESH token
 * (the old plan is gone, and a screen still holding its token must not be able
 * to apply it), so the renderer needs the whole preview back rather than a diff.
 * No passphrase field, and deliberately so — the archive is already open, so a
 * re-plan never touches the KDF and the user is never asked twice.
 */
export interface ImexImportReplanRequest {
  profileId: string;
  token: string;
  choices: ImportDuplicateChoices;
}

/** `token` names the exact plan being confirmed — main refuses any other value, so a stale screen can never apply a plan the user did not see. */
export interface ImexImportApplyRequest {
  profileId: string;
  token: string;
}

// --- Markdown import (IMEX-007) ---------------------------------------------

/**
 * Which dialog `imex:import-markdown` opens. Two values rather than one
 * everything-picker because Electron's `showOpenDialog` cannot be both on
 * Windows and Linux: `["openFile", "openDirectory"]` silently degrades to a
 * DIRECTORY picker there, which would take the "choose files" button's meaning
 * away on the platform this app ships on first.
 */
export type MarkdownImportSource = "files" | "folder";

/** Maximum size of one `.md` file, checked by `stat` before it is ever read. */
export const MARKDOWN_IMPORT_MAX_BYTES = 1_048_576;

/** Maximum number of files one pick may turn into notes; the rest are reported, never silently dropped. */
export const MARKDOWN_IMPORT_MAX_FILES = 200;

// --- Anki .apkg import (ADR-052 / STUDY-011) ---------------------------------

/**
 * Every bound `main/apkgReader.ts` enforces on an `.apkg`, declared here beside
 * `MARKDOWN_IMPORT_*` because this file is where every limit the app is willing
 * to state lives.
 *
 * An `.apkg` is a plain zip carrying somebody else's SQLite DATABASE, which is
 * a wider attack surface than any other file this app opens: the reader has to
 * hand those bytes to SQLite itself. Every one of these is a NAMED REFUSAL —
 * the file is rejected with a reason the screen can say out loud — and never a
 * truncation, because half of somebody's deck arriving silently is the one
 * outcome an import must never produce.
 */

/** The `.apkg` file itself, on disk. Anki's own shared decks top out far below this; anything larger is not a deck, it is a payload. */
export const APKG_IMPORT_MAX_FILE_BYTES = 524_288_000; // 500 MiB

/**
 * The UNCOMPRESSED collection database. Lower than the file cap, and
 * deliberately so: this one becomes RESIDENT — the whole database is held in
 * main's heap while it is read (there is no temp file and nothing on disk) — so
 * it is the number that protects the process, exactly as `maxResidentBytes`
 * does for a Nexus archive. Also the ceiling a zstd-compressed collection is
 * decompressed under, so a compression bomb never allocates past it.
 */
export const APKG_IMPORT_MAX_COLLECTION_BYTES = 268_435_456; // 256 MiB

/** Entries in the zip's central directory, counting the ones the reader skips — the cost of the walk itself. */
export const APKG_IMPORT_MAX_ENTRIES = 10_000;

/** Rows read out of the collection's `notes` table. */
export const APKG_IMPORT_MAX_NOTES = 200_000;

/** Rows read out of the collection's `cards` table — higher than the note cap, since one note makes several. */
export const APKG_IMPORT_MAX_CARDS = 500_000;

/** Entries the `media` manifest may declare. Counted, never fetched: v1 imports no media. */
export const APKG_IMPORT_MAX_MEDIA_ENTRIES = 200_000;

/** One field of one note, in UTF-8 bytes. A card's text, not a file: past this the field is not text somebody typed. */
export const APKG_IMPORT_MAX_FIELD_BYTES = 262_144; // 256 KiB

/**
 * Why an `.apkg` could not be read at all. The counterpart of
 * `ArchiveReadErrorCode` for this file type, and separate from it because the
 * failures are genuinely different ones — there is no passphrase here, and
 * there are two ways to be unreadable that a Nexus archive has no equivalent
 * of.
 *
 * `unsupported-schema` is the honest name for a collection this build will not
 * GUESS about: Anki's schema 18 keeps a notetype's kind (basic vs cloze) in a
 * protobuf blob, and a cloze note imported as a basic one would arrive as a
 * card whose front is raw `{{c1::…}}` text. Exporting with „Support older Anki
 * versions" produces a schema this build reads completely.
 */
export type ApkgReadErrorCode =
  | "not-an-apkg"
  | "no-collection"
  | "unsupported-schema"
  | "zstd-unavailable"
  | "damaged"
  | "too-large";

/**
 * Why something the `.apkg` carried is not in the plan. Mirrors `@nexus/core`'s
 * `ApkgSkipCode` exactly — redeclared here like every other closed domain in
 * this file, so `main`'s assignment of a core value to this type turns a code
 * added in core into a compile error rather than a line the screen cannot
 * label.
 */
export type ApkgImportSkipCode =
  | "unknown-notetype"
  | "unknown-deck"
  | "empty-note"
  | "empty-deck"
  | "template-unsupported"
  | "cloze-nested"
  | "cloze-ordinal-reused"
  | "cloze-no-deletions"
  | "cloze-unrepresentable"
  | "cloze-hint-dropped"
  | "extra-fields-dropped"
  | "media-stripped"
  | "tags-dropped"
  | "history-dropped"
  | "card-without-note";

/** One named, counted group of things that will not arrive. */
export interface ApkgImportSkip {
  code: ApkgImportSkipCode;
  count: number;
}

/**
 * Where the imported decks land. Exactly one of the two is non-null, which main
 * validates before a single row is planned: an `.apkg` has no subject of its
 * own, so this is a decision only the user can make and the preview cannot be
 * computed without it.
 */
export interface ApkgImportSubjectChoice {
  /** An existing subject of this profile. */
  existingSubjectId: string | null;
  /** A subject this import creates. */
  newSubjectName: string | null;
}

/** Longest name „Nova oblast" accepts — the same ceiling the subject form itself is held to. */
export const APKG_IMPORT_MAX_SUBJECT_NAME_LENGTH = 120;

/**
 * The outcome of the native "pick an .apkg" dialog. Structurally a
 * `RestorePickResult` minus its `encrypted` flag, which an `.apkg` has no
 * concept of — a plain zip is the only shape this file comes in.
 */
export type ApkgImportPickResult =
  | { canceled: true }
  | { canceled: false; path: string; fileName: string };

/**
 * A dry run of a real `.apkg` import: the file really read, really translated
 * and really planned against this profile under the subject the request named.
 *
 * Two reports, and they answer different questions. `modules` is
 * `planForeignImport`'s own per-module arithmetic, the same table the archive
 * import shows — what the plan will insert. `skips` is the TRANSLATOR's: every
 * Anki-shaped thing that does not survive the crossing, named and counted, from
 * the media this build does not carry to the review history it deliberately
 * drops.
 */
export interface ApkgImportPreview {
  /** Identifies this exact read-and-plan. The apply refuses any other value, so a stale screen can never write a plan the user did not see. */
  token: string;
  fileName: string;
  /** The subject the decks will hang off, by name — the existing one the user picked, or the one this import will create. */
  subjectName: string;
  /** True when that subject does not exist yet, so the screen can say the import will create it. */
  subjectIsNew: boolean;
  /** What the collection carried, before any of this build's rules ran. */
  sourceDecks: number;
  sourceNotes: number;
  sourceCards: number;
  /** What the plan will actually create. `plannedNotes` counts Anki NOTES that produced at least one card, so it is comparable with `sourceNotes` — Nexus itself has no note row here. */
  plannedDecks: number;
  plannedNotes: number;
  plannedCards: number;
  /** `planForeignImport`'s own arithmetic, per archive module — only STUDY is ever non-zero for an `.apkg`. */
  modules: Record<ArchiveModuleName, ImportModuleCounts>;
  skips: ApkgImportSkip[];
}

/**
 * `"no-file"` when nothing has been picked yet; `"unreadable"` when the file
 * could not be read at all (not a zip, no collection inside, a schema this
 * build refuses to guess about, a cap); `"ready"` is the only state the apply
 * accepts.
 *
 * There is no `"invalid"` arm, unlike an archive's: an `.apkg` carries no
 * manifest to be wrong and no checksum to mismatch, so every way it can fail is
 * a way it could not be READ.
 */
export type ApkgImportPreviewResult =
  | { status: "no-file" }
  | { status: "unreadable"; code: ApkgReadErrorCode }
  | { status: "ready"; preview: ApkgImportPreview };

/** What a completed `.apkg` import wrote. The same shape both archive operations report, because it is undone through the same one slot and shown through the same one banner. */
export type ApkgImportApplyResult = RestoreApplyResult;

/**
 * Picking a file (`imex:import-apkg-pick`) and dropping the picked one
 * (`imex:import-apkg-cancel`) carry no payload — main holds the pick — and so
 * declare no request shape. Undo and status have none either: one slot, one
 * banner, `imex:restore-undo`/`imex:restore-status` for all three operations.
 *
 * The SUBJECT rides on the preview request rather than on the apply, because
 * the plan depends on it: which subject the decks hang off decides whether a
 * subject row is created at all. Re-previewing under a different subject
 * re-plans the file main already has open — the same precedent
 * `imex:import-replan` sets, and for the same reason: changing an answer must
 * not cost what opening the file cost.
 */
export interface ImexImportApkgPreviewRequest {
  profileId: string;
  subject: ApkgImportSubjectChoice;
}

/** `token` names the exact plan being confirmed — main refuses any other value. */
export interface ImexImportApkgApplyRequest {
  profileId: string;
  token: string;
}

/**
 * Why one file of a pick did not become a note. Every one of these is REPORTED
 * by name beside the file it happened to — a batch never aborts on a single
 * bad file, and never quietly loses one either.
 *
 * `too-long` is not `too-large`: the file passed the size gate, but the note
 * it parses to exceeds `NOTE_UPDATE_MAX_BYTES`, the per-update wire limit
 * every note write in the app is held to.
 */
export type MarkdownImportSkipCode =
  | "too-large"
  | "too-long"
  | "unreadable"
  | "empty"
  | "too-many"
  | "not-markdown";

export interface MarkdownImportSkip {
  /** The file's own name, as it was on disk — the only way the user can tell which one this was. */
  name: string;
  reason: MarkdownImportSkipCode;
}

/**
 * The outcome of one markdown import: canceled at the dialog, or a count of
 * the notes written plus every file that did not become one.
 *
 * `imagesAsText` is the honesty clause: this slice imports no blobs, so every
 * image in every file arrived as plain text carrying its alt and URL, and the
 * screen says how many rather than letting the user find out later.
 */
export type MarkdownImportResult =
  | { canceled: true }
  | {
      canceled: false;
      created: number;
      skipped: MarkdownImportSkip[];
      imagesAsText: number;
    };

/** `folderId` is an existing note folder of this profile, or null for the unfiled root; main validates it before a single file is read. */
export interface ImexImportMarkdownRequest {
  profileId: string;
  folderId: string | null;
  source: MarkdownImportSource;
}

/**
 * A key combination on the wire (ADR-040 / TASK-002). Mirrors `@nexus/core`'s
 * `Chord` exactly — redeclared here, like every other shared shape in this
 * file, so the renderer never imports core through the IPC contract. `key` is
 * a single character (already lowercased) or a function key by name.
 *
 * Main deliberately takes the CHORD, not a finished accelerator string: it
 * re-derives the accelerator itself with core's `chordAccelerator`, so no
 * string the renderer composed is ever handed to `globalShortcut.register`.
 */
export interface GlobalShortcutChord {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

/** Whether the OS granted the requested global combination. `false` leaves the previous registration (if any) in place. */
export interface GlobalShortcutResult {
  ok: boolean;
}

/** Runtime and environment facts, proving the main-process path end to end. */
export interface AppInfo {
  name: string;
  version: string;
  userDataPath: string;
  databasePath: string;
  versions: {
    electron: string;
    chrome: string;
    node: string;
    v8: string;
  };
}

/**
 * The exact object exposed on `window.nexus`: one method per channel, nothing
 * generic. Frozen at exposure time (see preload).
 */
export interface NexusApi {
  /** ADR-018: the local account's status. The first thing the renderer asks about, before profiles or flags — there is no code path where a data channel is called before this. */
  getAuthStatus(): Promise<AuthStatus>;
  /** First run: creates the local account (encrypting an existing plaintext database in place if one predates this) and returns the one-time Recovery Kit code on success — the only time it is ever handed back. */
  createAccount(label: string, passcode: string): Promise<AuthResult>;
  /** Adds another local account and switches to it, locking whatever was open first (ADR-044). Returns the new account's one-time Recovery Kit code, exactly as `createAccount` does. */
  createAdditionalAccount(label: string, passcode: string): Promise<AuthResult>;
  /** Points every other auth channel at a different account, locking the current one first when it was open. Answers with the freshly computed status so the picker never has to ask twice. */
  selectAccount(accountId: string): Promise<AuthStatus>;
  /** Renames an account's lock-screen label; allowed while locked. Answers with the freshly computed status. */
  renameAccount(accountId: string, label: string): Promise<AuthStatus>;
  /** Deletes an account and every byte it owns, immediately and with no undo (ADR-048). Answers with the freshly computed status — an empty `accounts` means that was the last one. */
  deleteAccount(accountId: string): Promise<AuthStatus>;
  /** Opens the database with the passcode-derived key, or a throttled/wrong-passcode refusal. */
  unlockWithPasscode(passcode: string): Promise<AuthResult>;
  /** Recovers from a forgotten passcode: verifies the Recovery Kit code and sets a new passcode in the same call. */
  unlockWithRecovery(recoveryCode: string, newPasscode: string): Promise<AuthResult>;
  /** Rewraps the data key under a new passcode; never re-encrypts the database, never touches the Recovery Kit already written down. */
  changePasscode(currentPasscode: string, nextPasscode: string): Promise<AuthResult>;
  /** Issues a fresh Recovery Kit code, invalidating the old one. Unlocked session only. */
  regenerateRecoveryCode(): Promise<AuthResult>;
  /** Closes the database and drops the data key from memory. */
  lock(): Promise<void>;
  listProfiles(): Promise<Profile[]>;
  renameProfile(id: string, name: string): Promise<void>;
  /**
   * Opens the native picker and, if the user chooses a file, stores the square
   * PNG main makes of it (SET-001). No path and no bytes cross this call in
   * either direction — see `main/profilePicture.ts` for why that is the whole
   * point, and why there is deliberately no interactive crop.
   */
  pickProfilePicture(profileId: string): Promise<ProfilePicturePickResult>;
  /** Drops the profile's picture and releases its blob when nothing else references it. */
  clearProfilePicture(profileId: string): Promise<Profile>;
  getFlags(profileId: string): Promise<FlagState>;
  setFlag(profileId: string, moduleId: string, enabled: boolean): Promise<void>;
  listTasks(profileId: string): Promise<Task[]>;
  createTask(profileId: string, task: NewTaskFields): Promise<Task>;
  updateTask(profileId: string, id: string, changes: TaskFieldChanges): Promise<Task>;
  setTaskDone(profileId: string, id: string, done: boolean): Promise<Task>;
  deleteTask(profileId: string, id: string): Promise<void>;
  restoreTask(profileId: string, id: string): Promise<void>;
  /**
   * "This occurrence is done" (ADR-024): a one-off completes, while a recurring
   * task advances in place to its next due date and comes back as `todo` again.
   * This is the checkbox/kanban path for EVERY task — the caller never needs to
   * know whether the task recurs, and `setTaskDone(…, true)` refuses a
   * recurring one precisely so the two paths cannot drift apart.
   */
  completeTaskOccurrence(profileId: string, id: string): Promise<Task>;
  /** Everything the task rail draws — lists and their sections — in one fetch (ADR-029). */
  listTaskLists(profileId: string): Promise<TaskListsSnapshot>;
  /** Creates a list, appended at the end of its parent scope; `parentId` null makes it a root list. */
  createTaskList(profileId: string, name: string, parentId: string | null): Promise<TaskList>;
  /** Renames a list. The Inbox renames like any other — only its deletion and its placement are fixed. */
  renameTaskList(profileId: string, id: string, name: string): Promise<void>;
  /** Remembers which shape this list opens in (TASK-005): the per-list view memory the view toggle writes. */
  setTaskListView(profileId: string, id: string, view: TaskListView): Promise<void>;
  /** Remembers what this list's views are set to (ADR-050) — the whole config, `null` to clear it. */
  setTaskListViewConfig(
    profileId: string,
    id: string,
    config: TaskViewConfig | null,
  ): Promise<void>;
  /** Re-parents and re-orders in one call; refuses a cycle, and refuses to move the Inbox at all. */
  moveTaskList(
    profileId: string,
    id: string,
    parentId: string | null,
    beforeId: string | null,
    afterId: string | null,
  ): Promise<void>;
  /**
   * Deletes a list, taking its tasks one of the two ways the user can mean
   * (`"move-to-inbox"` / `"delete-tasks"`); child lists always promote to the
   * deleted list's own parent. Reversible through `restoreTaskList` — which
   * brings back exactly the tasks THIS delete removed, so the undo of a
   * "move-to-inbox" restores the list without dragging the moved tasks back.
   */
  deleteTaskList(profileId: string, id: string, mode: DeleteListMode): Promise<void>;
  restoreTaskList(profileId: string, id: string): Promise<void>;
  createTaskSection(profileId: string, listId: string, name: string): Promise<TaskSection>;
  renameTaskSection(profileId: string, id: string, name: string): Promise<void>;
  moveTaskSection(
    profileId: string,
    id: string,
    beforeId: string | null,
    afterId: string | null,
  ): Promise<void>;
  /** Deletes a section and promotes its tasks to the list body, appended at its end. */
  deleteTaskSection(profileId: string, id: string): Promise<void>;
  /** Moves a task (and its live subtree) into another list — the rail's drop target. */
  moveTaskToList(profileId: string, id: string, listId: string): Promise<Task>;
  /** Moves one task into a section of its own list, or back to the body with `null`. */
  moveTaskToSection(profileId: string, id: string, sectionId: string | null): Promise<Task>;
  /** Re-orders a task within its own scope — the list view's drag between two rows. */
  reorderTask(
    profileId: string,
    id: string,
    beforeId: string | null,
    afterId: string | null,
  ): Promise<Task>;
  /**
   * The five batch actions over a hand-picked selection (ADR-038). Each is one
   * store transaction and refuses the WHOLE batch on any per-row failure, so a
   * rejected promise means nothing changed.
   *
   * All five reply with nothing on purpose: a batch moves and re-positions rows
   * it was never asked about (a move re-appends a subtree; a delete renumbers
   * nothing but hides children), so the page re-reads rather than patching what
   * a reply could only partly describe.
   */
  bulkMoveTasksToList(
    profileId: string,
    ids: string[],
    listId: string,
    sectionId: string | null,
  ): Promise<void>;
  bulkSetTaskPriority(profileId: string, ids: string[], priority: TaskPriority): Promise<void>;
  /** `null` clears the rok; the batch is refused where a rule or a reminder ladder anchors on it. */
  bulkSetTaskDueDate(profileId: string, ids: string[], dueDate: string | null): Promise<void>;
  bulkDeleteTasks(profileId: string, ids: string[]): Promise<void>;
  bulkRestoreTasks(profileId: string, ids: string[]): Promise<void>;
  /** This profile's task tags, alphabetical by name (the rail re-sorts with `Intl.Collator(["sr-Latn","sr"])`). */
  listTaskTags(profileId: string): Promise<TaskTag[]>;
  /** Get-or-create by trimmed name: tagging with a name the profile already has returns that tag rather than a second one. */
  createTaskTag(profileId: string, name: string): Promise<TaskTag>;
  renameTaskTag(profileId: string, id: string, name: string): Promise<void>;
  /** Deletes a tag; the schema's CASCADE takes its attachments with it, so the tag disappears from every task at once. */
  deleteTaskTag(profileId: string, id: string): Promise<void>;
  /** Every task-tag attachment of the profile in one fetch — the page indexes them by task rather than asking per row. Attachments of soft-deleted tasks are hidden, not dropped. */
  listTaskTagLinks(profileId: string): Promise<TaskTagLink[]>;
  attachTaskTag(profileId: string, taskId: string, tagId: string): Promise<void>;
  detachTaskTag(profileId: string, taskId: string, tagId: string): Promise<void>;
  /** One task's attachments, oldest first. Only an ACTIVE task of this profile has any to list. */
  listTaskAttachments(profileId: string, taskId: string): Promise<TaskAttachment[]>;
  /** Opens the native file picker and attaches whatever the user chooses — main reads the files, the renderer never touches a path or a byte. Resolves once the dialog is settled and every chosen file has been handled. */
  attachTaskFiles(profileId: string, taskId: string): Promise<TaskAttachmentsAddResult>;
  removeTaskAttachment(profileId: string, taskId: string, attachmentId: string): Promise<void>;
  /** Copies the attachment's blob to a main-owned temp file and opens it with the OS default handler. */
  openTaskAttachment(profileId: string, taskId: string, attachmentId: string): Promise<void>;
  /** Copies the attachment's blob to a path chosen via a native save dialog. Resolves after the dialog is settled — canceled or written. */
  saveTaskAttachmentAs(
    profileId: string,
    taskId: string,
    attachmentId: string,
  ): Promise<SaveAttachmentResult>;
  /** Every live task's attachment count in one fetch — the page indexes them by task rather than asking per row (the `cardCounts` idiom). */
  taskAttachmentCounts(profileId: string): Promise<TaskAttachmentCount[]>;
  /** This profile's task templates, alphabetical by name (the popover re-sorts with `Intl.Collator(["sr-Latn","sr"])`). */
  listTaskTemplates(profileId: string): Promise<TaskTemplate[]>;
  /** Captures `taskId` — its own fields, its direct live subtasks and its tags — as a template called `name`. An existing name is REPLACED. */
  saveTaskTemplateFromTask(profileId: string, taskId: string, name: string): Promise<TaskTemplate>;
  /** Creates a task from a template in the given list/section, returning the created parent. */
  applyTaskTemplate(
    profileId: string,
    templateId: string,
    listId: string,
    sectionId: string | null,
  ): Promise<Task>;
  /** Deletes a template; no task created from it is touched. */
  deleteTaskTemplate(profileId: string, id: string): Promise<void>;
  /** Every dependency of the profile whose both ends are live tasks, in one fetch — the page derives "blocked" from these plus the tasks it already has. */
  listTaskDependencies(profileId: string): Promise<TaskDependencyLink[]>;
  /** Records "`blockedId` waits on `blockerId`". Idempotent; rejects a self-edge and any edge that would close a cycle. */
  addTaskDependency(profileId: string, blockerId: string, blockedId: string): Promise<void>;
  removeTaskDependency(profileId: string, blockerId: string, blockedId: string): Promise<void>;
  listEvents(profileId: string): Promise<Event[]>;
  createEvent(profileId: string, event: NewEventFields): Promise<Event>;
  updateEvent(profileId: string, id: string, changes: EventFieldChanges): Promise<Event>;
  deleteEvent(profileId: string, id: string): Promise<void>;
  restoreEvent(profileId: string, id: string): Promise<void>;
  /** Removes one occurrence date from a series (ADR-024) — the "delete just this one" / "detach it into its own event" primitive. Adding a date the series already excepts changes nothing. */
  addEventRecurrenceExdate(profileId: string, id: string, date: string): Promise<Event>;
  /**
   * The "this and future occurrences" truncation (ADR-024): the master's series
   * ends the day before `occurrenceDate`, and the truncated master comes back.
   * Carrying the edited fields forward is a separate, ordinary `createEvent` —
   * so a split, a "delete from here on", and a "change the rule from here on"
   * are all this one call plus whatever the caller does next.
   */
  splitEventRecurrence(profileId: string, id: string, occurrenceDate: string): Promise<Event>;
  /** This profile's event templates, alphabetical by name (the popover re-sorts with `Intl.Collator(["sr-Latn","sr"])`). */
  listEventTemplates(profileId: string): Promise<EventTemplate[]>;
  /** Captures `eventId`'s SHAPE — its time of day, length, reminders, rule and text — as a template called `name`. An existing name is REPLACED. */
  captureEventTemplate(profileId: string, eventId: string, name: string): Promise<EventTemplate>;
  /** Creates an event from a template on `dayKey` (a bare `YYYY-MM-DD`), returning the created row. */
  applyEventTemplate(profileId: string, templateId: string, dayKey: string): Promise<Event>;
  /** Deletes a template; no event created from it is touched. */
  deleteEventTemplate(profileId: string, id: string): Promise<void>;
  /** This profile's people, name-ordered by SQLite's binary collation (CAL-007); the renderer re-sorts with `Intl.Collator(["sr-Latn","sr"])`. */
  listPeople(profileId: string): Promise<Person[]>;
  createPerson(profileId: string, person: NewPersonFields): Promise<Person>;
  updatePerson(profileId: string, id: string, changes: PersonFieldChanges): Promise<Person>;
  deletePerson(profileId: string, id: string): Promise<void>;
  restorePerson(profileId: string, id: string): Promise<void>;
  listDocuments(profileId: string): Promise<TrackedDocument[]>;
  createDocument(profileId: string, doc: NewDocumentFields): Promise<TrackedDocument>;
  updateDocument(
    profileId: string,
    id: string,
    changes: DocumentFieldChanges,
  ): Promise<TrackedDocument>;
  deleteDocument(profileId: string, id: string): Promise<void>;
  restoreDocument(profileId: string, id: string): Promise<void>;
  renewDocument(profileId: string, id: string, newExpiryDate: string): Promise<TrackedDocument>;
  listDocumentRenewals(profileId: string, id: string): Promise<DocumentRenewal[]>;
  listSubjects(profileId: string): Promise<Subject[]>;
  createSubject(profileId: string, subject: NewSubjectFields): Promise<Subject>;
  updateSubject(profileId: string, id: string, changes: SubjectFieldChanges): Promise<Subject>;
  deleteSubject(profileId: string, id: string): Promise<void>;
  restoreSubject(profileId: string, id: string): Promise<void>;
  /** One active subject's materials, oldest first (STUDY-001 / migration 035). */
  listSubjectAttachments(profileId: string, subjectId: string): Promise<SubjectAttachment[]>;
  /** Opens the native picker in MAIN and attaches whatever comes back — no bytes and no path cross the bridge. */
  attachSubjectFiles(profileId: string, subjectId: string): Promise<SubjectAttachmentsAddResult>;
  removeSubjectAttachment(
    profileId: string,
    subjectId: string,
    attachmentId: string,
  ): Promise<void>;
  /** Hands the decrypted file to the OS through a temp copy — `openTaskAttachment`'s route, one module over. */
  openSubjectAttachment(profileId: string, subjectId: string, attachmentId: string): Promise<void>;
  saveSubjectAttachmentAs(
    profileId: string,
    subjectId: string,
    attachmentId: string,
  ): Promise<SaveAttachmentResult>;
  /** The live notes filed under one live subject (STUDY-001 / migration 035). */
  listSubjectLinkedNotes(profileId: string, subjectId: string): Promise<LinkedNote[]>;
  linkSubjectNote(profileId: string, subjectId: string, noteId: string): Promise<void>;
  unlinkSubjectNote(profileId: string, subjectId: string, noteId: string): Promise<void>;
  listExams(profileId: string): Promise<Exam[]>;
  createExam(profileId: string, exam: NewExamFields): Promise<Exam>;
  updateExam(profileId: string, id: string, changes: ExamFieldChanges): Promise<Exam>;
  deleteExam(profileId: string, id: string): Promise<void>;
  restoreExam(profileId: string, id: string): Promise<void>;
  listDecks(profileId: string): Promise<Deck[]>;
  createDeck(profileId: string, deck: NewDeckFields): Promise<Deck>;
  updateDeck(profileId: string, id: string, changes: DeckFieldChanges): Promise<Deck>;
  deleteDeck(profileId: string, id: string): Promise<void>;
  restoreDeck(profileId: string, id: string): Promise<void>;
  listCardsByDeck(profileId: string, deckId: string): Promise<Card[]>;
  createCard(profileId: string, card: NewCardFields): Promise<Card>;
  /** Creates one cloze card per `{{…}}` deletion in `text`, atomically; returns the siblings in ordinal order (ADR-042). */
  createClozeCards(profileId: string, deckId: string, text: string): Promise<Card[]>;
  /** Creates one problem card — a basic card whose `back` the main process derives from `stepsText` (ADR-046). */
  createProblemCard(
    profileId: string,
    deckId: string,
    front: string,
    stepsText: string,
  ): Promise<Card>;
  updateCard(profileId: string, id: string, changes: CardFieldChanges): Promise<Card>;
  deleteCard(profileId: string, id: string): Promise<void>;
  restoreCard(profileId: string, id: string): Promise<void>;
  cardCounts(profileId: string): Promise<DeckCounts[]>;
  /**
   * The session's cards, plus whether the profile's daily review cap truncated
   * the due section (STUDY-007). `newLimit` is deliberately never sent by the
   * reviewer: omitted, the store resolves it from the profile's own
   * „Novih kartica dnevno".
   */
  reviewQueue(profileId: string, scope?: ReviewQueueScope): Promise<ReviewQueue>;
  gradeReview(profileId: string, id: string, rating: CardRating): Promise<Card>;
  undoReview(profileId: string, id: string): Promise<Card>;
  previewReview(profileId: string, id: string): Promise<PreviewIntervals>;
  /** This profile's target retention and daily caps, defaults already applied (STUDY-007). Never writes. */
  studySettings(profileId: string): Promise<StudySettings>;
  /** Writes all three preferences and answers with the fresh row. Existing cards are never retro-rescheduled. */
  setStudySettings(profileId: string, settings: StudySettings): Promise<StudySettings>;
  listPlans(profileId: string): Promise<StudyPlan[]>;
  createPlan(profileId: string, plan: NewPlanFields): Promise<StudyPlan>;
  updatePlan(profileId: string, id: string, changes: PlanFieldChanges): Promise<StudyPlan>;
  deletePlan(profileId: string, id: string): Promise<void>;
  restorePlan(profileId: string, id: string): Promise<void>;
  syncAllPlans(profileId: string): Promise<number>;
  listBlocksByPlan(profileId: string, planId: string): Promise<StudyBlock[]>;
  listBlocksInRange(
    profileId: string,
    fromDate: string,
    toDate: string,
  ): Promise<StudyBlockWithExam[]>;
  setBlockStatus(profileId: string, id: string, status: StudyBlockStatus): Promise<StudyBlock>;
  startFocus(profileId: string, subjectId: string): Promise<RunningFocusSession>;
  stopFocus(profileId: string): Promise<FocusSession | null>;
  focusStatus(profileId: string): Promise<RunningFocusSession | null>;
  cancelFocus(profileId: string): Promise<void>;
  listFocusRange(profileId: string, fromDate: string, toDate: string): Promise<FocusSession[]>;
  deleteFocus(profileId: string, id: string): Promise<void>;
  restoreFocus(profileId: string, id: string): Promise<void>;
  studyStats(profileId: string, fromDate: string, toDate: string): Promise<StudyStats>;
  subjectStudyLog(
    profileId: string,
    subjectId: string,
    fromDay: string,
    toDay: string,
  ): Promise<SubjectStudyLog>;
  listCenterNotifications(profileId: string): Promise<NotificationRecord[]>;
  /** Omitting `preset` snoozes by the profile's own default (NTF-009) — main reads it, the renderer never needs to know it. */
  snoozeNotification(
    profileId: string,
    id: string,
    preset?: SnoozePreset,
  ): Promise<NotificationRecord>;
  dismissNotification(profileId: string, id: string): Promise<void>;
  getNotificationSettings(profileId: string): Promise<NotificationSettings>;
  updateNotificationSettings(
    profileId: string,
    changes: NotificationSettingsChanges,
  ): Promise<NotificationSettings>;
  setNotificationSourceEnabled(
    profileId: string,
    source: NotificationSource,
    enabled: boolean,
  ): Promise<void>;
  /**
   * Subscribes to the single `notifications:changed` push event (no payload —
   * the listener re-fetches). Returns an unsubscribe function. The one
   * deliberate exception to "one method per channel": this is still exactly
   * one fixed channel, never a generic `on(channel, ...)` passthrough.
   */
  onNotificationsChanged(listener: () => void): () => void;
  /**
   * Subscribes to the single `notifications:appetite-ask` push event (NTF-008 /
   * ADR-033) — payload-free, exactly like `onNotificationsChanged`, since the
   * only thing it carries is "now is the moment to ask". Main may push it again
   * on a later check while the question is still unanswered, so the listener
   * guards against opening the dialog twice. Returns an unsubscribe function.
   */
  onNotificationAppetiteAsk(listener: () => void): () => void;
  /** Answers the one-time appetite question; `sources` null keeps the current settings. Marks the question asked either way. */
  answerNotificationAppetite(
    profileId: string,
    sources: NotificationSource[] | null,
  ): Promise<void>;
  listNotes(profileId: string, filter?: { folderId?: string | null }): Promise<NoteMeta[]>;
  createNote(profileId: string): Promise<NoteMeta>;
  loadNote(profileId: string, noteId: string): Promise<NoteDocPayload>;
  appendNoteUpdate(
    profileId: string,
    noteId: string,
    update: Uint8Array,
    title: string,
  ): Promise<void>;
  /**
   * Soft-deletes a note, together with the disposition of the flashcards it
   * generated (PRD 09 section 7). `cards` defaults to `"keep"`, which is what
   * a note with no generated cards sends — for it, both dispositions are a
   * no-op and the delete is exactly what it always was.
   */
  deleteNote(profileId: string, noteId: string, cards?: NoteCardDisposition): Promise<void>;
  /**
   * Copies a note into a new, independent one (NOTE-010): same content, fresh
   * card keys, its own attachment rows, the same tags and folder — unpinned,
   * unmapped from any deck, and with no version history of its own yet.
   */
  duplicateNote(profileId: string, noteId: string): Promise<NoteDuplicateResult>;
  /** Undo of `deleteNote`: restores the note, and the cards deleted in that same act (never any other). */
  restoreNote(profileId: string, noteId: string): Promise<void>;
  /** How many live flashcards this note currently generates — what the delete dialog counts (PRD 09 section 7). */
  countNoteCards(profileId: string, noteId: string): Promise<number>;
  /**
   * How many tasks „Pretvori u zadatke" would make out of this note's checklist
   * — rows with no text are not counted, because they would be skipped. Probed
   * before the action is offered, exactly as `countNoteCards` is probed before
   * the delete dialog: an action that can only report doing nothing is not
   * offered at all.
   */
  countNoteChecklistItems(profileId: string, noteId: string): Promise<number>;
  /**
   * Copies this note's checklist out into real tasks in `listId` (NOTE section 6).
   * The note is NOT changed — the checklist stays where it is.
   */
  convertNoteChecklistToTasks(
    profileId: string,
    noteId: string,
    listId: string,
  ): Promise<NoteChecklistTasksResult>;
  listNoteFolders(profileId: string): Promise<NoteFolder[]>;
  createNoteFolder(
    profileId: string,
    input: { parentId: string | null; name: string; color: NoteFolderColor | null },
  ): Promise<NoteFolder>;
  updateNoteFolder(
    profileId: string,
    id: string,
    fields: NoteFolderFieldChanges,
  ): Promise<void>;
  moveNoteFolder(profileId: string, id: string, newParentId: string | null): Promise<void>;
  deleteNoteFolder(profileId: string, id: string): Promise<void>;
  /** ADR-036: the template new notes in this folder open with; `null` clears it. Rejects an id that is neither a built-in nor one of this profile's templates. */
  setNoteFolderTemplate(profileId: string, id: string, templateId: string | null): Promise<void>;
  /** ADR-036: moves this profile's quick-capture mark onto `id`, or clears it with `null`. */
  setNoteFolderCaptureDefault(profileId: string, id: string | null): Promise<void>;
  /** NOTE-002: the shape the note list opens in while this folder is selected. The root's own choice is a device preference (`notePrefs.ts`), not this. */
  setNoteFolderView(profileId: string, id: string, view: NoteFolderView): Promise<void>;
  listNoteTags(profileId: string): Promise<NoteTag[]>;
  createNoteTag(profileId: string, name: string): Promise<NoteTag>;
  renameNoteTag(profileId: string, id: string, name: string): Promise<void>;
  deleteNoteTag(profileId: string, id: string): Promise<void>;
  listNoteTagLinks(profileId: string): Promise<NoteTagLink[]>;
  attachNoteTag(profileId: string, noteId: string, tagId: string): Promise<void>;
  detachNoteTag(profileId: string, noteId: string, tagId: string): Promise<void>;
  setNoteFolder(profileId: string, noteId: string, folderId: string | null): Promise<void>;
  setNotePinned(profileId: string, noteId: string, pinned: boolean): Promise<void>;
  setNoteLinks(profileId: string, noteId: string, targetIds: string[]): Promise<void>;
  listNoteBacklinks(profileId: string, noteId: string): Promise<NoteMeta[]>;
  /** Browse-list metadata for this note's checkpoints, newest first (ADR-015 / NOTE-008). */
  listNoteVersions(profileId: string, noteId: string): Promise<NoteVersionMeta[]>;
  /** One checkpoint's full snapshot bytes, for a read-only version preview. */
  loadNoteVersion(profileId: string, noteId: string, coveredSeq: number): Promise<Uint8Array>;
  /** The pre-restore safety checkpoint — no age gate, deduped by covered_seq. */
  captureNoteVersion(profileId: string, noteId: string): Promise<void>;
  /** This profile's user-defined templates, name-ordered (ADR-016 / NOTE-009); the renderer re-sorts with `Intl.Collator(["sr-Latn","sr"])`. */
  listNoteTemplates(profileId: string): Promise<NoteTemplate[]>;
  /** Upserts on name (ADR-016): saving under an existing template's name replaces its content, keeping the same id. */
  saveNoteTemplate(profileId: string, name: string, content: string): Promise<NoteTemplate>;
  /** Renaming to the template's own current name is a no-op; onto another template's name rejects. */
  renameNoteTemplate(profileId: string, id: string, name: string): Promise<void>;
  deleteNoteTemplate(profileId: string, id: string): Promise<void>;
  /** Syncs this note's generated flashcards: a full reconcile of its card-syntax blocks against `deckId`, keyed by each spec's `key` (NOTE-006). */
  syncNoteCards(profileId: string, noteId: string, deckId: string, cards: NoteCardSpec[]): Promise<void>;
  /** Points (or unpoints, with `null`) this note's generated cards at a deck (NOTE-006). */
  setNoteCardDeck(profileId: string, noteId: string, deckId: string | null): Promise<void>;
  listNoteAttachments(profileId: string, noteId: string): Promise<NoteAttachment[]>;
  /** Attaches a file to a note; main sniffs `bytes` for the real MIME type (SEC-FILE-02) — `fileName` is display-only. */
  attachNoteFile(
    profileId: string,
    noteId: string,
    fileName: string,
    bytes: Uint8Array,
  ): Promise<NoteAttachment>;
  removeNoteAttachment(profileId: string, noteId: string, attachmentId: string): Promise<void>;
  /** Copies the attachment's blob to a main-owned temp file and opens it with the OS default handler. */
  openNoteAttachment(profileId: string, noteId: string, attachmentId: string): Promise<void>;
  /** Copies the attachment's blob to a path chosen via a native save dialog. Resolves after the dialog is settled — canceled or written. */
  saveNoteAttachmentAs(
    profileId: string,
    noteId: string,
    attachmentId: string,
  ): Promise<SaveAttachmentResult>;
  /** This profile's dashboard background and dim, defaults already applied (SET-006 / ADR-041). Never writes. */
  dashboardSettings(profileId: string): Promise<DashboardSettings>;
  /**
   * Opens the native image picker in MAIN, which reads, sniffs and encrypts the
   * chosen file into the blob store before the settings row is written — the
   * renderer sends no path and no bytes. Resolves once the dialog is settled:
   * canceled, refused with a named reason, or applied.
   */
  pickDashboardBackground(profileId: string): Promise<DashboardPickResult>;
  /** Drops the background, keeping the dim; the blob is garbage-collected in main if nothing else references it. */
  clearDashboardBackground(profileId: string): Promise<DashboardSettings>;
  /** Sets how far the scrim dims the image, 0..`MAX_BACKGROUND_DIM`. */
  setDashboardDim(profileId: string, dim: number): Promise<DashboardSettings>;
  /**
   * This profile's dashboard layout in draw order (DASH-002 / ADR-045) — the
   * DEFAULT arrangement while the profile has never rearranged it, which is a
   * resolved answer and not an empty one. Never writes.
   */
  dashboardWidgets(profileId: string): Promise<DashboardWidgetInstance[]>;
  /**
   * Places `widgetId` at the end of the layout and answers with the whole
   * resulting layout. The first mutation of a profile still on the default
   * writes that default out as real rows first, so adding a sixth widget never
   * costs the five that were there.
   */
  addDashboardWidget(
    profileId: string,
    widgetId: string,
    size: DashboardWidgetSize,
  ): Promise<DashboardWidgetInstance[]>;
  /**
   * Removes one placement, answering with the resulting layout. Removing the
   * LAST one puts the default arrangement back: no rows IS the default, so
   * "remove everything" is also how a user resets.
   */
  removeDashboardWidget(
    profileId: string,
    instanceId: string,
  ): Promise<DashboardWidgetInstance[]>;
  /** Changes one placement's size preset, leaving its place in the order alone. */
  setDashboardWidgetSize(
    profileId: string,
    instanceId: string,
    size: DashboardWidgetSize,
  ): Promise<DashboardWidgetInstance[]>;
  /** Re-orders one placement between two others, either null at an end of the layout. */
  moveDashboardWidget(
    profileId: string,
    instanceId: string,
    beforeId: string | null,
    afterId: string | null,
  ): Promise<DashboardWidgetInstance[]>;
  /** Runs the query pipeline (parse -> FTS match -> bm25 candidates -> rank), falling back to `searchRecent`'s order when the query has no matchable terms (ADR-021). */
  searchQuery(profileId: string, query: string, limit: number): Promise<SearchResult[]>;
  /** The profile's most recently touched entries, already in their final order — no ranking pass, unlike `searchQuery`. */
  searchRecent(profileId: string, limit: number): Promise<SearchResult[]>;
  /** The ADR-039 search page: the same pipeline over a wider candidate bound, plus the kind/tag facet counts the page's chip rows draw. An empty query is browse mode, not an error. */
  searchPage(profileId: string, query: string): Promise<SearchPageResult>;
  /** Rebuilds the ENTIRE file's search index from scratch (corruption recovery, not a per-profile operation); returns the resulting row count. */
  rebuildSearchIndex(profileId: string): Promise<number>;
  /**
   * Full-data export (IMEX slice a1, extended by ADR-022). `passphrase` seals
   * the archive under a passphrase-derived key (an `.nexus` `NXA1`
   * container); `null` means the explicitly-confirmed plaintext `.nexus.zip`
   * export. `modules` narrows the archive to those modules (IMEX-003) and
   * omitting it exports all of them. Resolves after the native save dialog is
   * settled — canceled or written.
   */
  exportData(
    profileId: string,
    passphrase: string | null,
    modules?: readonly ArchiveModuleName[],
  ): Promise<ExportResult>;
  /** The calendar alone, as an RFC 5545 `.ics` (CAL-008) — one open text file, no passphrase branch. Resolves after the native save dialog is settled. */
  exportCalendarIcs(profileId: string): Promise<IcsExportResult>;
  /** Opens the native "pick a restore archive" dialog (IMEX slice 3c, ADR-023). Main remembers the pick, which is why nothing below ever names a path. */
  pickRestoreArchive(): Promise<RestorePickResult>;
  /** Dry-runs the restore by really parsing the picked archive — never an estimate. `passphrase` is `null` for a plain `.nexus.zip`; a wrong one comes back as `{ status: "unreadable", code: "passphrase-wrong" }` rather than as a rejection. */
  previewRestore(profileId: string, passphrase: string | null): Promise<RestorePreviewResult>;
  /** Confirms the preview `token` names, replacing this profile's entire contents. The renderer is reloaded shortly AFTER this resolves, so nothing may depend on the reload having already happened. */
  applyRestore(profileId: string, token: string): Promise<RestoreApplyResult>;
  /** Puts the profile back exactly as it was before the last applied restore (ADR-023 section 3). Rejects when there is nothing to undo. */
  undoRestore(profileId: string): Promise<RestoreUndoResult>;
  /** Whether a restore OR an import is still undoable — the first thing a reloaded renderer asks, since the reload replaced the screen that would have shown the banner. One slot: `kind` says which operation it is offering to undo. */
  restoreStatus(profileId: string): Promise<RestoreStatus>;
  /** Drops the picked archive without applying it, releasing the OS file lock an opened one holds. */
  cancelRestore(): Promise<void>;
  /**
   * Opens the native "pick an archive to import" dialog (ADR-043). A separate
   * channel from `pickRestoreArchive` on purpose: main holds the two picks
   * apart, so a preview of one can never be applied as the other.
   */
  pickImportArchive(): Promise<ImportPickResult>;
  /**
   * Dry-runs the import by really parsing the picked archive in salvage mode and
   * really planning it against this profile — never an estimate. `passphrase` is
   * `null` for a plain `.nexus.zip`; a wrong one comes back as
   * `{ status: "unreadable", code: "passphrase-wrong" }` rather than as a rejection.
   */
  previewImport(profileId: string, passphrase: string | null): Promise<ImportPreviewResult>;
  /**
   * Re-plans the archive `token`'s preview already has open, under `choices`
   * (ADR-051), and answers a fresh preview carrying a fresh token. Never
   * re-opens the file, never re-runs the KDF and never asks for the passphrase
   * again — changing a duplicate choice costs a re-plan, not a re-read.
   */
  replanImport(
    profileId: string,
    token: string,
    choices: ImportDuplicateChoices,
  ): Promise<ImportPreviewResult>;
  /**
   * Confirms the plan `token` names, MERGING it into this profile: every row is
   * added under a new id and nothing already there is touched. Undoable through
   * `undoRestore`, which the two operations share. The renderer is reloaded
   * shortly AFTER this resolves, so nothing may depend on the reload having
   * already happened.
   */
  applyImport(profileId: string, token: string): Promise<ImportApplyResult>;
  /** Drops the picked import archive without applying it, releasing the OS file lock an opened one holds. */
  cancelImport(): Promise<void>;
  /**
   * Opens the native "pick an .apkg" dialog (ADR-052). Its own pick, held apart
   * from both archive picks for the reason they are held apart from each other:
   * nothing on one surface may ever reach another's file.
   */
  pickApkgFile(): Promise<ApkgImportPickResult>;
  /**
   * Dry-runs the `.apkg` import by really reading the file, really translating
   * it and really planning it against this profile under `subject` — never an
   * estimate. Calling it again with a different `subject` re-plans the file main
   * already has open, at the cost of a re-plan rather than a re-read.
   */
  previewApkgImport(
    profileId: string,
    subject: ApkgImportSubjectChoice,
  ): Promise<ApkgImportPreviewResult>;
  /**
   * Confirms the plan `token` names, ADDING its decks and cards to this profile.
   * Undoable through `undoRestore`, which all three archive operations share.
   * The renderer is reloaded shortly AFTER this resolves.
   */
  applyApkgImport(profileId: string, token: string): Promise<ApkgImportApplyResult>;
  /** Drops the picked `.apkg` without applying it, releasing the OS file lock an opened one holds. */
  cancelApkgImport(): Promise<void>;
  /**
   * Opens the native `.md` picker in MAIN (files or a folder, per `source`),
   * reads and parses every file there, and writes each one as a real note in
   * `folderId` — the renderer sends no path and no bytes, exactly as with the
   * dashboard background. Resolves once every file has been settled: nothing
   * is previewed and nothing is undone, so the reply IS the report.
   */
  importMarkdownNotes(
    profileId: string,
    folderId: string | null,
    source: MarkdownImportSource,
  ): Promise<MarkdownImportResult>;
  /**
   * Asks main to hold `chord` as an OS-wide hotkey (TASK-002), replacing
   * whatever it held before. Called once at boot — after the renderer has read
   * its `localStorage` overrides, which main cannot see — and again on every
   * remap. `ok: false` means the system refused the combination (another
   * application owns it); main keeps its previous working registration, so the
   * caller only has a message to show, never a state to repair.
   */
  setGlobalShortcut(chord: GlobalShortcutChord): Promise<GlobalShortcutResult>;
  /**
   * Subscribes to the single `shortcuts:global-capture` push event — the
   * OS hotkey firing while Nexus was in the background. Payload-free, exactly
   * like `onNotificationsChanged`: main has already restored and focused the
   * window, and the only thing this carries is "open a task for capture".
   * Never pushed to a locked session. Returns an unsubscribe function.
   */
  onGlobalCapture(listener: () => void): () => void;
  appInfo(): Promise<AppInfo>;
}
