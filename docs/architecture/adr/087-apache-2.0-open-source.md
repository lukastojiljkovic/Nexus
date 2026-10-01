# ADR-087 — Nexus is Apache-2.0, and the repository becomes public

**Status:** accepted (2026-10-02; decided by the founder 2026-10-01) ·
**Owner:** founder · **Supersedes [ADR-080](080-third-party-notices.md) §1** —
the premise that Nexus is a commercial, closed-source product. Every other part
of ADR-080 stands unchanged, because the obligation it describes binds any
distributed binary whether or not the source is open.

## 1. The decision

Nexus is licensed under the **Apache License 2.0**. `LICENSE`, `NOTICE`, the
README's licence section and the root `package.json`'s `license` field all say
so, and the repository is published.

## 2. Why Apache-2.0, and not the two obvious alternatives

- **Not MIT.** Apache-2.0 carries an explicit patent grant from every
  contributor. For a product that ships cryptography and a generated-code
  surface, the grant is worth more than the shorter text saves.
- **Not AGPL-3.0.** Blocking a hosted fork is not a goal here. The threat this
  product actually designs against is a server that *can* read user content, and
  the answer to that is the ciphertext-only protocol — not a licence.
- **Compatible with the tree.** The readiness audit measured the mix
  ([OPEN-SOURCE-READINESS.md](../../OPEN-SOURCE-READINESS.md) §1): every
  production dependency of the packaged app is permissive, with no GPL, AGPL,
  SSPL or Commons-Clause anywhere, in the shipped tree or in the build
  toolchain. `check:licences` re-derives the shipped half from the tree on every
  run, so this is a fact the CI agrees with rather than a claim made once.

## 3. What this does not change

**The third-party notice obligation.** ADR-080's reasoning is that MIT, BSD,
Apache-2.0 and the OFL each require a notice to travel *with the distribution*.
That is a property of the dependency's licence, not of ours, and it is equally
true of an open-source binary. So, unchanged:

- `apps/desktop/scripts/generate-licences.mjs` stays the only source of the
  notices, reading each one off disk. Nobody types a licence.
- The „Licence" screen stays, and stays the thing that discharges the obligation
  for a user who receives only a binary.
- The font invariant stays: a bundled font whose terms cannot be established
  from a file is dropped, never described.
- `packages/core/src/electronics/ros.ts` keeps writing
  `<license>Proprietary</license>` into the ROS 2 packages it generates for the
  user. That is the *user's* code and the user's choice, not Nexus's licence, and
  the file says so where it does it.

## 4. Consequences

- Statements describing Nexus itself as commercial or closed-source were
  corrected in the living documents that carried them. ADR-080 keeps its
  original wording and gains a banner pointing here, because an accepted ADR is
  not rewritten — the same rule this file applies to it.
- The `docs/` tree becomes public with the repository. The review that decided
  what may be published, and what was redacted, is recorded in the pull request
  that made this change rather than in a committed file.
- The name and trademark check, and Windows code signing, are separate open
  items; neither is settled by the licence.
