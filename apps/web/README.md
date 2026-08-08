# @nexus/web

The web surface of Nexus: the **same** React codebase as the desktop renderer,
built by Vite and served as static assets from a **Cloudflare Worker**.

It holds no database, no keys and no crypto. Its whole job today is to prove
three things cross to a browser unchanged — the design system
(`@nexus/ui` + `@nexus/tokens`), both themes (Dan and Noć, driven by the
desktop's own `theme.ts`), and the data contract (`NexusApi`) — and to carry the
hosting configuration and the response headers that everything else will be
served behind.

**No secret is ever committed to this directory.** Nothing here reads a key, a
token or a password, and the one deployment-specific value the build needs (a
Supabase project ref, which is public by construction — it is in the URL of
every request the browser makes) arrives from the environment and is written
into the build output, never into a source file.

---

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | The page. Carries no CSP meta tag, and says why. |
| `src/api.ts` | **The seam.** The `NexusApi` stub every method of which refuses. |
| `src/theme.ts` | Dan/Noć — the desktop's theme module, imported not copied. |
| `src/strings.ts` | Every user-facing word, in Serbian, in one table. |
| `src/App.tsx`, `src/app.css` | The shell: top strip, module rail, page. |
| `public/_headers` | The security policy Cloudflare attaches to every response. |
| `wrangler.jsonc` | The Worker: static assets, no Worker script. |
| `build/headers.ts` | Writes the deployment's Supabase origin into `dist/_headers`. |
| `test/` | The gates: the headers file, the origin substitution, the seam, the app boundary. |

## Commands

```sh
pnpm --filter @nexus/web dev         # Vite dev server
pnpm --filter @nexus/web build       # → dist/ (what wrangler deploys)
pnpm --filter @nexus/web typecheck   # both tsconfigs, as apps/desktop does
pnpm --filter @nexus/web test        # the _headers and project-ref gates
```

`pnpm --filter @nexus/web preview` serves the built output **without
`public/_headers`** — that file is applied by Cloudflare, not by Vite. A preview
therefore looks fine with a policy that would have broken the deployed app, and
vice versa. Check headers against a real deployment (or `wrangler dev`), never
against `preview`.

---

## The `NexusApi` seam

`apps/desktop/src/shared/ipc.ts` declares `NexusApi` — every question a page may
ask about its data, one method per IPC channel. On the desktop the preload
bridge implements it over IPC to the main process's SQLite. Here, `src/api.ts`
implements it as a stub in which **every method refuses**, and that stub is the
contract the sync engine will later satisfy: when it does, a page changes
nothing, because a page never knew which side it was on.

Two details of that stub are load-bearing:

- **Request methods reject; subscriptions throw.** The 398 `Promise`-returning
  methods hand back a rejected promise, because the desktop chains `.catch(…)`
  straight onto a dozen of them and a synchronous throw sails past a `.catch`.
  The four `on…` subscriptions throw where they are called instead, because a
  promise handed back as an „unsubscribe" would be called during a `useEffect`
  cleanup and crash on unmount, far from the cause.
- **That split is a rule about names, and the compiler enforces it.** Four
  type-level assertions in `src/api.ts` prove that every member is callable,
  that every non-`on…` member returns a `Promise`, that every `on…` member
  returns an unsubscribe function, and that no member is named `toString`,
  `valueOf`, `then` or `toJSON` — the names the proxy must let fall through to
  an ordinary object. Add a member that breaks any of those and the build names
  it.

- **The seam is frozen, and it decides „is this a member?" from a snapshot.**
  Both are fixes for demonstrated breaks. The trap used to ask
  `Reflect.has(target, name)`, which consults the prototype **chain** — so
  `Object.prototype.listProfiles = () => Promise.resolve([…])` made the trap
  treat a real API method as something a plain object already answers and hand
  the gadget's function back **as the method**, with no refusal and no error.
  This repository ships three lodash prototype-pollution advisories through
  Excalidraw, held off by a version override rather than by a fix, so the gadget
  is a supply-chain step away. The names are now snapshotted from
  `Object.prototype` at module load, and the proxy's target is `Object.freeze({})`
  so `nexus.listProfiles = …` throws where it is written instead of permanently
  replacing the method — the desktop's half of this contract is a frozen preload
  bridge (SEC-EL), and the browser must not be the more permissive runtime.

`test/api.test.ts` pins the behaviour the types cannot: which refusal each kind
gives, that `.catch(…)` on a request works, that reading a method twice gives
the same function, that the object survives being printed, that a polluted
prototype does not answer for it, and that the hand-written `Object.prototype`
list matches the runtime exactly — it did not, at first, which made the
fall-through proof weaker than its own comment claimed.

**Still open, and the reason `RUNTIME_PROBES` is the wrong shape:** it is a
denylist of two names, and names that are not on it are answered as if they were
methods. `nexus.catch`, `nexus.finally`, `nexus.$$typeof` and Vitest's
`asymmetricMatch` all return a function today. None of them leaks anything — the
worst case is an unhandled rejection or a confusing React error — but the right
fix is the inverse of a denylist: an allowlist of the 402 member names derived
from `ipc.ts` and diffed against it by a test, which is also where `WEB_DENIED`
(see the founder decisions above) belongs. Both should be built once, together,
after that decision — not twice.

`test/boundary.test.ts` holds this app to the promise `api.ts` and `theme.ts`
each make in prose: exactly two reaches into `apps/desktop`, the 9,000-line
contract taken as types only, the theme module still importing nothing at
runtime, and never a reach into `main/` or `preload/`.

## The headers

`public/_headers` is the whole security posture of this surface. It is not code:
nothing imports it, nothing typechecks it, and Cloudflare answers a rule it
cannot parse by ignoring it. `test/headers.test.ts` is therefore the gate — it
parses the file the way Cloudflare does, asserts every directive by name, and
refuses four separate kinds of drift: something removed, something widened
(`'unsafe-inline'`, a bare `'unsafe-eval'`, a `*`, a plaintext origin), the file
being somewhere Cloudflare will not read it, and anything Cloudflare's parser
would silently swallow.

That last class is the one the first version of this gate could not see, because
it asserted a grammar Cloudflare does not have. Cloudflare's `parseHeaders`
**trims every line before looking at it**, so indentation means nothing; a line
is a PATH if it starts with `/` or holds `://` before its first space, a header
line over **2,000 characters is dropped**, `! Name` (with the space) *deletes* a
header, and a repeated name is joined with `", "` rather than refused. The sharp
one is the path rule, because it is a property of a header's *value*: a compact
URL-bearing header such as `Report-To:{"url":"https://…"}` is read as a path,
fails URL validation, and then **every remaining header in the block is
skipped** — a site served completely unarmed, with nothing failing anywhere. The
gate now models all of that and carries fixtures that prove it catches each one.

`'wasm-unsafe-eval'` is in `script-src` for **Argon2id**, which runs as
WebAssembly in the browser: instantiating a WASM module counts as evaluating
code. It is the narrow keyword — WebAssembly compilation and nothing else — and
**it must not widen to `'unsafe-eval'`**, which would additionally restore
`eval`, `new Function` and string-bodied timers. The suite refuses that change
so it cannot be made while chasing a console error.

### Four things the founder must decide before real data crosses this surface

**1. `NexusApi` is the DESKTOP's contract, and twelve of its members must never
exist in a browser.** `src/api.ts` adopts all 402 members and proves at compile
time that every one of them is answerable. Among them:
`createAccount` and `createAdditionalAccount` **return the one-time Recovery Kit
code** (`AuthResult.recoveryCode`) — the 160-bit secret that unwraps the local
data key DK; `regenerateRecoveryCode` issues a fresh one; `unlockWithRecovery`
**takes it as an argument**; `unlockWithPasscode`, `changePasscode` and
`verifyProfileSwitch` carry the account passcode; `privSetup`/`privUnlock` carry
the Privatno vault credential; and `windowMinimize`/`windowToggleMaximize`/
`windowClose`/`windowState`/`windowView`/`pickProfilePicture`/
`privPickAttachment` are Electron shell operations a browser has no equivalent
of. The agreed design says DK and the local key chain are untouched by the web
work and that MK never enters a browser. Nothing here says so: the seam's
thesis is that satisfying this interface is what „the web app works" means, and
`_EveryMemberIsCallable` actively **fails the build if a member is ever made
un-answerable** — i.e. it forbids narrowing the contract.
The fix is a `WEB_DENIED` set in `src/api.ts`, proven at compile time to be a
subset of `keyof NexusApi`, whose members refuse permanently and with a
different sentence („this never exists on the web") rather than „not connected
yet". **Which members belong in it is a founder decision, not a scaffolding
one**, which is why the set is described here and not written.

**2. `connect-src` has no `'self'`, and Argon2id will need it unless the WASM is
inlined.** The file argues `'self'` „would buy nothing", on the grounds that the
app only opens sockets to Supabase. That is a prediction. `connect-src` governs
`fetch`, and the usual way a WASM module loads is
`WebAssembly.instantiateStreaming(fetch("/assets/argon2.wasm"))` — a same-origin
`fetch`, blocked by this policy. So the directive that was widened *for* Argon2id
(`'wasm-unsafe-eval'`) sits beside one that can stop it loading at all.
`packages/sync-crypto` currently declares `argon2id` as an abstract `CryptoPort`
method with no browser implementation, so the choice is still open: either the
implementation must inline its WASM as a `data:`/base64 payload (no fetch), or
`connect-src` gains `'self'`. Decide it before the KDF is written, not after.

**3. HSTS `preload` is a commitment, not a header.** `max-age=63072000;
includeSubDomains; preload` asks browser vendors to hard-code the domain — and
`includeSubDomains` binds **every** subdomain to HTTPS for two years, including
ones that do not exist yet and any that cannot serve TLS. Removal from the
preload list takes months. Correct for a paid product on a domain the founder
owns; it must be a deliberate yes, and it should not be sent until the real
hostname is the one being served.

**4. CSP has no `webrtc 'block'`.** Under this policy an injected script cannot
reach an attacker's host through `fetch`, `img`, a form or a navigation — but
`RTCPeerConnection` is governed by none of those directives, and a STUN URL is a
documented way out of a tight `connect-src`. Adding `webrtc 'block'` costs
nothing here: this app has no use for WebRTC and no plan for one.

### One known conflict, for the founder to decide

`style-src 'self'` (no `'unsafe-inline'`) **blocks the `style` attribute**, not
just `<style>` blocks: CSP Level 3 resolves inline style attributes through
`style-src-attr`, which falls back to `style-src`. `@nexus/ui` sets inline
styles in three places and the desktop renderer in eighteen — `ProportionBar`'s
segment widths, `SpanLanes`' scroll height and so on — so those components will
render with those declarations silently dropped when they are ported here. The
desktop's own CSP includes `'unsafe-inline'` in `style-src`, which is why it has
never shown.

This shell deliberately uses none of the affected components, so it runs clean
under the policy exactly as written. The decision is needed before the first
real page is ported, and the minimal answer is `style-src-attr 'unsafe-inline'`
— which permits the attribute only and still forbids `<style>` elements and
remote stylesheets. Widening `style-src` itself would be strictly worse. **Not
changed here:** the policy above is the agreed one, and it is not a scaffolding
agent's call to loosen it.

---

## What a human must do

None of this is automated, and none of it produces a file in this repository.

1. **A Cloudflare account.** Create one at `dash.cloudflare.com`. Turn on
   two-factor authentication before anything else is connected to it.
2. **A domain.** Buy it (Cloudflare Registrar, or transfer an existing one) and
   let Cloudflare serve its DNS. Nothing to turn off afterwards:
   `wrangler.jsonc` sets `workers_dev: false` and `preview_urls: false`, so a
   deploy attaches the Worker to nothing until a custom domain is added. That
   used to be a dashboard step written down here, which meant the app was live
   on `nexus-web.<account>.workers.dev` — and on a permanent, version-pinned
   preview URL per build — from the first deploy until somebody remembered.
3. **Create the Worker and attach the hostname.** `wrangler deploy` creates the
   Worker named in `wrangler.jsonc` (`nexus-web`); the custom domain is attached
   in the dashboard, under the Worker's *Domains & Routes*. It is deliberately
   not committed: which hostname a build is served on is one deployment's fact,
   not the product's.
4. **Set the API token used to deploy.** Create it in the dashboard with the
   *Edit Cloudflare Workers* template, scoped to this account and this zone
   only. Give it to the shell that runs the deploy as `CLOUDFLARE_API_TOKEN`
   (and `CLOUDFLARE_ACCOUNT_ID`). **Never** in a file in this repository, never
   in `wrangler.jsonc`, never in a `.env` that is committed.
5. **Set the Supabase project ref at build time.** The CSP has to name the real
   Supabase host or every sync request is blocked:

```sh
   NEXUS_SUPABASE_PROJECT_REF=<ref> pnpm --filter @nexus/web build
   pnpm dlx wrangler deploy --cwd apps/web
```

   The variable is deliberately **not** `VITE_`-prefixed: it is needed by the
   header, not by the client bundle, and a `VITE_` name would inline it into the
   JavaScript as well. With it unset the build says so and leaves the
   placeholder — fine for CI, not deployable.

   **Nothing enforces that on the deploy side, so check it by hand until
   something does:** `grep -c PROJECT.supabase.co apps/web/dist/_headers` must
   print `0` before `wrangler deploy` runs. Forgetting the variable ships a
   `connect-src` naming a host that does not exist; the app then loads, renders,
   and fails every sync request with a CSP violation. It fails closed, which is
   why this is a checklist line and not a build error — a build error would also
   break CI, which has no deployment identity to give it.

   `wrangler` is intentionally not a dependency of this repository: it pulls the
   workerd runtime (~100 MB) into every `pnpm install`, including CI's, in
   exchange for a deploy CI does not perform. `pnpm dlx` fetches it for the one
   command that needs it.
6. **Verify the headers on the real origin**, once, after the first deploy:

```sh
   curl -sI https://<hostname>/ | grep -i -E 'content-security|strict-transport|x-frame'
```

   `test/headers.test.ts` proves what the file says. Only this proves what
   Cloudflare sends.

### Why Workers and not Pages

Cloudflare's own guidance is that new projects start on Workers now that Workers
serves static assets: Pages keeps working, but the investment and the new
features are on Workers. Starting on the other half would mean migrating this
app before it has shipped once.

---

## Handed to other areas

Three things this app needs are outside its own directory and were **not**
changed here.

1. **`packages/core` has no `sideEffects` hint, and this build pays 337 kB for
   it.** `@nexus/ui`'s barrel re-exports `views/*`, which import `@nexus/core`'s
   barrel, which pulls `fitness/catalogue.ts` — and that module builds its lookup
   `Map` at module scope, so Rollup sees top-level work it may not remove. The
   result is that a 446 kB food catalogue ships inside a shell that renders none
   of it: **554 kB of JavaScript, of which 337 kB is food.** Measured fix, one
   line in `packages/core/package.json`:

```sh
   "sideEffects": false
```

   which takes this build to **216 kB (gzip 67)**. Verify with
   `pnpm --filter @nexus/web build` and then
   `grep -c Piletina apps/web/dist/assets/*.js` — it must print `0`. Audit core
   for genuine import-time effects before adding it; the alternative fix is a
   `./fitness` subpath export on core so `@nexus/ui` never reaches the barrel.
   The desktop pays this too, as startup parse time inside an installer where
   nobody was measuring.
2. **`eslint.config.mjs` does not know this app exists.** Its `REACT_FILES` list
   names the desktop renderer, the gallery and `packages/ui`, so
   `react-hooks/rules-of-hooks` and `exhaustive-deps` do not run on
   `apps/web/src/**`. The raw-colour rule does reach here (it globs
   `apps/*/src/**`), and so do `check:colours` and `check:tokens`, which
   discover their roots from the filesystem.
Nothing else. `scripts/check-css.mjs` needs **no** change: an earlier version of
this file claimed it hardcodes its roots and misses `apps/web/src/app.css`, and
that was wrong — its `scanRoots()` returns `sourceRoots(ROOT)` from
`check-colours.mjs`, which discovers every `apps/*/src` from the filesystem.
`apps/web/src` is in that list today, `pnpm check:css` walks `app.css`, and so
do `check:colours` and `check:tokens`. A handoff asking for a change that is
already made is worse than no handoff: it says a gate is open when it is shut.
