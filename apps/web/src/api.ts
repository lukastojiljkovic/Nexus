// The SAME contract the Electron preload bridge implements, imported rather
// than redeclared — `apps/desktop/src/shared/ipc.ts` is where `NexusApi` is
// defined, and a second copy of a 402-member interface would be a second answer
// to „what can a page ask for" within a week.
//
// THE RELATIVE PATH IS THE POINT, and it is deliberately ugly. It says out loud
// that the contract currently lives inside one app while two apps depend on it,
// which is a thing to fix and not a thing to hide behind a tsconfig alias.
// `ipc.ts` imports nothing but types from `@nexus/core`, so nothing Electron
// crosses this line; the eventual move is `apps/desktop/src/shared/ipc.ts` →
// `packages/contracts`, after which this import changes and nothing else does.
// Every reach out of this app goes through this file and `theme.ts`, so the
// move is a two-line change on this side.
import type { NexusApi } from "../../desktop/src/shared/ipc.js";
import { strings } from "./strings.js";

/** `type _X = AssertTrue<…>` — a claim the compiler checks and emits nothing for. */
type AssertTrue<T extends true> = T;

/**
 * `NexusApi` minus the kit's namespace, which is the one member that is not a
 * method: `NexusApi.modules` is an object of per-module namespaces (ADR-090,
 * `nexus.modules.timers.list(...)`) rather than a request of its own. The three
 * assertions below are stated over this type so that one honest data member does
 * not have to be answered as a function; the proxy answers it explicitly.
 */
type NexusApiMembers = Omit<NexusApi, "modules">;

/**
 * Compile-time proof that answering EVERY member of `NexusApi` with a function
 * is a legal thing to do — i.e. that the interface is methods all the way down
 * and holds no data property.
 *
 * It exists because the proxy below cannot check itself: an interface has no
 * runtime key list, so the proxy answers whatever it is asked for, and a
 * `NexusApi` that one day grew `readonly platform: string` would silently hand
 * a caller a FUNCTION where it expected a string. The caller would not report
 * „not connected"; it would render `[object Function]` or compare it against a
 * literal and take the wrong branch. This turns that into a type error at the
 * moment the member is added, which is the only moment anyone is looking.
 */
type _EveryMemberIsCallable = AssertTrue<
  NexusApiMembers extends Record<keyof NexusApiMembers, (...args: never[]) => unknown>
    ? true
    : false
>;

/**
 * THE ONE RULE THE PROXY DISPATCHES ON, and the two assertions that keep it
 * true.
 *
 * `NexusApi` has three kinds of member and they need different answers:
 *
 *   - 398 request methods returning a `Promise`. These must REJECT, not throw.
 *     The desktop renderer chains `.catch(…)` straight onto a dozen of them
 *     (`window.nexus.setActiveProfile(id).catch(…)`), and a synchronous throw
 *     sails straight past a `.catch` — so the pages most careful about failure
 *     would be the ones that crashed when they were ported here.
 *   - four subscriptions, `on…`, returning an unsubscribe function. These must
 *     THROW where they are called. A rejected promise handed back as an
 *     „unsubscribe" would be stored by a `useEffect` cleanup and called on
 *     unmount, producing a crash in a teardown path with no connection to the
 *     line that caused it.
 *   - one namespace, `modules` (ADR-090), which is not callable at all and so
 *     gets neither treatment: the web build serves no kit module and answers it
 *     with a frozen empty object, below.
 *
 * Nothing at runtime can tell the two callable kinds apart — a proxy sees a name
 * and nothing else — so the rule is the NAME, and the two assertions below are
 * what stop that from being a guess. Add a synchronous request method and the
 * first one fails; add a subscription that is not called `on…`, or a request
 * method that is, and the second does. Either way the compiler names the member
 * before the stub can answer it wrongly.
 */
type RequestMembers = {
  [K in keyof NexusApiMembers as K extends `on${string}` ? never : K]: NexusApiMembers[K];
};
type SubscriptionMembers = {
  [K in keyof NexusApiMembers as K extends `on${string}` ? K : never]: NexusApiMembers[K];
};

type _EveryRequestReturnsAPromise = AssertTrue<
  RequestMembers extends Record<keyof RequestMembers, (...args: never[]) => Promise<unknown>>
    ? true
    : false
>;
type _EverySubscriptionReturnsAnUnsubscribe = AssertTrue<
  SubscriptionMembers extends Record<keyof SubscriptionMembers, (...args: never[]) => () => void>
    ? true
    : false
>;

/** The runtime half of the rule the two assertions above prove. */
const isSubscription = (method: string): boolean => method.startsWith("on");

