/**
 * The type-level half of the module kit: what a module DECLARES, in one place,
 * so that main, preload and the module's own page agree on it by construction.
 *
 * **The problem this file is the answer to.** Until now a module's channels,
 * payload types and renderer API lived in `shared/ipc.ts` (10k lines), its
 * handlers in `main/index.ts` (14k lines) and its bridge in `preload/index.ts`
 * — three files that EVERY module edits. Thirty-odd modules arriving as
 * folders cannot each edit three files of that size, so a module now declares
 * its contract once, in its own `shared/ipc.ts`, and the three processes read
 * it from there:
 *
 * - `defineModuleContract(id, ops)` builds the channel names `${id}:${op}` and
 *   the op list, and is the ONLY place a channel string is spelled;
 * - `ModuleApiOf<Ops>` is the renderer-facing API type, derived from the same
 *   declaration, so a payload cannot drift from its handler;
 * - `ModuleApis` below is merged by each module's own file
 *   (`declare module "../../../shared/moduleApi.js" { interface ModuleApis {
 *   timers: TimersApi } }`), which is what puts `nexus.modules.timers.list(…)`
 *   on the renderer's `window.nexus` without one line of edit here.
 *
 * **Why the augmentation names a relative path.** `@nexus/core` is where a
 * MANIFEST lives, but a channel is not a manifest fact and a channel name must
 * never reach a package the renderer shares with nothing else. The desktop app
 * has no package exports map, so the merged interface is named the way every
 * other cross-folder import in this app is: by its path from the declaring file.
 *
 * **Why an empty interface is correct here and not a smell.** `ModuleApis` is
 * merged, never implemented: a build with no kit modules has no `modules` member
 * and `NexusApi.modules` is `{}`, which is exactly true. The compiler is what
 * makes a module's augmentation reach the preload and the renderer — both
 * projects include `modules/*\/shared`, which is where the declaration sits.
 */

/**
 * One operation of a module's contract.
 *
 * `request` is the payload the renderer hands to `nexus.modules.<id>.<op>(…)`
 * and main validates field by field; `response` is what the handler answers.
 * Both are declared, never inferred, because main re-validates everything the
 * renderer sends (SEC-EL-02) and a silent `any` there is how a payload shape
 * stops being checked at all.
 */
export interface ModuleOp {
  readonly request: unknown;
  readonly response: unknown;
}

/** Every op of one module, keyed by its own name. */
export type ModuleOps = Record<string, ModuleOp>;

/**
 * The renderer-facing API type of one module: one method per declared op, named
 * after the op, taking its payload and answering its result.
 *
 * The method takes the PAYLOAD and nothing else — `nexus.modules.timers.list({
 * profileId })` — because that is exactly what the preload bridge does with it:
 * one uniform rule for every module, so the bridge needs no per-module code and
 * no generic `invoke(channel)`. Positional-argument sugar would have to be
 * written per module in the bridge, which is the shape this kit exists to end.
 */
export type ModuleApiOf<Ops extends ModuleOps> = {
  readonly [K in keyof Ops]: (payload: Ops[K]["request"]) => Promise<Ops[K]["response"]>;
};

/**
 * A module's declared contract: its id, its ops, and the channels they live on.
 *
 * `channels` is the allowlist the preload builds its bridge from and the map
 * main refuses a foreign op against. It is derived from the id and the op names
 * and never spelled by hand, which is what makes "every channel starts with the
 * module's own `<id>:` prefix" true by construction rather than by review.
 */
export interface ModuleContract<Id extends string, Ops extends ModuleOps> {
  readonly id: Id;
  /** Op name → fully-qualified channel, in the order the ops were declared. */
  readonly channels: { readonly [K in keyof Ops & string]: `${Id}:${K}` };
  /** The declared op names, in declaration order — what `channels` is keyed by. */
  readonly ops: readonly (keyof Ops & string)[];
}

/**
 * Declares one module's contract.
 *
 * The op list is checked against `Ops`'s own keys in both directions, so an op
 * named in the type and forgotten in the list is a compile error, and so is a
 * list entry no payload type describes. `Ops` is passed explicitly rather than
 * inferred from the list because the list carries names and the interface
 * carries shapes — and it is the shapes that must not drift.
 */
export function defineModuleContract<Id extends string, Ops extends ModuleOps>(
  id: Id,
  ops: readonly (keyof Ops & string)[],
): ModuleContract<Id, Ops> {
  const channels: Record<string, string> = {};
  for (const op of ops) channels[op] = `${id}:${op}`;
  return { id, channels, ops } as ModuleContract<Id, Ops>;
}

/**
 * Every module's renderer API, assembled by interface merging.
 *
 * EMPTY ON PURPOSE. Each module augments it from its own `shared/ipc.ts`, one
 * line, naming its own id and its own API type; the preload and the renderer
 * then see `nexus.modules.<id>` typed without either of them knowing the module
 * exists. A build with no kit modules has an empty `modules` member, which is
 * the true answer rather than a placeholder.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- merged by every module's `shared/ipc.ts`; see above.
export interface ModuleApis {}

/** What `NexusApi.modules` is: every kit module's API, merged. */
export type NexusModules = ModuleApis;

/**
 * What a kit module's page is given.
 *
 * ONE prop, because the shell is what knows the shell: the profile the page
 * stands in. Everything else a page needs it asks main for, through its own
 * contract - which is the whole reason it does not need the shell to hand it
 * stores, a registry or a set of enabled modules.
 */
export interface ModulePageProps {
  readonly profileId: string;
}
