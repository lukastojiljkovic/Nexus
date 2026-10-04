# Contributing

Thanks for looking. This document is short on purpose: the rules are the ones
the project already runs on, and they are the same rules the maintainer works
under.

## Before you start

- **For anything larger than a fix**, open an issue first and say what you
  intend. A PR that changes direction is harder to accept than to discuss.
- **One change per pull request.** No drive-by refactors, no reformatting, no
  "while I was here". A reviewable diff is the point.
- The user interface is **Serbian only**, by decision. Code, comments,
  identifiers and documentation are **English**.

## Getting it running

Requirements: Node >= 24 and pnpm 11.10.0 (pinned in `package.json`).

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

The desktop app:

```sh
pnpm --filter @nexus/desktop dev      # run it
pnpm --filter @nexus/desktop smoke    # build, launch, end-to-end check -> "SMOKE OK"
pnpm --filter @nexus/desktop shots    # ~2,800 screenshots + a geometric audit
```

## What must pass before a PR

**`make verify`** runs the whole set: build, typecheck, lint, tests, and every
static gate. On Windows without GNU make, run the equivalent commands:

```sh
pnpm build && pnpm typecheck && pnpm lint && pnpm test
pnpm check:colours   # and every other check:* script in package.json
```

The gate list lives in `package.json` — read it from there rather than from any
document, because a list kept in two places drifts. Most of the gates are
seconds and all of them run in CI, one step each, so a red check names the rule
that broke.

`pnpm test` includes a wall-mutation suite that breaks the server SQL one line
at a time and demands the specific complaint. It is not decoration: a gate that
has never been observed to fail is indistinguishable from one that cannot.

## Rules the gates enforce

These are not style preferences, and CI will tell you when you break one:

- **Design tokens only.** Every colour, space, radius and type value comes from
  `packages/tokens` as a `--nx-*` variable. No raw hex, `rgb()`, or `hsl()`
  outside that package.
- **A field goes through the shared component.** Do not hand-roll an `<input>`
  when `TextField`, `Select` or `TextArea` exists.
- **A check is `check:*`.** If you find a class of defect that a rule could
  catch, write the rule rather than a comment asking people to remember.
- **No network in a local-only build.** `check:egress` fails on a new network
  construct, and that is a feature.

## Tests

- Data and store logic is written **test-first**. If you are fixing a defect in a
  store, write the failing test first and say in the PR that you did.
- A test asserts the **verdict**, not the parts. A suite that would stay green
  while the feature is broken is worse than no suite, because it reads as
  coverage.
- UI work is reviewed by **looking at it**: the `shots` command exists so that
  "does this look right" is a command rather than a favour.

## Commits and PRs

- **Conventional commits**, one concern each: `fix(db): ...`, `feat(desktop): ...`,
  `docs: ...`, `ci: ...`.
- **Stage explicit paths.** Never `git add .` — a stray build directory or a
  local database in a commit is a real leak, not a tidy-up.
- **No secrets, no personal data, no generated artefacts.** If you need a
  fixture that looks like a key, make it obviously fake and say so.
- **Never commit anything from `supabase/.temp/`** — the local development stack
  writes generated secrets there.

### Sign-off

The project **asks for a Developer Certificate of Origin sign-off** on each
commit (`git commit -s`), rather than a Contributor Licence Agreement. The
reason is that a DCO is a statement you make about your own contribution — that
you wrote it, or have the right to submit it — while a CLA asks you to assign or
license rights to somebody else. For a project whose licence is already
Apache-2.0, the DCO is the lighter of the two and the one most contributors have
already agreed to. **This is a recommendation the maintainer has not yet
confirmed**; see the pull request that added this file.

## An English locale

**Welcome**, and it is a mechanical extraction rather than a redesign: the
user-facing copy is centralised in `strings.sr.ts`, so a second locale means a
second table with the same keys and a way to choose between them. The maintainer
has not decided whether the language switch belongs in Settings before or after
the first release; open an issue if you want to work on it, so the decision and
the work land together.

## AI coding tools

They are used on this project, openly. The repository carries `CLAUDE.md`, the
working agreement those tools follow — it states the same rules as this file
(verify before committing, one concern per commit, tests first for store logic,
tokens only, no secrets) plus the project-specific ones. If you contribute with
an AI assistant, it is welcome; the review standards are the same either way,
and the person who opens the pull request is responsible for every line of it.

## Code of conduct

Participation is covered by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) (Contributor
Covenant 2.1). Reports go to stojiljkovic.d.luka@gmail.com.