/**
 * Property names the JavaScript runtime PROBES on an arbitrary object, which a
 * plain object does not already carry: `then` decides whether something is a
 * promise, `toJSON` decides how `JSON.stringify` serialises it.
 *
 * They are listed because they cannot be inherited from the proxy's target the
 * way `toString` and `valueOf` are — nothing provides them, so without this the
 * proxy would answer them like methods. That was a REAL failure and not a
 * hypothetical one: before this list existed, `String(nexus)` reached
 * `toString`, got a function that returned a rejected promise, could not coerce
 * it to a primitive, and threw `Cannot convert object to primitive value` while
 * leaving two unhandled rejections behind — from a `console.log`.
 */
const RUNTIME_PROBES: ReadonlySet<string> = new Set(["then", "toJSON"]);

/**
 * The names the fall-through hands to an ordinary object, TAKEN ONCE, at module
 * load, from `Object.prototype` itself.
 *
 * **This snapshot is the fix for a demonstrated break, not a micro-optimisation
 * of `Reflect.has`.** The trap used to ask `Reflect.has(target, name)` — and
 * `Reflect.has` consults the prototype CHAIN, not the object. So one polluted
 * key, `Object.prototype.listProfiles = () => Promise.resolve([…])`, made the
 * trap classify a real API method as „something a plain object already
 * answers", delegate to the chain, and return the attacker's function AS the
 * method. Not a refusal, not an error: a page that asked for the user's
 * profiles got the gadget's answer and had no way to tell.
 *
 * That is not a hypothetical gadget in this repository. `pnpm-workspace.yaml`
 * holds three lodash prototype-pollution advisories (GHSA-r5fr-rjxr-66jc,
 * -f23m-r3pf-42rh, -xxjr-mmjv-4gpg) which arrive SHIPPED — through Excalidraw,
 * not through the toolchain — and are held off by a version override rather
 * than by the vulnerable code having gone away.
 *
 * A snapshot cannot be polluted after the fact: whatever is added to
 * `Object.prototype` later is, correctly, not one of the names an object was
 * born with, so it takes the member branch and gets the refusal.
 */
const OBJECT_PROTOTYPE_NAMES: ReadonlySet<string> = new Set(
  Object.getOwnPropertyNames(Object.prototype),
);

/**
 * The same names spelled out, because the assertion below cannot be stated
 * otherwise: `keyof object` is `never` and the wrapper type `Object` is banned
 * by the lint baseline, so there is nothing to intersect `keyof NexusApi`
 * against without writing them.
 *
 * EXPORTED SO A TEST CAN HOLD IT TO THE RUNTIME. A hand-written list that
 * nothing compares against is a claim, and the first version of this one was
 * wrong in exactly that way — it omitted the four `__…__` accessors, so the
 * assertion below proved less than its own comment said it did. `api.test.ts`
 * now asserts this tuple is `Object.getOwnPropertyNames(Object.prototype)`
 * exactly, which is the only thing that keeps the type honest on whatever
 * engine the browser turns out to be.
 */
export const OBJECT_PROTOTYPE_MEMBER_NAMES = [
  "constructor",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "toString",
  "valueOf",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "__proto__",
] as const;

type ObjectPrototypeMember = (typeof OBJECT_PROTOTYPE_MEMBER_NAMES)[number];

/**
 * Proof that the fall-through in the trap can never hide a real member: no
 * `NexusApi` method is named any of the above, nor `then`, nor `toJSON`.
 *
 * Without this the trap's rule („anything a plain object already answers is not
 * a method") would be a bet on the contract's naming rather than a fact about
 * it, and the day someone added `NexusApi.toJSON()` the web build would answer
 * it with `undefined` instead of a refusal — silently, since `undefined` is a
 * legal thing for a property to be.
 */
type _NoMemberIsShadowedByTheFallThrough = AssertTrue<
  keyof NexusApi & (ObjectPrototypeMember | "then" | "toJSON") extends never ? true : false
>;

/**
 * What every method of the web build's `NexusApi` refuses with.
 *
 * A distinct class rather than a bare `Error` so a page can tell „the sync
 * engine is not wired yet" apart from „the request failed", which are different
 * things to say to a user and will stay different once sync exists: the second
 * is worth retrying and the first is not.
 */
export class NexusApiNotConnectedError extends Error {
  /** The method that was called, for a log line that names the caller's intent. */
  readonly method: string;

  constructor(method: string) {
    super(`${strings.api.notConnected} (NexusApi.${method})`);
    this.name = "NexusApiNotConnectedError";
    this.method = method;
  }
}

/**
 * What the web build answers for the kit's namespace: NOTHING, frozen.
 *
 * The desktop's `NexusApi.modules` carries one namespace per discovered kit
 * module (ADR-090); this build ships no kit module, so the member is here - a
 * ported page reads the same shape - and holds no namespaces. One module-level
 * object rather than a fresh `{}` per read, for the identity reason the `get`
 * trap below gives about functions: React compares what a page reads by
 * identity. Frozen for the same reason the proxy's target is: a write to a seam
 * must fail where it is written, not silently succeed.
 */
