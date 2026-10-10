import type { ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * The WORKSHOP module's file contract: the three channels its PDF and image
 * tools need, declared here rather than in `shared/ipc.ts` (ADR-090).
 *
 * **Why the tools get a file of their own.** `shared/ipc.ts` is owned by the run
 * that builds the page, and the two tool sets arrive from another one. The ops
 * below are declared ONCE here as a fragment: `shared/ipc.ts` folds
 * `WorkshopFileOps` into the module's own op map and `WORKSHOP_FILE_OPS` into
 * its op list, so the module still has exactly one contract — which matters,
 * because the preload bridge keys its namespaces by contract id, and a second
 * contract called `workshop` would overwrite the first in that map.
 *
 * **The renderer never names a path.** Every operation here either opens a
 * native dialog in main or carries bytes main has already read; a name is a
 * DISPLAY string for a file that is being written, and main derives the name it
 * actually uses (sanitized, and re-extended from the bytes it sniffs). That is
 * SEC-EL's rule for this module, and it is also why `saveFile` answers with the
 * name rather than the path: the renderer has nothing to do with a path.
 *
 * **Why binary rides as `Uint8Array`.** Electron's structured clone carries a
 * typed array as itself, so a PDF is copied between processes without base64 —
 * a third more bytes, and an encode/decode pair at each end of a 50 MB file.
 * `shared/ipc.ts` says the same about a note's Yjs updates.
 */

/**
 * The cap on one file, in bytes.
 *
 * 50 MB, which is `MAX_NOTE_ATTACHMENT_BYTES`' own number, copied rather than
 * reinvented for the reason `LIBRARY_MAX_COVER_BYTES` copies it: a second number
 * would only be a second answer to "how big may a file be" in an app where the
 * user is already told 50 MB everywhere else.
 */
export const WORKSHOP_MAX_FILE_BYTES = 52_428_800;

/**
 * The most files one pick may bring in, and the most bytes the pick may hold.
 *
 * A batch is read in main and then cloned to the worker as a whole, so the
 * interesting bound is the TOTAL rather than the per-file one: twenty files at
 * the per-file cap would be a gigabyte in two processes at once. 200 MB is what
 * a batch of documents realistically is; a pick past it is refused file by file,
 * from the last one backwards, and the count of what was left out is reported.
 */
export const WORKSHOP_MAX_BATCH_FILES = 20;
export const WORKSHOP_MAX_BATCH_BYTES = 209_715_200;

/**
 * The cap on what main will write back out.
 *
 * The same number as the batch's input cap, and deliberately not a policy about
 * a merge growing: pdf-lib copies a document's objects, so a merge of the whole
 * batch is the same order of magnitude as its input. This bound is the last
 * thing between a bug in the worker and a 4 GB write.
 */
export const WORKSHOP_MAX_OUTPUT_BYTES = 209_715_200;

/** Which dialogs and which cap a pick uses. */
export type WorkshopFileKind = "pdf" | "image";

/** One file as it crosses the wire: main's own display name for it, and its bytes. */
export interface WorkshopPickedFile {
  /** The file's base name, derived by main from the dialog's path — never a path, and never a renderer-supplied name. */
  readonly name: string;
  readonly bytes: Uint8Array;
}

export interface WorkshopPickRequest {
  readonly kind: WorkshopFileKind;
}

/**
 * What a pick answers.
 *
 * A cancelled dialog is an ordinary answer rather than a rejection: the user
 * changed their mind, which is not an error and must not surface as one.
 */
export interface WorkshopPickResult {
  readonly canceled: boolean;
  readonly files: readonly WorkshopPickedFile[];
  /** Files left out because one file was over the per-file cap, or the pick had already reached its total. */
  readonly skippedTooLarge: number;
  /** Files left out because they could not be read at all, or because the pick was already holding its file count. */
  readonly skippedUnreadable: number;
}

export interface WorkshopSaveRequest {
  /** What to start the save dialog's name field with; main sanitizes it and re-extends it from the bytes' own type. */
  readonly suggestedName: string;
  readonly bytes: Uint8Array;
}

export interface WorkshopSaveResult {
  readonly canceled: boolean;
  /** The name the file was written under (main's, not the suggested one), or `null` when the dialog was cancelled. */
  readonly savedName: string | null;
}

export interface WorkshopSaveBatchRequest {
  readonly files: readonly WorkshopPickedFile[];
}

export interface WorkshopSaveBatchResult {
  readonly canceled: boolean;
  /** The names actually written, in order — a name already in the folder is answered with a numbered sibling. */
  readonly writtenNames: readonly string[];
  /** The chosen folder's own name (its last segment), for the sentence the page prints; never a path. */
  readonly folderName: string | null;
}

/**
 * The file ops, as a payload→result map.
 *
 * `ModuleApiOf` turns this into the methods the page calls, and the module's
 * own `shared/ipc.ts` folds it into the contract main refuses foreign ops
 * against — which is what makes the three channels below answer on
 * `workshop:pickFiles` and friends rather than on a namespace of their own.
 */
export type WorkshopFileOps = {
  pickFiles: { request: WorkshopPickRequest; response: WorkshopPickResult };
  saveFile: { request: WorkshopSaveRequest; response: WorkshopSaveResult };
  saveBatch: { request: WorkshopSaveBatchRequest; response: WorkshopSaveBatchResult };
};

/** The op names, in declaration order — what the module's contract list spreads. */
export const WORKSHOP_FILE_OPS = [
  "pickFiles",
  "saveFile",
  "saveBatch",
] as const satisfies readonly (keyof WorkshopFileOps)[];

/**
 * The renderer-facing half: the three methods the tools call on
 * `window.nexus.modules.workshop`.
 *
 * It is a type of its own rather than an import of the module's merged API, so
 * each tool component can take it as a prop and be wired to the page without
 * either file having to know the other's shape — and so this file compiles
 * before the module's `shared/ipc.ts` exists, which the two runs' parallel
 * branches require.
 */
export type WorkshopFilesApi = ModuleApiOf<WorkshopFileOps>;

/** The validators a file handler is handed — the kit's `ModuleCall.as`, narrowed to the three this file needs. */
export interface WorkshopFileValidators {
  asRecord(value: unknown): Record<string, unknown>;
  asString(value: unknown, field: string): string;
  asCappedChars(value: unknown, field: string, maxChars: number): string;
}

/** Everything a file handler needs beyond its payload. */
export interface WorkshopFileCall {
  readonly as: WorkshopFileValidators;
}

/**
 * What `registerWorkshopFiles` is handed: the module's own adopted context.
 *
 * Structural rather than `ModuleContext<"workshop", …>` on purpose. The module
 * that eventually composes this fragment is another run's file, and a handler
 * registered against a name that file does not export yet would make this one
 * uncompilable until the merge. The kit's `handle` satisfies this shape by
 * construction: it is generic over the contract's own ops, and these three are
 * declared to BE that contract's ops.
 */
export interface WorkshopFileHost {
  handle<Op extends keyof WorkshopFileOps & string>(
    op: Op,
    handler: (
      payload: WorkshopFileOps[Op]["request"],
      call: WorkshopFileCall,
    ) => WorkshopFileOps[Op]["response"] | Promise<WorkshopFileOps[Op]["response"]>,
  ): void;
}
