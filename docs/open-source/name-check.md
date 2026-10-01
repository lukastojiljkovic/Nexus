# Name and trademark check: "Nexus"

Written 2026-10-02, before the repository becomes public. **This is a
recommendation, not a decision** — the name stays exactly as it is until the
founder says otherwise, and nothing here renames anything.

## Why this exists

"Nexus" is one of the most-used product names in software. The project is about
to be published under it, and the cost of discovering a conflict later is
higher than the cost of looking now: a rename after the first release means the
installer, the website, the icon, the repository, the Gentoo ebuild and every
link move together, and every existing copy updates itself to a name it does not
recognise.

## What was searched, and what came back

All searches were run on **2026-10-02** from this machine. Where a source could
not be queried, that is stated rather than guessed at.

| Source | What was asked | Result |
| --- | --- | --- |
| **GitHub** | repositories named `nexus` (`in:name`) | **121,545** repositories. The most-starred: `abhigyanpatwari/GitNexus` (47,681), `graphql-nexus/nexus` (3,430), `sonatype/nexus-public` (2,662), `nexus-xyz/nexus-zkvm` (2,625), `Nexus-Mods/NexusMods.App` (2,038), `Heavrnl/nexus-terminal` (1,797) |
| **npm** | packages matching `nexus` | `nexus` (v1.3.0, GraphQL schema tooling) is taken at the root; `@nexus/*` is an in-use scope (`@nexus/logger`, `@nexus-cortex/*`). This project's own packages are `@nexus/*`, scoped and private |
| **PyPI** | project `nexus` | Taken: `nexus` 0.3.1, "An extendable admin interface" |
| **winget** | `winget search nexus` | 12 matches, including **`Nexus`** itself (`WinStep.Nexus`), `NexusMods.Vortex`, `Creative Nexus`, `Nexus Terminal`, `NexusShell`, `Nexus.OmniGet`, `nexusfont` |
| **Flathub** | search API for `nexus` | "Nexus LU Launcher" |
| **Microsoft Store** | — | **Not queried.** The Store search is a JavaScript application with no public query API; checking it needs a browser |
| **EUIPO TMview** | — | **Not queried:** `tmdn.org` refused the connection from this machine (curl error 56, connection reset), including a plain GET of the home page |
| **WIPO Global Brand Database** | — | **Not queried:** the host answers, but it serves a single-page application and offers no documented query API. A browser session is needed |
| **Serbian IP Office (ZIS)** | — | **Not queried:** `zis.gov.rs` answers, but its register search is an interactive service, not an API |

Two collisions worth naming separately from the counts, because they are
commercial products rather than hobby repositories:

- **Sonatype Nexus Repository** — a widely deployed artifact repository manager,
  under that name for around fifteen years. This is the collision that matters
  most, because it is software, in the same broad field, from a company with a
  legal department.
- **Google Nexus** — a hardware brand (phones and tablets, discontinued), which
  does not cover software distribution but keeps the word visible.

## The risk

**High, for the unqualified name in software.**

Three separate problems, in descending order of how much they matter:

1. **Registry risk is unknown, not zero.** TMview, WIPO and ZIS were not
   queried, so this document cannot say whether a live registration covers
   class 9 (software) or class 42 (software services) in the EU or Serbia. That
   is the one question a lawyer would ask first, and it is unanswered.
2. **Common-law and practical collision.** Even with no registration against
   it, "Nexus" cannot be a strong mark in this field: Sonatype uses it for
   software, winget already has a package literally called `Nexus`, and 121,545
   GitHub repositories share the word. The practical cost is real and immediate
   — search results, package names, `winget search`, domain names, and users
   arriving from the wrong place.
3. **Enforcement.** A name that cannot be enforced is not a trademark asset, so
   `TRADEMARK.md` would be stating a policy the project cannot back. That is not
   a reason not to write one — it is a reason to write it narrowly, as the draft
   below does.

## Alternatives, with availability actually checked

Checked on the same four public sources on 2026-10-02. None of these is a
trademark clearance — that still needs TMview, WIPO and ZIS, plus a lawyer if
the project is going to be commercial.

| Candidate | GitHub repos named this | npm | PyPI | winget |
| --- | --- | --- | --- | --- |
| **Svetionik** (lighthouse) | 7 | none | not found | none |
| **Trpeza** (table, in the sense of a laid table) | 5 | none | not found | none |
| **Zvezdan** | 11 | none | not found | not checked |
| **Nokturno** (nocturne) | 16 | none | not found | none |

`Svetionik` and `Trpeza` are the strongest of the four: both are Serbian words
that are distinctive in software, both had no package presence at all, and
neither appears in winget. `Nokturno` is a common European word and is likelier
to collide; `Zvezdan` is also a personal name.

## Recommendation

**Rename before the first public release, unless the founder actively wants the
name.**

The reasoning is about timing rather than about the name's quality. Nothing is
published yet: there is no tag, no release, no user, and no installer in
anybody else's hands. A rename today costs one pass through the repository
(`electron-builder.yml`'s `appId` and `productName`, the window title, the
ebuild, the site, `NOTICE`) and costs nothing else. A rename after the first
release costs every one of those plus a migration story for installed copies.

If the name is kept, the risk does not disappear, and the honest mitigation is
two steps:

1. **Publish the `TRADEMARK.md` draft below**, which asks for nothing the
   project cannot enforce: it disclaims affiliation and reserves nothing beyond
   what is already true.
2. **Do the register searches before the project earns any money**, and before
   the name appears on a paid product or a hosted service. That is the point at
   which the collision stops being an annoyance and becomes a liability.

**This is the founder's call, and the repository keeps the name until he makes
it.**

## Draft `TRADEMARK.md`

For the founder to use if the name is kept. It is deliberately narrow: it
reserves nothing, threatens nothing, and only says what is true.

```markdown
# Name and logo

The **source code** of Nexus is licensed under the Apache License 2.0, which
grants rights to the code and to nothing else. It does not grant a right to use
the project's name or its logo.

## What you may do

- You may use the name to refer to this project, to say that your work is based
  on it or compatible with it, and to reproduce the project's copyright and
  notice files. That is "reasonable and customary use" under section 6 of the
  licence.
- You may use the name in a fork, provided it is clear that the fork is a fork
  and not the original project.

## What you may not do

- You may not present a modified build as the project's own release.
- You may not use the name or the logo in a way that suggests the project
  endorses your product, service or organisation.

## No affiliation

Nexus is an independent project. It is **not affiliated with, endorsed by, or
connected to** Microsoft, Google, Sonatype, or any other product or company
called "Nexus". "Windows" is a trademark of the Microsoft group of companies;
all other trademarks belong to their owners and are used descriptively.

## No registration claimed

This project claims no registered trademark in the name. Nothing here asserts a
right it cannot enforce; the intent is only to avoid confusion about who made
this software.
```
