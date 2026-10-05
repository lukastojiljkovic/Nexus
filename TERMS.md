# Terms for the distributed binaries

**Last updated:** 2026-10-02

The **source code** of Nexus is licensed under the Apache License 2.0 — see
[LICENSE](LICENSE). Those terms govern the code. This page states the terms
under which a **built application** is offered, because a binary carries things
the source does not: someone else's code inside it, and a warranty question.

## What you are getting

Nexus is an offline-first application that keeps your data in an encrypted
database on your own device. It is free, and there is no account to buy and no
service to subscribe to. It is provided **as-is**, without warranty of any kind,
express or implied, including the implied warranties of merchantability,
fitness for a particular purpose and non-infringement.

## No warranty, and the limit of liability

The application is provided without any guarantee that it will work, that it
will be free of defects, or that data will never be lost. **Keep your own
backups.** The application prints a copy of its data in a portable archive as a
built-in feature; use it.

To the maximum extent permitted by applicable law, the author is **not liable**
for any direct, indirect, incidental, special, consequential or exemplary
damages arising out of the use of, or the inability to use, this software —
including loss of data, loss of profits, or business interruption — even if
advised of the possibility of such damages.

Nothing here limits liability that cannot be limited by law, including for
intentional misconduct or gross negligence, and nothing here affects your
statutory rights as a consumer where those apply.

## Third-party components

The application includes other people's software — among it **Electron and
Chromium**, `better-sqlite3-multiple-ciphers`, **Excalidraw**, **TipTap**,
**Mermaid**, **KaTeX**, and the fonts bundled with the canvas editor. Each is
licensed under its own terms, and those terms apply to those components.

Their licences and notices are **not** reproduced here and are not meant to be:
they are generated from the exact dependency tree that was packaged, and they
ship inside the application under **Settings → Licences**, together with the
`LICENSES.chromium.html` that Electron places beside the executable. A
redistributor must carry those notices along with the binary.

## Cryptography and export control

This application contains cryptographic functionality. It uses well-known
public algorithms — Argon2id with HKDF-SHA256 for key derivation, AES-256-GCM
for authenticated encryption of content, X25519 for key agreement, and
SQLCipher's encryption for the local database.

Software containing cryptography is subject to export and import controls in
some jurisdictions. If you are redistributing these binaries, or using them
outside the country you obtained them in, **check the rules that apply to you**.
This is a statement of fact about the software, not legal advice.

## Trademarks and affiliation

**Nexus is not affiliated with, endorsed by, or connected to Microsoft, Google,
Sonatype, or any other product called "Nexus".** "Windows" is a trademark of the
Microsoft group of companies, "Electron" and "Chromium" are projects of their
respective owners, and all other trademarks belong to their owners. Their use
here is descriptive.

The Apache-2.0 licence grants rights to the **code**. It does not grant any
right to the project's name or logo. For the current position on the name, see
the project's own notes; a formal `TRADEMARK.md` is published only if the name
is confirmed as the long-term choice.

## Support

There is no support contract, no service level agreement and no paid tier. See
[SUPPORT.md](SUPPORT.md) for where to ask questions, and
[SECURITY.md](SECURITY.md) for reporting a security problem.

## Changes

These terms may change for future releases; the version that applies to a binary
is the one published with it. Material changes are recorded in
[CHANGELOG.md](CHANGELOG.md).

Contact: **stojiljkovic.d.luka@gmail.com**

