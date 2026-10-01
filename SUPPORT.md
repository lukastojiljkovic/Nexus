# Support

## Where to ask

| You want to | Go to |
| --- | --- |
| Ask a question, or show what you built | **Discussions** (Q&A and Show and tell) |
| Report something that is broken | **Issues** — use the bug report form |
| Ask for a feature | **Issues** — use the feature request form |
| Report a security problem | **Not an issue.** See [SECURITY.md](SECURITY.md) |
| Read the licence or the terms | [LICENSE](LICENSE), [TERMS.md](TERMS.md) |
| Check what data leaves your device | [PRIVACY.md](PRIVACY.md) |

Discussions has to be switched on by the maintainer, which happens with the
public launch. Until then, issues are the only channel.

## Before opening an issue

- Say which version you are running, and on which operating system.
- Say what you did, what you expected, and what happened instead.
- A screenshot or a log excerpt helps. **Do not paste personal data**: no note
  contents, no file names you would not publish, no encryption keys, no recovery
  codes, and nothing from a database file. If a log line looks like a key or a
  token, replace it with `[redacted]`.

## What is in scope

The desktop application, and the source in this repository. The user interface
is **Serbian only** — that is a decision, not an oversight, so "the app is not in
English" is not a bug. An English locale is welcome as a contribution; see
[CONTRIBUTING.md](CONTRIBUTING.md).

The optional sync service is **not running anywhere**: no hosted backend exists,
and the shipped build cannot be pointed at one. Issues that assume a working
account or a sync server cannot be reproduced yet.

## What is not in scope

- Support for a modified build, or for a build from a fork.
- Help recovering a lost passcode or a lost Recovery Kit. The design is that
  nobody — including the maintainer — can recover your data without them.
- Response-time guarantees. This is a project maintained by one person, with no
  support contract and no paid tier.