const WEB_MODULES = Object.freeze({}) as NexusApi["modules"];

/**
 * The web build's `NexusApi`: the shape is real, the answers are not yet.
 *
 * **THIS STUB IS THE CONTRACT THE SYNC ENGINE WILL SATISFY.** Everything a page
 * may ask of its data is declared in `NexusApi`, so a page written against this
 * object cannot tell which side of the product it is running on — on the desktop
 * the preload bridge answers over IPC from the main process's SQLite; here the
 * sync engine will answer from the local replica it keeps in step with the
 * server. Replacing this module's export with that implementation is the whole
 * of what „the web app works" means, and no page changes when it happens.
 *
 * A `Proxy` rather than 402 hand-written stubs, and not to save typing: an
 * enumerated stub list would have to be extended by hand every time the desktop
 * adds a channel, and the day someone forgot, the web build would answer
 * `undefined is not a function` — a message that names neither the method nor
 * the reason. A proxy answers the interface as it is, including the methods
 * added tomorrow.
 */
function createNotConnectedApi(): NexusApi {
  // One function per method name, kept rather than rebuilt on each read. React
  // compares callbacks by identity — an effect with `[nexus.listTasks]` in its
  // dependency array, against a proxy that minted a new function per access,
  // would re-run on every render forever, and the app would look like it had an
  // infinite loop rather than like it was unwired.
  const answers = new Map<string, () => unknown>();

  return new Proxy(
    // The one cast in this module, and the reason the assertions above exist:
    // an interface has no runtime value to build a proxy over, so the target is
    // empty and the `get` trap is what makes the claim true.
    //
    // FROZEN, and that is a security property rather than tidiness. The
    // desktop's half of this same contract is a frozen preload bridge (SEC-EL);
    // the browser is the more hostile of the two runtimes, so the seam must not
    // be the more permissive of the two objects. Without the freeze, the
    // default `set` trap wrote straight through to this target — and since the
    // fall-through consulted the target, `nexus.listProfiles = attackerFn` was
    // permanent: every later read returned the written function and the refusal
    // simply stopped happening. Frozen, the assignment throws a TypeError where
    // it is written, which is the only place anyone can act on it.
    Object.freeze({}) as NexusApi,
    {
      get(target, property, receiver) {
        // THE RULE: this proxy answers for `NexusApi` MEMBERS, and for nothing
        // else. Everything else is the runtime asking questions ABOUT the
        // object rather than of it, and it must get the answers an ordinary
        // object would give.
        //
        // Symbols first: `Symbol.toPrimitive` when it is coerced,
        // `Symbol.iterator` when it is spread, `Symbol.toStringTag`, React
        // DevTools' own probes. None of them is ever a member.
        //
        // Then the names an object is BORN with — `toString`, `valueOf`,
        // `hasOwnProperty`, `constructor`, and the rest of `Object.prototype`
        // — from the snapshot taken at module load, never from a live
        // `Reflect.has`. The difference is the whole of the pollution defect
        // described on `OBJECT_PROTOTYPE_NAMES`: `Reflect.has` answers for the
        // prototype CHAIN as it stands right now, so anything written onto
        // `Object.prototype` afterwards would be handed back as if it were the
        // API method of the same name.
        //
        // `then` and `toJSON` are the two probes a plain object does NOT carry,
        // so they alone are named — see `RUNTIME_PROBES`. `then` is the sharp
        // one: `await nexus`, or returning it from an async function, makes the
        // promise machinery read `.then` and CALL it with (resolve, reject),
        // and whatever happened next would be blamed on a method nobody wrote.
        if (typeof property === "symbol" || OBJECT_PROTOTYPE_NAMES.has(property)) {
          return Reflect.get(target, property, receiver);
        }
        if (RUNTIME_PROBES.has(property)) return undefined;
        // The kit's namespace is answered with nothing in it: the web build serves no kit module.
        if (property === "modules") return WEB_MODULES;

        const existing = answers.get(property);
        if (existing !== undefined) return existing;

        const answer = isSubscription(property)
          ? (): never => {
              throw new NexusApiNotConnectedError(property);
            }
          : // A NEW rejected promise per call, never one cached alongside the
            // function: a rejected promise nobody is awaiting yet is an
            // unhandled rejection at the moment it is created, so a cached one
            // would report itself once, at start-up, from no call site at all.
            (): Promise<never> => Promise.reject(new NexusApiNotConnectedError(property));

        answers.set(property, answer);
        return answer;
      },
    },
  );
}

/**
 * The object a page uses. Named the way the desktop names it (`window.nexus`),
 * so porting a page here is an import and nothing else — every
 * `nexus.listTasks(…)` in it already reads correctly against this object.
 */
export const nexus: NexusApi = createNotConnectedApi();
